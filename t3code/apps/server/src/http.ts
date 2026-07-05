import Mime from "@effect/platform-node/Mime";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { cast } from "effect/Function";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as ZlibConstants,
  gunzipSync,
  gzipSync,
} from "node:zlib";
import {
  HttpServerError,
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
export const HTTP_COMPRESSION_MIN_BYTES = 1024;
export const HTTP_COMPRESSION_LEVEL_ENV = "T3_HTTP_COMPRESSION_LEVEL";
const DEFAULT_HTTP_COMPRESSION_LEVEL = 6;
const COMPRESSED_CONTENT_TYPES = new Set([
  "application/gzip",
  "application/pdf",
  "application/vnd.rar",
  "application/wasm",
  "application/x-7z-compressed",
  "application/x-bzip2",
  "application/x-gzip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/zip",
  "application/zstd",
]);
const jsonTextDecoder = new TextDecoder();

export type HttpCompressionEncoding = "br" | "gzip";

export interface CompressedResponseDecision {
  readonly body: Uint8Array;
  readonly encoding: HttpCompressionEncoding | null;
  readonly headers: Record<string, string>;
}

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

function getHeaderValue(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  return (
    headers[name] ??
    headers[name.toLowerCase()] ??
    headers[name.toUpperCase()] ??
    Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  );
}

function mergeVaryAcceptEncoding(value: string | undefined): string {
  if (!value) {
    return "Accept-Encoding";
  }
  const entries = value.split(",").map((entry) => entry.trim());
  return entries.some((entry) => entry.toLowerCase() === "accept-encoding")
    ? value
    : `${value}, Accept-Encoding`;
}

function parseAcceptEncodingQuality(value: string | undefined): Map<string, number> {
  const qualities = new Map<string, number>();
  if (!value) {
    return qualities;
  }

  for (const rawEntry of value.split(",")) {
    const [rawEncoding, ...rawParameters] = rawEntry.split(";");
    const encoding = rawEncoding?.trim().toLowerCase();
    if (!encoding) {
      continue;
    }
    const qualityParameter = rawParameters
      .map((parameter) => parameter.trim().toLowerCase())
      .find((parameter) => parameter.startsWith("q="));
    const quality =
      qualityParameter === undefined ? 1 : Number(qualityParameter.slice("q=".length));
    qualities.set(encoding, Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0);
  }
  return qualities;
}

export function resolveAcceptedCompressionEncoding(
  headers: Readonly<Record<string, string | undefined>>,
): HttpCompressionEncoding | null {
  const qualities = parseAcceptEncodingQuality(getHeaderValue(headers, "accept-encoding"));
  const wildcardQuality = qualities.get("*") ?? 0;
  const brotliQuality = qualities.get("br") ?? wildcardQuality;
  const gzipQuality = qualities.get("gzip") ?? wildcardQuality;
  if (brotliQuality > 0) {
    return "br";
  }
  return gzipQuality > 0 ? "gzip" : null;
}

export function shouldSkipCompressionForContentType(contentType: string): boolean {
  const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalizedContentType) {
    return false;
  }
  return (
    normalizedContentType.startsWith("audio/") ||
    normalizedContentType.startsWith("font/") ||
    normalizedContentType.startsWith("image/") ||
    normalizedContentType.startsWith("video/") ||
    normalizedContentType.endsWith("+zip") ||
    COMPRESSED_CONTENT_TYPES.has(normalizedContentType)
  );
}

export function resolveHttpCompressionLevel(
  value: string | undefined = process.env[HTTP_COMPRESSION_LEVEL_ENV],
): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_HTTP_COMPRESSION_LEVEL;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return DEFAULT_HTTP_COMPRESSION_LEVEL;
  }
  return Math.min(11, Math.max(0, parsed));
}

export function compressResponseBody(
  body: Uint8Array,
  encoding: HttpCompressionEncoding,
  level = resolveHttpCompressionLevel(),
): Uint8Array {
  if (encoding === "br") {
    return brotliCompressSync(body, {
      params: {
        [ZlibConstants.BROTLI_PARAM_QUALITY]: level,
      },
    });
  }
  return gzipSync(body, { level: Math.min(9, level) });
}

export function resolveCompressedResponse(input: {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly requestHeaders: Readonly<Record<string, string | undefined>>;
  readonly responseHeaders?: Readonly<Record<string, string | undefined>>;
}): CompressedResponseDecision {
  const responseHeaders = { ...(input.responseHeaders ?? {}) };
  if (
    input.body.byteLength <= HTTP_COMPRESSION_MIN_BYTES ||
    shouldSkipCompressionForContentType(input.contentType)
  ) {
    return { body: input.body, encoding: null, headers: responseHeaders as Record<string, string> };
  }

  const encoding = resolveAcceptedCompressionEncoding(input.requestHeaders);
  if (!encoding) {
    return { body: input.body, encoding: null, headers: responseHeaders as Record<string, string> };
  }

  return {
    body: compressResponseBody(input.body, encoding),
    encoding,
    headers: {
      ...responseHeaders,
      "Content-Encoding": encoding,
      Vary: mergeVaryAcceptEncoding(responseHeaders.Vary ?? responseHeaders.vary),
    },
  };
}

export function resolveRequestContentEncoding(
  headers: Readonly<Record<string, string | undefined>>,
): HttpCompressionEncoding | null {
  const encoding = getHeaderValue(headers, "content-encoding")?.split(",")[0]?.trim().toLowerCase();
  return encoding === "br" || encoding === "gzip" ? encoding : null;
}

export function decompressRequestBody(
  body: Uint8Array,
  encoding: HttpCompressionEncoding | null,
): Uint8Array {
  if (encoding === "br") {
    return brotliDecompressSync(body);
  }
  if (encoding === "gzip") {
    return gunzipSync(body);
  }
  return body;
}

export function parseRequestJsonBody(
  body: Uint8Array,
  encoding: HttpCompressionEncoding | null,
): unknown {
  return JSON.parse(jsonTextDecoder.decode(decompressRequestBody(body, encoding)));
}

function readJsonRequestBody(request: HttpServerRequest.HttpServerRequest) {
  const encoding = resolveRequestContentEncoding(request.headers);
  if (!encoding) {
    return request.json;
  }

  return Effect.flatMap(request.arrayBuffer, (body) =>
    Effect.try({
      try: () => parseRequestJsonBody(new Uint8Array(body), encoding),
      catch: (cause) =>
        new HttpServerError.RequestParseError({
          request,
          description: `Failed to decode ${encoding} request body`,
          cause,
        }),
    }),
  );
}

export function compressHttpServerResponse(
  request: HttpServerRequest.HttpServerRequest,
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse {
  if (
    request.method === "HEAD" ||
    response.status === 204 ||
    response.status === 304 ||
    getHeaderValue(response.headers, "content-encoding") !== undefined ||
    response.body._tag !== "Uint8Array"
  ) {
    return response;
  }

  const compressedResponse = resolveCompressedResponse({
    body: response.body.body,
    contentType: response.body.contentType,
    requestHeaders: request.headers,
    responseHeaders: response.headers,
  });
  if (!compressedResponse.encoding) {
    return response;
  }

  return HttpServerResponse.uint8Array(compressedResponse.body, {
    status: response.status,
    statusText: response.statusText,
    contentType: response.body.contentType,
    headers: compressedResponse.headers,
    cookies: response.cookies,
  });
}

export const httpCompressionMiddleware = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  R | HttpServerRequest.HttpServerRequest
> =>
  Effect.withFiber((fiber) => {
    const request = Context.getUnsafe(fiber.context, HttpServerRequest.HttpServerRequest);
    return Effect.map(httpApp, (response) => compressHttpServerResponse(request, response));
  });

export const compressionRouteLayer = HttpRouter.middleware(httpCompressionMiddleware, {
  global: true,
});

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
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(yield* readJsonRequestBody(request));

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
      const compressedIndex = resolveCompressedResponse({
        body: indexData,
        contentType: "text/html; charset=utf-8",
        requestHeaders: request.headers,
      });
      return HttpServerResponse.uint8Array(compressedIndex.body, {
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: compressedIndex.headers,
      });
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const data = yield* fileSystem
      .readFile(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!data) {
      return HttpServerResponse.text("Internal Server Error", { status: 500 });
    }

    const compressedResponse = resolveCompressedResponse({
      body: data,
      contentType,
      requestHeaders: request.headers,
    });
    return HttpServerResponse.uint8Array(compressedResponse.body, {
      status: 200,
      contentType,
      headers: compressedResponse.headers,
    });
  }),
);
