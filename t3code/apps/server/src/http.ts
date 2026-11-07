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
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";
import { createGzip, createBrotliCompress, createGunzip, createBrotliDecompress, constants } from "node:zlib";
import { Buffer } from "node:buffer";

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
const COMPRESSION_THRESHOLD = 1024;
const COMPRESSIBLE_CONTENT_TYPES = new Set([
  "text/html",
  "text/css",
  "text/plain",
  "text/xml",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/rss+xml",
  "application/atom+xml",
  "image/svg+xml",
]);

function getCompressionConfig() {
  return {
    gzipLevel: Math.min(9, Math.max(1, parseInt(process.env.COMPRESSION_GZIP_LEVEL || "9"))),
    brotliQuality: Math.min(11, Math.max(0, parseInt(process.env.COMPRESSION_BROTLI_QUALITY || "11"))),
    threshold: Math.max(0, parseInt(process.env.COMPRESSION_THRESHOLD || "1024")),
  };
}

function parseAcceptEncoding(header: string | undefined): { gzip: boolean; br: boolean } {
  if (!header) return { gzip: false, br: false };
  const encodings = header.toLowerCase().split(",").map((e) => e.trim().split(";")[0]);
  return { br: encodings.includes("br"), gzip: encodings.includes("gzip") };
}

function isCompressibleContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  return COMPRESSIBLE_CONTENT_TYPES.has(mimeType);
}

async function compressBuffer(buffer: Buffer, encoding: "br" | "gzip"): Promise<Buffer> {
  const config = getCompressionConfig();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = encoding === "br"
      ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: config.brotliQuality } })
      : createGzip({ level: config.gzipLevel });
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end(buffer);
  });
}

async function decompressBuffer(buffer: Buffer, encoding: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = encoding.toLowerCase() === "br" ? createBrotliDecompress()
      : encoding.toLowerCase() === "gzip" ? createGunzip()
      : null;
    if (!stream) { reject(new Error(`Unsupported encoding: ${encoding}`)); return; }
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    stream.end(buffer);
  });
}

async function compressResponseIfNeeded(
  response: any,
  acceptEncodingHeader: string | undefined,
): Promise<any> {
  const config = getCompressionConfig();
  const acceptEncoding = parseAcceptEncoding(acceptEncodingHeader);
  if (!acceptEncoding.br && !acceptEncoding.gzip) return response;

  const contentType = response.headers?.["content-type"];
  if (!isCompressibleContentType(contentType)) return response;

  const body = response.body;
  if (!body) return response;

  let buffer: Buffer;
  if (typeof body === "string") buffer = Buffer.from(body, "utf-8");
  else if (body instanceof Uint8Array) buffer = Buffer.from(body);
  else return response;

  if (buffer.length < config.threshold) return response;

  const encoding = acceptEncoding.br ? "br" : "gzip";
  try {
    const compressed = await compressBuffer(buffer, encoding);
    return HttpServerResponse.uint8Array(compressed, {
      status: response.status,
      contentType,
      headers: {
        ...response.headers,
        "content-encoding": encoding,
        "vary": "Accept-Encoding",
        "content-length": compressed.length.toString(),
      },
    });
  } catch {
    return response;
  }
}

function withCompression(responseEffect: any, request: any): any {
  return Effect.flatMap(responseEffect, (response) =>
    Effect.promise(() =>
      compressResponseIfNeeded(response, request.headers?.["accept-encoding"])
    )
  );
}

export async function decompressRequestBody(request: any): Promise<Buffer | null> {
  const contentEncoding = request.headers?.["content-encoding"];
  if (!contentEncoding) return null;
  try {
    const body = await request.arrayBuffer();
    return await decompressBuffer(Buffer.from(body), contentEncoding);
  } catch (error) {
    console.error("Failed to decompress request body:", error);
    return null;
  }
}

export function compressedResponse(
  response: typeof HttpServerResponse.HttpServerResponse,
  request: typeof HttpServerRequest.HttpServerRequest,
): Effect.Effect<typeof HttpServerResponse.HttpServerResponse, never, never> {
  return Effect.tryPromise({
    try: () => compressResponseIfNeeded(response, request.headers?.["accept-encoding"]),
    catch: () => response as never,
  });
}

export const withCompression = <E, R>(
  handler: Effect.Effect<typeof HttpServerResponse.HttpServerResponse, E, R>,
): Effect.Effect<typeof HttpServerResponse.HttpServerResponse, E, R | typeof HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const response = yield* handler;
    return yield* compressedResponse(response, request);
  });

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
  withCompression(Effect.gen(function* () {
    const descriptor = yield* Effect.service(ServerEnvironment).pipe(
      Effect.flatMap((serverEnvironment) => serverEnvironment.getDescriptor),
    );
    return HttpServerResponse.jsonUnsafe(descriptor, {
      status: 200,
      headers: browserApiCorsHeaders,
    });
  })),
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  withCompression(Effect.gen(function* () {
    yield* requireAuthenticatedRequest;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;

    // Decompress request body if Content-Encoding is set
    const decompressedBody = yield* Effect.tryPromise({
      try: () => decompressRequestBody(request),
      catch: () => null as Buffer | null,
    });
    const bodyJson = decompressedBody
      ? cast<unknown, OtlpTracer.TraceData>(JSON.parse(decompressedBody.toString("utf-8")))
      : cast<unknown, OtlpTracer.TraceData>(yield* request.json);

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
  }).pipe(Effect.catchTag("AuthError", respondToAuthError))),
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
  withCompression(Effect.gen(function* () {
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
  })),
);
