import * as zlib from "node:zlib";
import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { cast, pipe } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { resolveAttachmentPathById } from "./attachmentStore.ts";
import { resolveStaticDir, ServerConfig } from "./config.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import { MetricsAggregator } from "./observability/Services/MetricsAggregator.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";
import { respondToAuthError } from "./auth/http.ts";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment.ts";
import {
  browserApiCorsAllowedHeaders,
  browserApiCorsAllowedMethods,
  browserApiCorsHeaders,
} from "./httpCors.ts";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

/** Content types that are already compressed and should not be re-compressed. */
const UNCOMPRESSIBLE_CONTENT_TYPES = new Set([
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/x-zip",
  "application/gzip",
  "application/x-gzip",
  "application/x-rar",
  "application/pdf",
  "application/ogg",
]);

/** Minimum response size in bytes before compression is applied. */
const MIN_COMPRESSION_SIZE = 1024;

/**
 * Checks if a content type should not be compressed.
 */
const isUncompressibleContentType = (contentType: string): boolean =>
  UNCOMPRESSIBLE_CONTENT_TYPES.has(contentType) ||
  UNCOMPRESSIBLE_CONTENT_TYPES.has(contentType.split(";")[0].trim()) ||
  UNCOMPRESSIBLE_CONTENT_TYPES.some((type) => contentType.startsWith(type));

/**
 * Parses the Accept-Encoding header and returns the preferred encoding.
 * Prefers brotli over gzip when both are accepted.
 */
const preferredEncoding = (acceptEncoding: string | undefined): "br" | "gzip" | undefined => {
  if (!acceptEncoding) return undefined;
  const encodings = acceptEncoding.split(",").map((e) => e.trim().toLowerCase());
  if (encodings.includes("br")) return "br";
  if (encodings.includes("gzip")) return "gzip";
  return undefined;
};

/**
 * Synchronously compresses data using the specified encoding.
 * For gzip: uses zlib.createGzip with sync mode.
 * For brotli: uses zlib.createBrotliCompress with sync mode.
 */
const compressSync = (
  data: Uint8Array,
  encoding: "br" | "gzip",
  level: number,
): Uint8Array => {
  if (encoding === "br") {
    return zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC, [zlib.constants.BROTLI_PARAM_QUALITY]: level } });
  }
  return zlib.gzipSync(data, { level });
};


/**
 * Synchronously decompresses data using the specified encoding.
 */
const decompressSync = (data: Buffer, encoding: "br" | "gzip"): Buffer => {
  if (encoding === "br") {
    return zlib.brotliDecompressSync(data);
  }
  return zlib.gunzipSync(data);
};

/**
 * Decompresses a request body if Content-Encoding is set.
 * Returns the decompressed body as a Buffer.
 */
const decompressRequestBody = (
  body: Uint8Array,
  contentEncoding: string | undefined,
): Buffer => {
  if (!contentEncoding) return Buffer.from(body);
  const encoding = preferredEncoding(contentEncoding);
  if (!encoding) return Buffer.from(body);
  try {
    return decompressSync(Buffer.from(body), encoding);
  } catch {
    return Buffer.from(body);
  }
};

/**
 * Compresses a response body if:
 * - The client supports compression (Accept-Encoding header)
 * - The response is larger than MIN_COMPRESSION_SIZE
 * - The content type is not already compressed
 *
 * Returns the compressed body and the Content-Encoding header value, or undefined.
 */
const compressResponseBody = (
  body: Uint8Array,
  contentType: string,
  acceptEncoding: string | undefined,
  compressionLevel: number,
): { body: Uint8Array; contentEncoding: "br" | "gzip" } | undefined => {
  if (body.length < MIN_COMPRESSION_SIZE) return undefined;
  if (isUncompressibleContentType(contentType)) return undefined;
  const encoding = preferredEncoding(acceptEncoding);
  if (!encoding) return undefined;
  try {
    const compressed = compressSync(body, encoding, compressionLevel);
    if (compressed.length >= body.length) return undefined;
    return { body: compressed, contentEncoding: encoding };
  } catch {
    return undefined;
  }
};


/**
 * Builds a compressed HTTP response from raw bytes.
 * Used for JSON API responses that support compression.
 */
const compressedResponse = (
  body: Uint8Array,
  contentType: string,
  acceptEncoding: string | undefined,
  compressionLevel: number,
  baseStatus: number,
  baseHeaders: Record<string, string>,
): HttpServerResponse.HttpServerResponse => {
  const compressed = compressResponseBody(body, contentType, acceptEncoding, compressionLevel);
  if (compressed) {
    const headers = { ...baseHeaders, "Content-Encoding": compressed.contentEncoding };
    return HttpServerResponse.uint8Array(compressed.body, {
      status: baseStatus,
      contentType,
      headers,
    });
  }
  return HttpServerResponse.uint8Array(body, {
    status: baseStatus,
    contentType,
    headers: baseHeaders,
  });
};

export const browserApiCorsLayer = HttpRouter.cors({
  allowedMethods: [...browserApiCorsAllowedMethods],
  allowedHeaders: [...browserApiCorsAllowedHeaders],
  maxAge: 600,
});

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;
  return redirectUrl.toString();
}

const requireAuthenticatedRequest = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  yield* serverAuth.authenticateHttpRequest(request);
});

export const serverEnvironmentRouteLayer = HttpRouter.add(
  "GET",
  "/.well-known/t3/environment",
  Effect.gen(function* () {
    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
    );
    const config = yield* ServerConfig;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const acceptEncoding = request.headers["accept-encoding"];
    const body = new TextEncoder().encode(JSON.stringify(descriptor));
    return compressedResponse(body, "application/json", acceptEncoding, config.compressionLevel, 200, browserApiCorsHeaders);
  }),
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const acceptEncoding = request.headers["accept-encoding"];
    const contentEncoding = request.headers["content-encoding"];
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;

    // Decompress request body if encoded
    const rawBody = cast<Uint8Array, Uint8Array>(yield* request.arrayBuffer);
    const decompressedBody = decompressRequestBody(rawBody, contentEncoding);
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(JSON.parse(decompressedBody.toString()));

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          bodyJson,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text("Trace export failed.", { status: 502 })),
        ),
      );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir = config.staticDir ?? (config.devUrl ? yield* resolveStaticDir() : undefined);
    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexData = yield* fileSystem
        .readFile(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexData) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return HttpServerResponse.uint8Array(indexData, {
        status: 200,
        contentType: "text/html; charset=utf-8",
      });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) {
      return HttpServerResponse.text("Internal Server Error", { status: 500 });
    }

    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType,
    });
  }),
);

/**
 * Aggregated metrics endpoint — returns sliding window statistics.
 * One window = 1 minute, circular buffer retains last 60 windows (1 hour).
 */
export const metricsAggregatedRouteLayer = HttpRouter.add(
  "GET",
  "/metrics/aggregated",
  Effect.gen(function* () {
    const aggregator = yield* MetricsAggregator;
    const windows = yield* aggregator.getAggregatedWindows();
    const body = new TextEncoder().encode(JSON.stringify(windows));
    return HttpServerResponse.uint8Array(body, {
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
    });
  }),
).pipe(Effect.catchTag("ServiceError", () =>
  HttpServerResponse.text("Metrics service unavailable", { status: 503 })
));
