import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import {
  brotliCompress,
  brotliDecompress,
  constants as zlibConstants,
  gzip,
  gunzip,
  type BrotliOptions,
  type ZlibOptions,
} from "node:zlib";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import * as Headers from "effect/unstable/http/Headers";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { resolveAttachmentPathById } from "./attachmentStore.ts";
import { resolveStaticDir, ServerConfig } from "./config.ts";
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
const HTTP_COMPRESSION_MIN_BYTES = 1024;
const DEFAULT_HTTP_COMPRESSION_LEVEL = 4;
const HTTP_COMPRESSION_LEVEL_ENV_NAMES = [
  "T3CODE_HTTP_COMPRESSION_LEVEL",
  "T3_HTTP_COMPRESSION_LEVEL",
  "HTTP_COMPRESSION_LEVEL",
] as const;

type HttpCompressionEncoding = "br" | "gzip";

type DecodedHttpRequestResult =
  | {
      readonly _tag: "Request";
      readonly request: HttpServerRequest.HttpServerRequest;
    }
  | {
      readonly _tag: "Response";
      readonly response: HttpServerResponse.HttpServerResponse;
    };

class HttpCompressionError extends Data.TaggedError("HttpCompressionError")<{
  readonly cause: unknown;
}> {}

const gzipAsync = promisify(gzip) as (input: Buffer, options: ZlibOptions) => Promise<Buffer>;
const gunzipAsync = promisify(gunzip) as (input: Buffer) => Promise<Buffer>;
const brotliCompressAsync = promisify(brotliCompress) as (
  input: Buffer,
  options: BrotliOptions,
) => Promise<Buffer>;
const brotliDecompressAsync = promisify(brotliDecompress) as (input: Buffer) => Promise<Buffer>;

export const browserApiCorsLayer = HttpRouter.cors({
  allowedMethods: [...browserApiCorsAllowedMethods],
  allowedHeaders: [...browserApiCorsAllowedHeaders],
  maxAge: 600,
});

export function resolveHttpCompressionLevel(env: NodeJS.ProcessEnv = process.env): number {
  const rawLevel = HTTP_COMPRESSION_LEVEL_ENV_NAMES.map((name) => env[name]).find(
    (value): value is string => value !== undefined && value.trim().length > 0,
  );
  if (!rawLevel) {
    return DEFAULT_HTTP_COMPRESSION_LEVEL;
  }

  const parsedLevel = Number.parseInt(rawLevel, 10);
  if (!Number.isFinite(parsedLevel)) {
    return DEFAULT_HTTP_COMPRESSION_LEVEL;
  }

  return Math.max(
    zlibConstants.Z_NO_COMPRESSION,
    Math.min(zlibConstants.BROTLI_MAX_QUALITY, parsedLevel),
  );
}

export function selectHttpResponseCompressionEncoding(
  acceptEncoding: string | undefined,
): HttpCompressionEncoding | undefined {
  if (!acceptEncoding) {
    return undefined;
  }

  const accepted = new Map<string, number>();
  for (const rawPart of acceptEncoding.split(",")) {
    const [rawEncoding, ...rawParameters] = rawPart.trim().split(";");
    const encoding = rawEncoding?.trim().toLowerCase();
    if (!encoding) {
      continue;
    }

    const qParameter = rawParameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.toLowerCase().startsWith("q="));
    const qValue = qParameter ? Number.parseFloat(qParameter.slice(2)) : 1;
    accepted.set(encoding, Number.isFinite(qValue) ? qValue : 0);
  }

  const wildcardQuality = accepted.get("*");
  const brQuality = accepted.get("br") ?? wildcardQuality ?? 0;
  if (brQuality > 0) {
    return "br";
  }

  const gzipQuality = accepted.get("gzip") ?? wildcardQuality ?? 0;
  return gzipQuality > 0 ? "gzip" : undefined;
}

export function isHttpCompressionSkippableContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }

  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    mediaType.startsWith("image/") ||
    mediaType.startsWith("audio/") ||
    mediaType.startsWith("video/")
  ) {
    return true;
  }

  return (
    mediaType === "application/octet-stream" ||
    mediaType === "application/gzip" ||
    mediaType === "application/x-gzip" ||
    mediaType === "application/zip" ||
    mediaType === "application/x-zip-compressed" ||
    mediaType === "application/x-7z-compressed" ||
    mediaType === "application/x-rar-compressed" ||
    mediaType === "application/x-tar" ||
    mediaType === "application/x-bzip2" ||
    mediaType === "application/x-xz" ||
    mediaType === "application/zstd" ||
    mediaType === "font/woff" ||
    mediaType === "font/woff2"
  );
}

function appendVaryHeader(existingVary: string | undefined, value: string): string {
  if (!existingVary) {
    return value;
  }

  const values = existingVary.split(",").map((part) => part.trim().toLowerCase());
  return values.includes(value.toLowerCase()) ? existingVary : `${existingVary}, ${value}`;
}

function normalizeContentEncoding(contentEncoding: string | undefined): string | undefined {
  const normalizedEncoding = contentEncoding?.trim().toLowerCase();
  return normalizedEncoding && normalizedEncoding !== "identity" ? normalizedEncoding : undefined;
}

function makeAbsoluteRequestUrl(request: HttpServerRequest.HttpServerRequest): string {
  if (/^https?:\/\//i.test(request.originalUrl)) {
    return request.originalUrl;
  }

  const host = request.headers.host ?? "localhost";
  const path = request.originalUrl.startsWith("/")
    ? request.originalUrl
    : `/${request.originalUrl}`;
  return `http://${host}${path}`;
}

function makeRequestHeadersForDecodedBody(
  request: HttpServerRequest.HttpServerRequest,
  decodedBody: Uint8Array,
): Headers.Headers {
  return Headers.remove(
    Headers.set(request.headers, "content-length", decodedBody.byteLength.toString()),
    "content-encoding",
  );
}

function decodeHttpRequestBody(
  encoding: string,
  body: Uint8Array,
): Effect.Effect<Uint8Array, HttpCompressionError> {
  const buffer = Buffer.from(body);
  if (encoding === "gzip") {
    return Effect.tryPromise({
      try: () => gunzipAsync(buffer),
      catch: (cause) => new HttpCompressionError({ cause }),
    });
  }
  if (encoding === "br") {
    return Effect.tryPromise({
      try: () => brotliDecompressAsync(buffer),
      catch: (cause) => new HttpCompressionError({ cause }),
    });
  }
  return Effect.fail(
    new HttpCompressionError({ cause: `Unsupported content encoding: ${encoding}` }),
  );
}

export function decodeCompressedHttpRequest(
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<DecodedHttpRequestResult> {
  const encoding = normalizeContentEncoding(request.headers["content-encoding"]);
  if (!encoding) {
    return Effect.succeed({ _tag: "Request", request });
  }

  if (encoding !== "gzip" && encoding !== "br") {
    return Effect.succeed({
      _tag: "Response",
      response: HttpServerResponse.text("Unsupported Content-Encoding", { status: 415 }),
    });
  }

  return Effect.gen(function* () {
    const encodedBody = yield* request.arrayBuffer.pipe(
      Effect.map((body) => new Uint8Array(body)),
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!encodedBody) {
      return {
        _tag: "Response",
        response: HttpServerResponse.text("Invalid compressed request body", { status: 400 }),
      } satisfies DecodedHttpRequestResult;
    }

    const decodedBody = yield* decodeHttpRequestBody(encoding, encodedBody).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    if (!decodedBody) {
      return {
        _tag: "Response",
        response: HttpServerResponse.text("Invalid compressed request body", { status: 400 }),
      } satisfies DecodedHttpRequestResult;
    }

    const headers = makeRequestHeadersForDecodedBody(request, decodedBody);
    const decodedRequest = HttpServerRequest.fromWeb(
      new Request(makeAbsoluteRequestUrl(request), {
        method: request.method,
        headers: new globalThis.Headers(headers),
        body: decodedBody,
      }),
    ).modify({
      url: request.url,
      headers,
      remoteAddress: request.remoteAddress,
    });

    return {
      _tag: "Request",
      request: decodedRequest,
    } satisfies DecodedHttpRequestResult;
  });
}

function compressHttpResponseBody(
  encoding: HttpCompressionEncoding,
  body: Uint8Array,
  level: number,
): Effect.Effect<Uint8Array, HttpCompressionError> {
  const input = Buffer.from(body);
  if (encoding === "br") {
    return Effect.tryPromise({
      try: () =>
        brotliCompressAsync(input, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: Math.min(zlibConstants.BROTLI_MAX_QUALITY, level),
          },
        }),
      catch: (cause) => new HttpCompressionError({ cause }),
    });
  }

  return Effect.tryPromise({
    try: () =>
      gzipAsync(input, {
        level: Math.min(zlibConstants.Z_BEST_COMPRESSION, level),
      }),
    catch: (cause) => new HttpCompressionError({ cause }),
  });
}

export function compressHttpResponse(
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
  level: number = resolveHttpCompressionLevel(),
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  const responseBody = response.body;
  const contentLength =
    responseBody._tag === "Uint8Array" || responseBody._tag === "Stream"
      ? responseBody.contentLength
      : undefined;
  const contentType =
    responseBody._tag === "Uint8Array" || responseBody._tag === "Stream"
      ? responseBody.contentType
      : undefined;
  if (
    request.method === "HEAD" ||
    response.status < 200 ||
    response.status === 204 ||
    response.status === 304 ||
    response.headers["content-encoding"] !== undefined ||
    contentLength === undefined ||
    contentLength <= HTTP_COMPRESSION_MIN_BYTES ||
    isHttpCompressionSkippableContentType(contentType)
  ) {
    return Effect.succeed(response);
  }

  const encoding = selectHttpResponseCompressionEncoding(request.headers["accept-encoding"]);
  if (!encoding) {
    return Effect.succeed(response);
  }

  const responseBytes =
    responseBody._tag === "Uint8Array"
      ? Effect.succeed(responseBody.body)
      : responseBody._tag === "Stream"
        ? Stream.mkUint8Array(
            Stream.mapError(responseBody.stream, (cause) => new HttpCompressionError({ cause })),
          ).pipe(Effect.catch(() => Effect.succeed(null)))
        : Effect.succeed(null);

  return responseBytes.pipe(
    Effect.flatMap((body) => {
      if (!body) {
        return Effect.succeed(response);
      }

      return compressHttpResponseBody(encoding, body, level).pipe(
        Effect.map((compressedBody) =>
          HttpServerResponse.uint8Array(compressedBody, {
            status: response.status,
            statusText: response.statusText,
            cookies: response.cookies,
            contentType,
            headers: {
              ...response.headers,
              "content-encoding": encoding,
              vary: appendVaryHeader(response.headers.vary, "Accept-Encoding"),
            },
          }),
        ),
        Effect.catch(() => Effect.succeed(response)),
      );
    }),
  );
}

export function httpCompressionMiddleware<E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  HttpServerRequest.HttpServerRequest | Exclude<R, HttpServerRequest.HttpServerRequest>
> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const decodedRequest = yield* decodeCompressedHttpRequest(request);
    if (decodedRequest._tag === "Response") {
      return decodedRequest.response;
    }

    const response = yield* effect.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, decodedRequest.request),
    );
    return yield* compressHttpResponse(decodedRequest.request, response);
  });
}

export const httpCompressionMiddlewareLayer = HttpRouter.use((router) =>
  router.addGlobalMiddleware(httpCompressionMiddleware),
);

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
