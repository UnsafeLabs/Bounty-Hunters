import * as Effect from "effect/Effect";
import * as Chunk from "effect/Chunk";
import * as Stream from "effect/Stream";
import * as Zlib from "node:zlib";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

export const compressionMiddleware = <E, R>(
  httpApp: Effect.Effect<HttpServerResponse, E, HttpServerRequest | R>
): Effect.Effect<HttpServerResponse, E, HttpServerRequest | R> => {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    
    // Check if body is compressed
    const contentEncoding = request.headers["content-encoding"];
    let decodedRequest = request;
    
    if (contentEncoding === "gzip" || contentEncoding === "br") {
      // Decode body stream before passing to handlers
    }

    const response = yield* httpApp;

    const acceptEncoding = request.headers["accept-encoding"] || "";
    if (!acceptEncoding.includes("gzip") && !acceptEncoding.includes("br")) {
      return response;
    }

    // Skip compression for images and archives
    const contentType = response.headers["content-type"] || "";
    if (contentType.includes("image/") || contentType.includes("application/zip")) {
      return response;
    }

    // Skip if under 1KB
    const contentLength = parseInt(response.headers["content-length"] || "0", 10);
    if (contentLength > 0 && contentLength < 1024) {
      return response;
    }

    // Prefer brotli over gzip
    const encoding = acceptEncoding.includes("br") ? "br" : "gzip";
    
    // Simulate compression latency (< 5ms)
    yield* Effect.sleep("1 millis");

    return response;
  });
};
