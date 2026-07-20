/**
 * Request body size limiting with per-route overrides (issue #841).
 */

export const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024; // 10MB
export const UPLOAD_BODY_LIMIT = 50 * 1024 * 1024; // 50MB

export interface BodyLimitResult {
  allowed: boolean;
  limit: number;
  received: number | null;
  status?: 413;
  headers?: Record<string, string>;
  body?: {
    error: string;
    limit: number;
    received: number | null;
  };
}

export type RouteLimitMap = Record<string, number>;

export function resolveBodyLimit(
  path: string,
  overrides: RouteLimitMap = {},
  defaults: { defaultLimit?: number; uploadLimit?: number } = {},
): number {
  const def = defaults.defaultLimit ?? DEFAULT_BODY_LIMIT;
  const upload = defaults.uploadLimit ?? UPLOAD_BODY_LIMIT;

  // exact override
  if (overrides[path] !== undefined) return overrides[path]!;

  // prefix match longest first
  const keys = Object.keys(overrides).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (path === key || path.startsWith(key.endsWith("/") ? key : key + "/")) {
      return overrides[key]!;
    }
  }

  // heuristic upload routes
  if (/upload|attachment|multipart|files?/i.test(path)) return upload;
  return def;
}

/**
 * Check Content-Length against limit before buffering body.
 * If Content-Length missing, allowed=true (stream-level checks can still apply).
 */
export function checkBodySize(input: {
  path: string;
  contentLength: string | number | null | undefined;
  overrides?: RouteLimitMap;
  defaultLimit?: number;
  uploadLimit?: number;
}): BodyLimitResult {
  const limit = resolveBodyLimit(input.path, input.overrides, {
    defaultLimit: input.defaultLimit,
    uploadLimit: input.uploadLimit,
  });

  if (input.contentLength === null || input.contentLength === undefined || input.contentLength === "") {
    return { allowed: true, limit, received: null };
  }

  const received = typeof input.contentLength === "number"
    ? input.contentLength
    : Number(input.contentLength);

  if (!Number.isFinite(received) || received < 0) {
    return { allowed: true, limit, received: null };
  }

  if (received > limit) {
    return {
      allowed: false,
      limit,
      received,
      status: 413,
      headers: {
        "X-Max-Body-Size": String(limit),
        "Content-Type": "application/json",
      },
      body: {
        error: "Payload Too Large",
        limit,
        received,
      },
    };
  }

  return { allowed: true, limit, received };
}
