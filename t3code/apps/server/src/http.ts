import { promisify } from "node:util";
import { brotliCompress, brotliDecompress, constants, gzip, gunzip } from "node:zlib";

import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as Types from "effect/Types";
import { cast } from "effect/Function";
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
import { DEFAULT_HTTP_COMPRESSION_LEVEL, resolveStaticDir, ServerConfig } from "./config.ts";
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
const RESPONSE_COMPRESSION_MIN_BYTES = 1024;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

export type HttpCompressionEncoding = "br" | "gzip";

class HttpCompressionError extends Data.TaggedError("HttpCompressionError")<{
  readonly cause: unknown;
  readonly operation: "compress" | "decompress";
}> {}

const compressedContentTypes = new Set([
  "application/gzip",
  "application/java-archive",
  "application/octet-stream",
  "application/pdf",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/x-bzip",
  "application/x-bzip2",
  "application/x-gzip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/zip",
  "application/zstd",
]);

function parseAcceptedEncodings(acceptEncoding: string | undefined): Set<string> {
  const accepted = new Set<string>();
  for (const rawPart of acceptEncoding?.split(",") ?? []) {
    const [encodingPart, ...parameters] = rawPart.trim().split(";");
    const encoding = encodingPart?.trim().toLowerCase();
    if (!encoding) continue;

    const qParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const qValue = qParameter ? Number.parseFloat(qParameter.trim().slice(2)) : 1;
    if (!Number.isFinite(qValue) || qValue <= 0) continue;
    accepted.add(encoding);
  }
  return accepted;
}

export function chooseResponseCompressionEncoding(
  acceptEncoding: string | undefined,
): HttpCompressionEncoding | undefined {
  const accepted = parseAcceptedEncodings(acceptEncoding);
  if (accepted.has("br") || accepted.has("*")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return undefined;
}

export function normalizeHttpCompressionLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_HTTP_COMPRESSION_LEVEL;
  return Math.min(11, Math.max(0, Math.round(level)));
}

export function shouldSkipCompressionContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;

  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.startsWith("audio/") ||
    normalized.startsWith("font/") ||
    normalized.startsWith("image/") ||
    normalized.startsWith("video/") ||
    compressedContentTypes.has(normalized)
  );
}

function mergeVaryHeader(current: string | undefined, nextValue: string): string {
  const values =
    current
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  if (values.some((value) => value.toLowerCase() === nextValue.toLowerCase())) {
    return values.join(", ");
  }
  return [...values, nextValue].join(", ");
}

function isCompressibleResponse(response: HttpServerResponse.HttpServerResponse): boolean {
  if (response.status === 204 || response.status === 304) return false;
  if (response.headers["content-encoding"]) return false;
  if (response.body._tag !== "Uint8Array") return false;
  if (response.body.contentLength < RESPONSE_COMPRESSION_MIN_BYTES) return false;
  return !shouldSkipCompressionContentType(response.body.contentType);
}

function compressBytes(
  bytes: Uint8Array,
  encoding: HttpCompressionEncoding,
  level: number,
): Effect.Effect<Uint8Array, HttpCompressionError> {
  const normalizedLevel = normalizeHttpCompressionLevel(level);
  return Effect.tryPromise({
    try: async () => {
      if (encoding === "br") {
        return await brotliCompressAsync(Buffer.from(bytes), {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: normalizedLevel,
          },
        });
      }

      return await gzipAsync(Buffer.from(bytes), {
        level: Math.min(9, normalizedLevel),
      });
    },
    catch: (cause) => new HttpCompressionError({ cause, operation: "compress" }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
}

export function compressHttpResponseForRequest(
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
  compressionLevel: number,
): Effect.Effect<HttpServerResponse.HttpServerResponse, HttpCompressionError> {
  const encoding = chooseResponseCompressionEncoding(request.headers["accept-encoding"]);
  if (!encoding || !isCompressibleResponse(response)) {
    return Effect.succeed(response);
  }

  const body = response.body;
  if (body._tag !== "Uint8Array") {
    return Effect.succeed(response);
  }

  return Effect.map(compressBytes(body.body, encoding, compressionLevel), (compressedBody) =>
    HttpServerResponse.setHeaders(
      HttpServerResponse.setBody(response, HttpBody.uint8Array(compressedBody, body.contentType)),
      {
        "Content-Encoding": encoding,
        Vary: mergeVaryHeader(response.headers.vary, "Accept-Encoding"),
      },
    ),
  );
}

function decodeRequestBody(
  bytes: Uint8Array,
  encoding: string,
): Effect.Effect<Uint8Array, HttpCompressionError> {
  return Effect.tryPromise({
    try: async () => {
      if (encoding === "br") {
        return await brotliDecompressAsync(Buffer.from(bytes));
      }
      return await gunzipAsync(Buffer.from(bytes));
    },
    catch: (cause) => new HttpCompressionError({ cause, operation: "decompress" }),
  }).pipe(Effect.map((buffer) => new Uint8Array(buffer)));
}

export function decompressHttpRequest(
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerRequest.HttpServerRequest, HttpCompressionError> {
  const contentEncoding = request.headers["content-encoding"]?.trim().toLowerCase();
  if (contentEncoding !== "gzip" && contentEncoding !== "br") {
    return Effect.succeed(request);
  }

  return Effect.gen(function* () {
    const compressedBytes = new Uint8Array(
      yield* request.arrayBuffer.pipe(
        Effect.mapError((cause) => new HttpCompressionError({ cause, operation: "decompress" })),
      ),
    );
    const decompressedBytes = yield* decodeRequestBody(compressedBytes, contentEncoding);
    const headers = new Headers({ ...request.headers });
    headers.delete("content-encoding");
    headers.set("content-length", decompressedBytes.byteLength.toString());

    const sourceUrl = request.source instanceof Request ? request.source.url : request.originalUrl;
    const url = sourceUrl.startsWith("/") ? `http://localhost${sourceUrl}` : sourceUrl;
    const webRequest = new Request(url, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : decompressedBytes,
    });

    return HttpServerRequest.fromWeb(webRequest).modify({
      url: request.url,
      remoteAddress: request.remoteAddress,
    });
  });
}

const httpCompressionMiddleware = (
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const decompressedRequest = yield* decompressHttpRequest(request).pipe(
      Effect.match({
        onFailure: () => undefined,
        onSuccess: (request) => request,
      }),
    );

    if (!decompressedRequest) {
      return HttpServerResponse.jsonUnsafe(
        {
          error: "Invalid compressed request body",
        },
        { status: 400 },
      );
    }

    const response = yield* handler.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, decompressedRequest),
    );

    return yield* compressHttpResponseForRequest(
      decompressedRequest,
      response,
      config.httpCompressionLevel,
    ).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to compress HTTP response", { cause }).pipe(Effect.as(response)),
      ),
    );
  });

export const browserApiCorsLayer = HttpRouter.cors({
  allowedMethods: [...browserApiCorsAllowedMethods],
  allowedHeaders: [...browserApiCorsAllowedHeaders],
  maxAge: 600,
});

export const httpCompressionRouteLayer = HttpRouter.middleware(httpCompressionMiddleware, {
  global: true,
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
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* request.json);

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
