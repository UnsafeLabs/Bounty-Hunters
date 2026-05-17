/**
 * Centralized Server Error Types
 *
 * Defines all server error types using Effect.Data.TaggedEnum patterns.
 * Provides error-to-HTTP-response and error-to-log mapping utilities.
 *
 * @module errors
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

// ---------------------------------------------------------------------------
// Error type definitions using Data.TaggedError
// ---------------------------------------------------------------------------

/**
 * Network-related errors (upstream failures, connection issues).
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {}

/**
 * Database-related errors (SQL failures, migration issues).
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {}

/**
 * Authentication and authorization errors.
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {}

/**
 * Git operation errors (merge conflicts, invalid refs, etc.).
 */
export class GitError extends Data.TaggedError("GitError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {}

/**
 * Configuration and environment errors.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {}

/**
 * Input validation errors.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
  readonly fields?: ReadonlyArray<{ readonly field: string; readonly issue: string }>;
}> {}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

/**
 * Union of all server error types.
 */
export type ServerError =
  | NetworkError
  | DatabaseError
  | AuthError
  | GitError
  | ConfigError
  | ValidationError;

// ---------------------------------------------------------------------------
// Error constructors (with auto-timestamp)
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();

export const makeNetworkError = (message: string, cause?: unknown) =>
  new NetworkError({ message, cause, timestamp: now() });

export const makeDatabaseError = (message: string, cause?: unknown) =>
  new DatabaseError({ message, cause, timestamp: now() });

export const makeAuthError = (message: string, cause?: unknown) =>
  new AuthError({ message, cause, timestamp: now() });

export const makeGitError = (message: string, cause?: unknown) =>
  new GitError({ message, cause, timestamp: now() });

export const makeConfigError = (message: string, cause?: unknown) =>
  new ConfigError({ message, cause, timestamp: now() });

export const makeValidationError = (
  message: string,
  fields?: ReadonlyArray<{ readonly field: string; readonly issue: string }>,
  cause?: unknown,
) => new ValidationError({ message, fields, cause, timestamp: now() });

// ---------------------------------------------------------------------------
// errorToResponse — Maps error tags to HTTP status codes
// ---------------------------------------------------------------------------

/**
 * Maps a ServerError to an appropriate HTTP response.
 *
 * - AuthError → 401
 * - ValidationError → 400
 * - GitError → 422
 * - NetworkError → 502
 * - DatabaseError → 500
 * - ConfigError → 500
 */
export const errorToResponse = (error: ServerError): HttpServerResponse.HttpServerResponse => {
  const status = Match.value(error).pipe(
    Match.tag("AuthError", () => 401 as const),
    Match.tag("ValidationError", () => 400 as const),
    Match.tag("GitError", () => 422 as const),
    Match.tag("NetworkError", () => 502 as const),
    Match.tag("DatabaseError", () => 500 as const),
    Match.tag("ConfigError", () => 500 as const),
    Match.orElse(() => 500 as const),
  );

  return HttpServerResponse.jsonUnsafe(
    {
      error: {
        _tag: error._tag,
        message: error.message,
        ...(error._tag === "ValidationError" && "fields" in error
          ? { fields: (error as ValidationError).fields }
          : {}),
      },
    },
    { status },
  );
};

// ---------------------------------------------------------------------------
// errorToLog — Formats errors for structured logging
// ---------------------------------------------------------------------------

export interface ErrorLogEntry {
  readonly tag: string;
  readonly message: string;
  readonly stack?: string;
  readonly timestamp: string;
  readonly cause?: unknown;
}

/**
 * Formats a ServerError into a structured log entry with tag, message,
 * stack trace, and timestamp.
 */
export const errorToLog = (error: ServerError): ErrorLogEntry => ({
  tag: error._tag,
  message: error.message,
  stack: error instanceof Error ? error.stack : undefined,
  timestamp: error.timestamp,
  cause: error.cause,
});

// ---------------------------------------------------------------------------
// Utility: Check if an error is a ServerError
// ---------------------------------------------------------------------------

export const isServerError = (u: unknown): u is ServerError =>
  Data.isTagged(u, "NetworkError") ||
  Data.isTagged(u, "DatabaseError") ||
  Data.isTagged(u, "AuthError") ||
  Data.isTagged(u, "GitError") ||
  Data.isTagged(u, "ConfigError") ||
  Data.isTagged(u, "ValidationError");

// ---------------------------------------------------------------------------
// Utility: Log a ServerError and convert to response
// ---------------------------------------------------------------------------

export const handleError = (error: ServerError) =>
  Effect.gen(function* () {
    yield* Effect.logError("Server error", errorToLog(error));
    return errorToResponse(error);
  });
