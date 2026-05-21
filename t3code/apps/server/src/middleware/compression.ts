import * as Effect from "effect/Effect";
import * as zlib from "node:zlib";

const SUPPORTED_ENCODINGS = ["br", "gzip", "deflate"] as const;

function acceptsEncoding(acceptEncoding: string | null): string | null {
  if (!acceptEncoding) return null;
  for (const enc of SUPPORTED_ENCODINGS) {
    if (acceptEncoding.includes(enc)) return enc;
  }
  return null;
}

function compressBuffer(buffer: Buffer, encoding: string): Effect.Effect<Buffer, Error> {
  return Effect.async<Buffer, Error>((resume) => {
    if (encoding === "br") {
      zlib.brotliCompress(buffer, (err, result) => {
        if (err) resume(Effect.fail(err));
        else resume(Effect.succeed(result));
      });
    } else if (encoding === "gzip") {
      zlib.gzip(buffer, (err, result) => {
        if (err) resume(Effect.fail(err));
        else resume(Effect.succeed(result));
      });
    } else {
      zlib.deflate(buffer, (err, result) => {
        if (err) resume(Effect.fail(err));
        else resume(Effect.succeed(result));
      });
    }
  });
}

export function compressResponse(headers: Record<string, string>, body: Buffer) {
  return Effect.gen(function* () {
    const encoding = acceptsEncoding(headers["accept-encoding"] ?? null);
    if (!encoding) return { headers, body };

    const compressed = yield* compressBuffer(body, encoding);
    return {
      headers: {
        ...headers,
        "content-encoding": encoding,
        "vary": "accept-encoding",
        "content-length": String(compressed.length),
      },
      body: compressed,
    };
  });
}
