import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import { brotliCompress, brotliDecompress, constants as zlibConstants, gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { cast } from "effect/Function";
import {
  Headers,
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpMiddleware,
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
import { resolveStaticDir, ServerConfig, type ServerConfigShape } from "./config.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
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
const COMPRESSION_MIN_BYTES = 1024;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

type CompressionEncoding = "br" | "gzip";

const COMPRESSED_CONTENT_TYPE_PATTERNS = [
  /^image\//i,
  /^audio\//i,
  /^video\//i,
  /^font\//i,
  /application\/(zip|gzip|x-gzip|x-7z-compressed|x-rar-compressed|x-tar|pdf)/i,
  /application\/octet-stream/i,
];

const getHeader = (headers: Headers.Headers, name: string): string | undefined =>
  headers[name.toLowerCase()];

export const selectCompressionEncoding = (
  acceptEncoding: string | undefined,
): CompressionEncoding | undefined => {
  if (!acceptEncoding) return undefined;
  const encodings = acceptEncoding
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const supports = (encoding: CompressionEncoding) =>
    encodings.some((entry) => {
      const [name, ...parameters] = entry.split(";").map((part) => part.trim());
      if (name !== encoding) return false;
      const q = parameters.find((parameter) => parameter.startsWith("q="));
      return q === undefined || Number.parseFloat(q.slice(2)) > 0;
    });
  if (supports("br")) return "br";
  if (supports("gzip")) return "gzip";
  return undefined;
};

export const isCompressibleContentType = (contentType: string | undefined): boolean => {
  if (!contentType) return false;
  return !COMPRESSED_CONTENT_TYPE_PATTERNS.some((pattern) => pattern.test(contentType));
};

const compressionOptions = (config: ServerConfigShape) => ({
  gzip: { level: Math.min(config.compressionLevel, 9) },
  brotli: {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: Math.min(config.compressionLevel, 11),
    },
  },
});

const compressBytes = (
  encoding: CompressionEncoding,
  body: Uint8Array,
  config: ServerConfigShape,
) =>
  Effect.promise(() => {
    const options = compressionOptions(config);
    return encoding === "br"
      ? brotliCompressAsync(body, options.brotli)
      : gzipAsync(body, options.gzip);
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));

export const decompressBytes = (encoding: string | undefined, body: Uint8Array) => {
  const normalized = encoding?.trim().toLowerCase();
  if (normalized === undefined || normalized === "" || normalized === "identity") {
    return Effect.succeed(body);
  }
  if (normalized === "br") {
    return Effect.promise(() => brotliDecompressAsync(body)).pipe(
      Effect.map((buffer) => new Uint8Array(buffer)),
    );
  }
  if (normalized === "gzip") {
    return Effect.promise(() => gunzipAsync(body)).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
  }
  return Effect.fail(new UnsupportedContentEncodingError({ encoding: normalized }));
};

class UnsupportedContentEncodingError extends Data.TaggedError("UnsupportedContentEncodingError")<{
  readonly encoding: string;
}> {}

const compressResponse = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    if (response.status < 200 || response.status === 204 || response.status === 304) {
      return response;
    }
    if (getHeader(response.headers, "content-encoding")) {
      return response;
    }
    if (response.body._tag !== "Uint8Array") {
      return response;
    }
    if (response.body.contentLength < COMPRESSION_MIN_BYTES) {
      return response;
    }
    if (!isCompressibleContentType(response.body.contentType)) {
      return response;
    }

    const encoding = selectCompressionEncoding(getHeader(request.headers, "accept-encoding"));
    if (encoding === undefined) {
      return response;
    }

    const compressed = yield* compressBytes(encoding, response.body.body, config);
    return HttpServerResponse.uint8Array(compressed, {
      status: response.status,
      statusText: response.statusText,
      contentType: response.body.contentType,
      headers: Headers.setAll(response.headers, {
        "content-encoding": encoding,
        "content-length": String(compressed.length),
        vary: getHeader(response.headers, "vary")
          ? `${getHeader(response.headers, "vary")}, Accept-Encoding`
          : "Accept-Encoding",
      }),
      cookies: response.cookies,
    });
  });

export const httpCompressionMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.flatMap(httpApp, compressResponse),
);

export const httpCompressionLayer = Layer.effectDiscard(
  Effect.flatMap(Effect.service(HttpRouter.HttpRouter), (router) =>
    router.addGlobalMiddleware(httpCompressionMiddleware),
  ),
);

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
    return HttpServerResponse.jsonUnsafe(descriptor, {
      status: 200,
      headers: browserApiCorsHeaders,
    });
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
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const bodyBytes = new Uint8Array(yield* request.arrayBuffer);
    const decompressedBodyResult = yield* Effect.result(
      decompressBytes(getHeader(request.headers, "content-encoding"), bodyBytes),
    );
    if (decompressedBodyResult._tag === "Failure") {
      return HttpServerResponse.text("Unsupported Content-Encoding", { status: 415 });
    }
    const parsedBodyResult = yield* Effect.result(
      Effect.try({
        try: () => JSON.parse(new TextDecoder().decode(decompressedBodyResult.success)),
        catch: (cause) =>
          new DecodeOtlpTraceRecordsError({
            cause,
            bodyJson: cast<unknown, OtlpTracer.TraceData>({}),
          }),
      }),
    );
    if (parsedBodyResult._tag === "Failure") {
      return HttpServerResponse.text("Invalid trace payload", { status: 400 });
    }
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(parsedBodyResult.success);

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
