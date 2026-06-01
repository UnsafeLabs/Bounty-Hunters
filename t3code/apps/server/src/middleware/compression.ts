/**
 * HTTP response compression middleware with gzip and brotli support.
 * Adds compression to reduce payload sizes for JSON responses.
 */

import { createGzip, createBrotliCompress } from "zlib";
import { pipeline } from "stream/promises";
import type { IncomingMessage, ServerResponse } from "http";

interface CompressionOptions {
  /** Minimum body size in bytes to compress (default: 1024) */
  threshold?: number;
  /** Compression level 1-9 for gzip, 1-11 for brotli (default: 6) */
  level?: number;
  /** Content types to compress */
  contentTypes?: string[];
}

const DEFAULT_CONTENT_TYPES = [
  "application/json",
  "text/html",
  "text/plain",
  "text/css",
  "application/javascript",
];

/**
 * Parse Accept-Encoding header and return best supported encoding
 */
function getBestEncoding(acceptEncoding: string): "br" | "gzip" | "identity" {
  const encodings = acceptEncoding.toLowerCase();

  if (encodings.includes("br")) return "br";
  if (encodings.includes("gzip") || encodings.includes("x-gzip")) return "gzip";
  return "identity";
}

/**
 * Create compression middleware
 */
export function createCompressionMiddleware(options: CompressionOptions = {}) {
  const {
    threshold = 1024,
    level = 6,
    contentTypes = DEFAULT_CONTENT_TYPES,
  } = options;

  return async function compress(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => Promise<void>
  ) {
    const acceptEncoding = req.headers["accept-encoding"] || "";
    const encoding = getBestEncoding(acceptEncoding);

    if (encoding === "identity") {
      return next();
    }

    // Override res.end to intercept and compress response
    const originalEnd = res.end.bind(res);
    let body: Buffer | string = "";

    res.end = function (chunk?: any, ...args: any[]) {
      if (chunk) {
        body = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      }

      const contentType = res.getHeader("content-type") as string || "";
      const shouldCompress =
        body.length >= threshold &&
        contentTypes.some((ct) => contentType.includes(ct));

      if (!shouldCompress) {
        return originalEnd(chunk, ...args);
      }

      // Set compression headers
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Vary", "Accept-Encoding");
      res.removeHeader("Content-Length");

      const compressor =
        encoding === "br"
          ? createBrotliCompress({ params: { [1]: level } })
          : createGzip({ level });

      // Compress and send
      compressor.on("data", (compressed) => {
        res.write(compressed);
      });
      compressor.on("end", () => {
        originalEnd();
      });
      compressor.on("error", () => {
        // Fallback to uncompressed
        res.removeHeader("Content-Encoding");
        res.setHeader("Content-Length", body.length.toString());
        originalEnd(body);
      });

      compressor.end(body);
    } as any;

    await next();
  };
}
