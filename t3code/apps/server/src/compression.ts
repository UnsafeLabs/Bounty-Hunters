import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as HttpBody from "effect/unstable/http/HttpBody";

const COMPRESSIBLE_TYPES = [
  "text/", "application/json", "application/javascript",
  "application/xml", "application/xhtml+xml",
  "application/atom+xml", "application/rss+xml",
];

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".avif", ".apng", ".bmp",
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".zst",
  ".mp3", ".mp4", ".m4a", ".m4v", ".avi", ".mov", ".wmv", ".flv",
  ".webm", ".ogg", ".wav", ".flac", ".aac",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".woff", ".woff2", ".eot", ".ttf", ".otf",
  ".wasm",
]);

export const MIN_COMPRESS_LENGTH = 1024;

export type AcceptEncodings = { readonly br: boolean; readonly gzip: boolean };

export const parseAcceptEncoding = (header: string | null): AcceptEncodings => {
  if (!header) return { br: false, gzip: false };
  const encodings = header.toLowerCase().split(",").map((s) => {
    const part = s.trim();
    const q = part.indexOf(";");
    return q === -1 ? part : part.slice(0, q).trim();
  });
  return {
    br: encodings.includes("br"),
    gzip: encodings.includes("gzip"),
  };
};

export const isCompressibleType = (contentType: string | undefined): boolean => {
  if (!contentType) return true;
  const lower = contentType.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return false;
  }
  return COMPRESSIBLE_TYPES.some((p) => lower.startsWith(p));
};

export const compressSync = (
  data: Uint8Array,
  encoding: "br" | "gzip",
  level: number,
): Uint8Array => {
  const zlib = require("node:zlib");
  if (encoding === "br") {
    return zlib.brotliCompressSync(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: Math.min(Math.max(Math.round(level), 0), 11),
      },
    });
  }
  return zlib.gzipSync(data, { level: Math.min(Math.max(Math.round(level), -1), 9) });
};

export const decompressSync = (data: Uint8Array, encoding: string): Uint8Array => {
  const zlib = require("node:zlib");
  switch (encoding) {
    case "gzip": case "x-gzip": return zlib.gunzipSync(data);
    case "br": return zlib.brotliDecompressSync(data);
    default: return data;
  }
};

const compressionLevel = Config.number("T3CODE_COMPRESSION_LEVEL").pipe(
  Config.withDefault(6),
  Config.map((n) => Math.min(Math.max(Math.round(n), 0), 11)),
);

export const compressionLayer = HttpRouter.middleware()(
  Effect.gen(function* () {
    const level = yield* compressionLevel;

    return (effect: Effect.Effect<HttpServerResponse.HttpServerResponse>) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* effect;

        if (response.body._tag !== "Uint8Array" && response.body._tag !== "Raw") return response;

        const body = response.body._tag === "Uint8Array"
          ? response.body as HttpBody.Uint8Array
          : null;
        const rawBody = response.body._tag === "Raw"
          ? response.body as HttpBody.Raw
          : null;

        const data = body?.body ?? (rawBody?.body instanceof Uint8Array ? rawBody.body : null);
        if (!data || data.length < MIN_COMPRESS_LENGTH) return response;

        const contentType = body?.contentType ?? rawBody?.contentType;
        if (contentType && !isCompressibleType(contentType)) return response;

        const acceptEncoding = request.headers["accept-encoding"];
        if (typeof acceptEncoding !== "string") return response;
        const encodings = parseAcceptEncoding(acceptEncoding);
        if (!encodings.br && !encodings.gzip) return response;

        const encoding = encodings.br ? "br" : "gzip";
        try {
          const compressed = compressSync(data, encoding, level);
          return HttpServerResponse.uint8Array(compressed, {
            status: response.status,
            headers: {
              "content-encoding": encoding,
              "content-length": String(compressed.length),
            },
            contentType: contentType ?? "application/octet-stream",
          });
        } catch {
          return response;
        }
      });
  }),
  { global: true },
);
