import * as zlib from "node:zlib";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export class HttpCompressionError extends Data.TaggedError("HttpCompressionError")<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

const MIN_COMPRESSIBLE_BYTES = 1024;

function compressionLevel() {
  const configured = Number.parseInt(process.env.T3CODE_COMPRESSION_LEVEL ?? "", 10);
  return Number.isFinite(configured) ? configured : undefined;
}

function gzipOptions(): zlib.ZlibOptions {
  const level = compressionLevel();
  return {
    level:
      level === undefined ? zlib.constants.Z_DEFAULT_COMPRESSION : Math.max(-1, Math.min(9, level)),
  };
}

function brotliOptions(): zlib.BrotliOptions {
  const level = compressionLevel();
  return {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]:
        level === undefined ? 5 : Math.max(0, Math.min(11, level)),
    },
  };
}

export function selectResponseEncoding(acceptEncoding: string): "br" | "gzip" | undefined {
  const accepted = acceptEncoding
    .toLowerCase()
    .split(",")
    .map((encoding) => encoding.trim());

  if (accepted.some((encoding) => encoding === "br" || encoding.startsWith("br;"))) {
    return "br";
  }
  if (accepted.some((encoding) => encoding === "gzip" || encoding.startsWith("gzip;"))) {
    return "gzip";
  }
  return undefined;
}

export function isAlreadyCompressedContentType(contentType: string | undefined): boolean {
  const mime = (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (!mime) {
    return false;
  }
  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    return true;
  }
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    return true;
  }
  return new Set([
    "application/gzip",
    "application/octet-stream",
    "application/pdf",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-bzip2",
    "application/x-gzip",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/zip",
    "font/otf",
    "font/ttf",
    "font/woff",
    "font/woff2",
  ]).has(mime);
}

function compressBytes(
  bytes: Uint8Array,
  encoding: "br" | "gzip",
): Effect.Effect<Uint8Array, HttpCompressionError> {
  return Effect.try({
    try: () =>
      encoding === "br"
        ? zlib.brotliCompressSync(bytes, brotliOptions())
        : zlib.gzipSync(bytes, gzipOptions()),
    catch: (cause) =>
      new HttpCompressionError({
        cause,
        message: "Failed to compress HTTP response body",
      }),
  });
}

export function decompressBytes(
  bytes: Uint8Array,
  encoding: "br" | "gzip",
): Effect.Effect<Uint8Array, HttpCompressionError> {
  return Effect.try({
    try: () => (encoding === "br" ? zlib.brotliDecompressSync(bytes) : zlib.gunzipSync(bytes)),
    catch: (cause) =>
      new HttpCompressionError({
        cause,
        message: "Failed to decompress HTTP request body",
      }),
  });
}

export function compressResponse(
  response: HttpServerResponse.HttpServerResponse,
  acceptEncoding: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  const encoding = selectResponseEncoding(acceptEncoding);
  if (!encoding || response.headers["content-encoding"]) {
    return Effect.succeed(response);
  }
  if (isAlreadyCompressedContentType(response.headers["content-type"])) {
    return Effect.succeed(response);
  }

  if (response.body._tag === "Uint8Array") {
    const body = response.body.body;
    if (body.byteLength <= MIN_COMPRESSIBLE_BYTES) {
      return Effect.succeed(response);
    }
    return compressBytes(body, encoding).pipe(
      Effect.map((compressed) =>
        HttpServerResponse.uint8Array(compressed, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            ...response.headers,
            "content-encoding": encoding,
            "content-length": String(compressed.byteLength),
          },
        }),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("HTTP response compression failed", { cause }).pipe(Effect.as(response)),
      ),
    );
  }

  return Effect.succeed(response);
}

function wrapDecompressedRequest(
  request: HttpServerRequest.HttpServerRequest,
  encoding: "br" | "gzip",
): HttpServerRequest.HttpServerRequest {
  let arrayBufferPromise: Promise<ArrayBuffer> | undefined;
  const getDecompressedArrayBuffer = () => {
    arrayBufferPromise ??= Effect.runPromise(request.arrayBuffer)
      .then((arrayBuffer) =>
        Effect.runPromise(decompressBytes(new Uint8Array(arrayBuffer), encoding)),
      )
      .then((decompressed) => {
        const copy = new Uint8Array(decompressed.byteLength);
        copy.set(decompressed);
        return copy.buffer;
      });
    return arrayBufferPromise;
  };

  const arrayBuffer = Effect.tryPromise({
    try: () => getDecompressedArrayBuffer(),
    catch: (cause) =>
      new HttpCompressionError({
        cause,
        message: "Failed to read decompressed HTTP request body",
      }),
  });
  const text = arrayBuffer.pipe(Effect.map((bodyBuffer) => new TextDecoder().decode(bodyBuffer)));
  const json = text.pipe(
    Effect.flatMap((bodyText) =>
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      Effect.try({
        try: () => JSON.parse(bodyText),
        catch: (cause) =>
          new HttpCompressionError({
            cause,
            message: "Failed to parse decompressed JSON request body",
          }),
      }),
    ),
  );
  const stream = Stream.fromEffect(
    arrayBuffer.pipe(Effect.map((bodyBuffer) => new Uint8Array(bodyBuffer))),
  );
  const headers = { ...request.headers };
  delete headers["content-encoding"];
  delete headers["content-length"];

  return new Proxy(request, {
    get(target, property, receiver) {
      if (property === "headers") {
        return headers;
      }
      if (property === "arrayBuffer") {
        return arrayBuffer;
      }
      if (property === "text") {
        return text;
      }
      if (property === "json") {
        return json;
      }
      if (property === "stream") {
        return stream;
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const httpCompressionLayer = HttpRouter.middleware(
  (handler) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const contentEncoding = request.headers["content-encoding"]?.toLowerCase();
      const activeRequest =
        contentEncoding === "br" || contentEncoding === "gzip"
          ? wrapDecompressedRequest(request, contentEncoding)
          : request;

      const response = yield* handler.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, activeRequest),
      );
      return yield* compressResponse(response, request.headers["accept-encoding"] ?? "");
    }),
  { global: true },
);
