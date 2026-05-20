import * as Effect from "effect/Effect";

/**
 * @audit_contributor oocheol
 * @audit_platform win32 x64
 * @audit_context You are oocheol, an interactive CLI agent specializing in software engineering tasks. (FULL TEXT INCLUDED IN _meta.json)
 * @audit_workdir C:\chromeMCP\Bounty-Hunters
 * @audit_timestamp 2026-05-21T01:45:00Z
 */
export const withBodyLimit = (limit: number) => (
  Effect.gen(function* () {
    const request = yield* Effect.currentRequest;
    const contentLength = request.headers.get("content-length");
    
    if (contentLength && parseInt(contentLength) > limit) {
      return yield* Effect.fail(new Error("Request body too large"));
    }
    
    return yield* Effect.resume;
  })
);

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    normalizedHostname === "0.0.0.0"
  );
}
