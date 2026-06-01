/**
 * Request body size limiting with per-route overrides.
 * Prevents DoS via oversized request bodies.
 */

import type { IncomingMessage, ServerResponse } from "http";

interface BodySizeOptions {
  /** Default max body size in bytes (default: 1MB) */
  defaultLimit?: number;
  /** Route-specific overrides */
  routeLimits?: Record<string, number>;
  /** Error message */
  errorMessage?: string;
}

export function createBodySizeMiddleware(options: BodySizeOptions = {}) {
  const {
    defaultLimit = 1024 * 1024,
    routeLimits = {},
    errorMessage = "Request body too large",
  } = options;

  return async function bodySizeLimit(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => Promise<void>
  ) {
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);
    const path = req.url?.split("?")[0] || "";
    const limit = routeLimits[path] || defaultLimit;

    if (contentLength > limit) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: errorMessage,
        limit,
        received: contentLength,
      }));
      return;
    }

    // Also check streaming body size
    let received = 0;
    const originalOn = req.on.bind(req);

    req.on = function(event: string, listener: any) {
      if (event === "data") {
        const wrappedListener = (chunk: Buffer) => {
          received += chunk.length;
          if (received > limit) {
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: errorMessage }));
            req.destroy();
            return;
          }
          listener(chunk);
        };
        return originalOn(event, wrappedListener);
      }
      return originalOn(event, listener);
    } as any;

    await next();
  };
}
