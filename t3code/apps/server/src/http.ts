import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpMiddleware,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import { HttpServerError, RequestParseError } from "effect/unstable/http/HttpServerError";
import {
  constants,
  brotliCompressSync,
  brotliDecompressSync,
  gunzipSync,
  gzipSync,
} from "node:zlib";

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
const DEFAULT_HTTP_COMPRESSION_LEVEL = 4;
const DEFAULT_HTTP_COMPRESSION_THRESHOLD_BYTES = 1024;
const HTTP_BR_CONTENT_TYPES = new Set(
  [
    "application/gzip",
    "application/x-gzip",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/x-bzip2",
    "application/x-xz",
    "application/zstd",
    "application/x-zstd",
    "application/epub+zip",
    "application/vnd.rar",
  ],
);
const HTTP_COMPRESSED_CONTENT_TYPE_PREFIXES = ["image/", "audio/", "video/"]; 
type ContentEncoding = "br" | "gzip";

const parseEncodingHeader = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

const parseAcceptEncoding = (value: string | undefined): ContentEncoding | undefined => {
  const values = parseEncodingHeader(value).map((entry) => {
    const [encodingPart, ...params] = entry.split(";");
    const qParam = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    return { encoding: encodingPart, quality: Number.isFinite(q) ? q : 0 };
  });

  if (values.some((entry) => entry.encoding === "identity" && entry.quality === 0)) {
    return undefined;
  }

  const supportsBr = values.some((entry) => entry.encoding === "br" && entry.quality > 0);
  if (supportsBr) {
    return "br";
  }

  const supportsGzip = values.some((entry) => entry.encoding === "gzip" && entry.quality > 0);
  if (supportsGzip) {
    return "gzip";
  }

  const supportsAny = values.some((entry) => entry.encoding === "*" && entry.quality > 0);
  return supportsAny ? "gzip" : undefined;
};

const parseIncomingEncoding = (value: string | undefined) => {
  const encodings = parseEncodingHeader(value).map((encoding) => encoding.split(";")[0]?.trim());
  if (encodings.length === 0) {
    return undefined;
  }
  if (encodings.length !== 1) {
    return "unsupported";
  }
  const encoding = encodings[0] ?? "";
  if (encoding === "identity" || encoding.length === 0) {
    return undefined;
  }
  return encoding === "gzip" || encoding === "br" ? encoding : "unsupported";
};

const normalizeContentType = (contentType: string | undefined) =>
  contentType?.split(";")[0]?.trim().toLowerCase();

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

const shouldSkipCompressedContentType = (contentType: string | undefined) => {
  const normalizedContentType = normalizeContentType(contentType);
  if (!normalizedContentType) return false;

  if (HTTP_COMPRESSED_CONTENT_TYPE_PREFIXES.some((prefix) => normalizedContentType.startsWith(prefix))) {
    return true;
  }

  return HTTP_BR_CONTENT_TYPES.has(normalizedContentType);
};

const hasRequestBody = (request: HttpServerRequest.HttpServerRequest): boolean => {
  const contentLength = Number.parseInt(request.headers["content-length"] ?? "", 10);
  return (
    (Number.isFinite(contentLength) ? contentLength > 0 : false) ||
    request.headers["transfer-encoding"] !== undefined
  );
};

const appendAcceptEncodingVary = (response: HttpServerResponse.HttpServerResponse) => {
  const existingVary = Headers.get(response.headers, "vary");
  if (Option.isNone(existingVary)) {
    return HttpServerResponse.setHeader(response, "vary", "accept-encoding");
  }

  const entries = existingVary.value
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (entries.includes("accept-encoding")) {
    return response;
  }

  return HttpServerResponse.setHeader(response, "vary", `${existingVary.value}, accept-encoding`);
};

const withDecompressedRequestBody = (
  request: HttpServerRequest.HttpServerRequest,
  encoding: Exclude<ReturnType<typeof parseIncomingEncoding>, "unsupported" | undefined>,
) =>
  Effect.gen(function* () {
    const arrayBuffer = yield* request.arrayBuffer;
    const decompressed =
      encoding === "gzip"
        ? gunzipSync(new Uint8Array(arrayBuffer))
        : brotliDecompressSync(new Uint8Array(arrayBuffer));
    const text = new TextDecoder().decode(decompressed);

    const mutableRequest = request as {
      textEffect?: Effect.Effect<string, HttpServerError, never> | undefined;
      arrayBufferEffect?: Effect.Effect<ArrayBuffer, HttpServerError, never> | undefined;
    };
    mutableRequest.textEffect = Effect.succeed(text);
    mutableRequest.arrayBufferEffect = Effect.succeed(
      decompressed.byteOffset === 0 && decompressed.byteLength === decompressed.buffer.byteLength
        ? decompressed.buffer
        : decompressed.buffer.slice(
            decompressed.byteOffset,
            decompressed.byteOffset + decompressed.byteLength,
          ),
    );
  });

const withCompressedResponse = (
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
  options: {
    readonly thresholdBytes: number;
    readonly level: number;
  },
) =>
  Effect.gen(function* () {
    if (response.body._tag !== "Uint8Array" || response.body.body.length === 0) {
      return response;
    }

    if (Headers.has(response.headers, "content-encoding")) {
      return response;
    }

    const threshold = clamp(
      Number.isFinite(options.thresholdBytes)
        ? options.thresholdBytes
        : DEFAULT_HTTP_COMPRESSION_THRESHOLD_BYTES,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if (response.body.body.length <= threshold) {
      return response;
    }

    const responseContentType =
      response.body.contentType ??
      Option.getOrElse(
        Headers.get(response.headers, "content-type"),
        () => undefined,
      );
    if (shouldSkipCompressedContentType(responseContentType)) {
      return response;
    }

    const acceptedEncoding = parseAcceptEncoding(request.headers["accept-encoding"]);
    if (acceptedEncoding === undefined) {
      return response;
    }

    const level = clamp(
      Number.isFinite(options.level) ? options.level : DEFAULT_HTTP_COMPRESSION_LEVEL,
      1,
      11,
    );
    const compressed =
      acceptedEncoding === "gzip"
        ? gzipSync(response.body.body, {
            level: clamp(level, 1, 9),
          })
        : brotliCompressSync(response.body.body, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: clamp(level, 1, 11),
            },
          });

    const compressedResponse = HttpServerResponse.setBody(
      response,
      HttpBody.uint8Array(new Uint8Array(compressed), response.body.contentType),
    );
    return appendAcceptEncodingVary(
      HttpServerResponse.setHeader(compressedResponse, "content-encoding", acceptedEncoding),
    );
  });

export const httpCompressionLayer = HttpRouter.use((router) =>
  router.addGlobalMiddleware(
    HttpMiddleware.make((httpApp) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        const compression = {
          thresholdBytes: Number.isFinite(config.httpCompressionThresholdBytes)
            ? config.httpCompressionThresholdBytes
            : DEFAULT_HTTP_COMPRESSION_THRESHOLD_BYTES,
          level: Number.isFinite(config.httpCompressionLevel)
            ? config.httpCompressionLevel
            : DEFAULT_HTTP_COMPRESSION_LEVEL,
        };
        if (!hasRequestBody(request)) {
          return yield* HttpEffect.withPreResponseHandler(httpApp, (req, response) =>
            withCompressedResponse(req, response, compression),
          );
        }

        const requestEncoding = parseIncomingEncoding(request.headers["content-encoding"]);
        if (requestEncoding === "unsupported") {
          return yield* new HttpServerError({
            reason: new RequestParseError({
              request,
              description: "Unsupported content-encoding.",
            }),
          });
        }

        if (requestEncoding !== undefined) {
          yield* withDecompressedRequestBody(request, requestEncoding);
        }

        return yield* HttpEffect.withPreResponseHandler(httpApp, (req, response) =>
          withCompressedResponse(req, response, compression),
        );
      }),
    ),
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
