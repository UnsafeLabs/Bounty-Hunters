import * as Effect from "effect/Effect";
import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Stream from "effect/Stream";
import * as zlib from "node:zlib";

const MIN_COMPRESS_SIZE = 1024;

const COMPRESSIBLE_TYPES = [
  "text/",
  "application/json",
  "application/javascript",
  "application/xml",
  "application/graphql-response+json",
  "application/ld+json",
];

function isCompressible(contentType: string): boolean {
  return COMPRESSIBLE_TYPES.some((t) => contentType.startsWith(t));
}

function getAcceptedEncoding(acceptEncoding: string | null): "br" | "gzip" | null {
  if (!acceptEncoding) return null;
  const lower = acceptEncoding.toLowerCase();
  if (lower.includes("br")) return "br";
  if (lower.includes("gzip")) return "gzip";
  return null;
}

function compressBuffer(input: Buffer, encoding: "br" | "gzip"): Buffer {
  if (encoding === "br") {
    return zlib.brotliCompressSync(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } });
  }
  return zlib.gzipSync(input, { level: 6 });
}

export const compressionMiddleware = HttpRouter.middleware(
  (app: Effect.Effect<HttpServerResponse.HttpServerResponse>) =>
    Effect.flatMap(Effect.request(), (req) =>
      Effect.flatMap(app, (response) => {
        const contentType =
          response.headers?.["content-type"] ?? response.headers?.["Content-Type"] ?? "";
        const contentLength =
          Number(response.headers?.["content-length"] ?? response.headers?.["Content-Length"] ?? 0);
        const acceptEncoding = req.headers?.["accept-encoding"] as string | undefined;

        if (
          !isCompressible(contentType) ||
          contentLength < MIN_COMPRESS_SIZE ||
          contentLength === 0
        ) {
          return Effect.succeed(response);
        }

        const encoding = getAcceptedEncoding(acceptEncoding ?? null);
        if (!encoding) return Effect.succeed(response);

        return Effect.map(
          Effect.promise(() =>
            response.body
              ? Stream.runCollect(response.body).pipe(
                  Stream.map((chunk) => compressBuffer(Buffer.from(chunk), encoding)),
                  Stream.runCollect
                )
              : Effect.succeed([] as readonly Uint8Array[])
          ),
          (compressedBody) =>
            HttpServerResponse.uint8Array(Buffer.concat(compressedBody as Uint8Array[]), {
              status: response.status ?? 200,
              headers: {
                ...response.headers,
                "content-encoding": encoding,
                "content-length": String(
                  (compressedBody as Uint8Array[]).reduce((sum, c) => sum + c.length, 0)
                ),
                vary: "Accept-Encoding",
              },
            })
        );
      })
    ),
);
