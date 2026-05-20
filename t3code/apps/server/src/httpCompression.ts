import * as zlib from "node:zlib";
import { Readable } from "node:stream";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Data from "effect/Data";
import { HttpRouter, HttpServerResponse, HttpServerRequest } from "effect/unstable/http";

export class HttpCompressionError extends Data.TaggedError("HttpCompressionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Parse environment configuration for compression level
const envLevelStr = process.env.T3CODE_COMPRESSION_LEVEL;
const envLevel = envLevelStr ? parseInt(envLevelStr, 10) : undefined;

const brotliOptions = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]:
      envLevel !== undefined ? Math.max(0, Math.min(11, envLevel)) : 11,
  },
};

const gzipOptions = {
  level: envLevel !== undefined ? Math.max(-1, Math.min(9, envLevel)) : -1,
};

function isAlreadyCompressed(contentType: string): boolean {
  const mime = (contentType.toLowerCase().split(";")[0] ?? "").trim();

  // Skip images (except SVG)
  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    return true;
  }

  // Skip audio/video
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    return true;
  }

  // Skip archives & binary PDFs
  const excludedTypes = [
    "application/zip",
    "application/x-tar",
    "application/gzip",
    "application/x-gzip",
    "application/x-bzip2",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/pdf",
    "application/octet-stream",
  ];

  if (excludedTypes.includes(mime)) {
    return true;
  }

  return false;
}

function compressResponse(
  response: HttpServerResponse.HttpServerResponse,
  acceptEncoding: string,
) {
  const contentType = response.headers["content-type"] || "";
  if (isAlreadyCompressed(contentType)) {
    return Effect.succeed(response);
  }

  // Determine algorithm
  let encoding: "br" | "gzip" | null = null;
  const parts = acceptEncoding
    .toLowerCase()
    .split(",")
    .map((s) => s.trim());
  if (parts.some((p) => p.startsWith("br"))) {
    encoding = "br";
  } else if (parts.some((p) => p.startsWith("gzip"))) {
    encoding = "gzip";
  }

  if (!encoding) {
    return Effect.succeed(response);
  }

  const body = response.body;

  if (body._tag === "Uint8Array") {
    if (body.body.length <= 1024) {
      return Effect.succeed(response);
    }

    return Effect.try({
      try: () => {
        const compressed =
          encoding === "br"
            ? zlib.brotliCompressSync(body.body, brotliOptions)
            : zlib.gzipSync(body.body, gzipOptions);

        return HttpServerResponse.uint8Array(compressed, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            ...response.headers,
            "content-encoding": encoding!,
            "content-length": String(compressed.length),
          },
        });
      },
      catch: (err) => new HttpCompressionError({ message: String(err), cause: err }),
    }).pipe(
      Effect.catch((err) =>
        Effect.logWarning("Compression failed, sending uncompressed response", { err }).pipe(
          Effect.as(response),
        ),
      ),
    );
  }

  if (body._tag === "Stream") {
    try {
      const webReadable = Stream.toReadableStream(body.stream);
      const nodeReadable = Readable.fromWeb(webReadable as any);

      const compressionNodeStream =
        encoding === "br" ? zlib.createBrotliCompress(brotliOptions) : zlib.createGzip(gzipOptions);

      const compressedNodeStream = nodeReadable.pipe(compressionNodeStream);
      const compressedWebStream = Readable.toWeb(compressedNodeStream);

      const compressedStream = Stream.fromReadableStream({
        evaluate: () => compressedWebStream as ReadableStream<Uint8Array>,
        onError: (err) => new Error(`Stream compression failed: ${err}`),
      });

      const newHeaders: Record<string, string> = { ...response.headers, "content-encoding": encoding! };
      delete newHeaders["content-length"];

      return Effect.succeed(
        HttpServerResponse.stream(compressedStream, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        }),
      );
    } catch (err) {
      return Effect.logWarning(
        "Stream compression initialization failed, sending uncompressed response",
        { err },
      ).pipe(Effect.as(response));
    }
  }

  return Effect.succeed(response);
}

function decompressBuffer(buffer: Uint8Array, encoding: string): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const decompressFn = encoding === "br" ? zlib.brotliDecompress : zlib.gunzip;
    decompressFn(buffer, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(new Uint8Array(result.buffer, result.byteOffset, result.byteLength));
      }
    });
  });
}

function wrapDecompressedRequest(
  request: HttpServerRequest.HttpServerRequest,
  encoding: string,
): HttpServerRequest.HttpServerRequest {
  let arrayBufferPromise: Promise<ArrayBuffer> | null = null;
  const getDecompressedArrayBuffer = () => {
    if (!arrayBufferPromise) {
      arrayBufferPromise = Effect.runPromise(request.arrayBuffer)
        .then((buf: ArrayBuffer) => decompressBuffer(new Uint8Array(buf), encoding))
        .then(
          (decompressed) =>
            decompressed.buffer.slice(
              decompressed.byteOffset,
              decompressed.byteOffset + decompressed.byteLength,
            ) as ArrayBuffer,
        );
    }
    return arrayBufferPromise;
  };

  const decompressedArrayBuffer = Effect.tryPromise({
    try: () => getDecompressedArrayBuffer(),
    catch: (cause) => new HttpCompressionError({ message: String(cause), cause }),
  });

  const decompressedText = decompressedArrayBuffer.pipe(
    Effect.map((buf) => new TextDecoder().decode(buf)),
  );

  const decompressedJson = decompressedText.pipe(
    Effect.flatMap((txt) =>
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      Effect.try({
        try: () => JSON.parse(txt),
        catch: (cause) => new HttpCompressionError({ message: String(cause), cause }),
      }),
    ),
  );

  const decompressedStream = Stream.fromEffect(
    decompressedArrayBuffer.pipe(Effect.map((buf) => new Uint8Array(buf))),
  );

  const newHeaders = { ...request.headers };
  delete newHeaders["content-encoding"];
  delete newHeaders["content-length"];

  const proxy = new Proxy(request, {
    get(target, prop, receiver) {
      if (prop === "headers") {
        return newHeaders;
      }
      if (prop === "arrayBuffer") {
        return decompressedArrayBuffer;
      }
      if (prop === "text") {
        return decompressedText;
      }
      if (prop === "json") {
        return decompressedJson;
      }
      if (prop === "stream") {
        return decompressedStream;
      }
      if (prop === "modify") {
        return (options: any) => wrapDecompressedRequest(target.modify(options), encoding);
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });

  return proxy;
}

export const httpCompressionLayer = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      // Request Decompression
      const contentEncoding = request.headers["content-encoding"]?.toLowerCase() || "";
      let activeRequest = request;

      if (contentEncoding === "gzip" || contentEncoding === "br") {
        activeRequest = wrapDecompressedRequest(request, contentEncoding);
      }

      // Execute route handler with potentially wrapped decompressed request
      const response = yield* httpEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, activeRequest),
      );

      // Response Compression
      const acceptEncoding = request.headers["accept-encoding"] || "";
      if (!acceptEncoding) {
        return response;
      }

      return yield* compressResponse(response, acceptEncoding);
    }),
  { global: true },
);
