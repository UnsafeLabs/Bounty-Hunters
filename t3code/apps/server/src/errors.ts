import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

/**
 * NetworkError - Network connectivity failures.
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}> {}

/**
 * DatabaseError - Database operation failures (queries, connections, migrations).
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}> {}

/**
 * AuthError - Authentication/authorization failures.
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}> {}

/**
 * GitError - Git repository operation failures.
 */
export class GitError extends Data.TaggedError("GitError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}> {}

/**
 * ConfigError - Configuration loading or validation failures.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}> {}

/**
 * ValidationError - Input validation failures.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}> {}

/**
 * ServerError - Union of all server error types for pattern matching.
 */
export type ServerError =
  | NetworkError
  | DatabaseError
  | AuthError
  | GitError
  | ConfigError
  | ValidationError;

/**
 * Maps server error tags to HTTP status codes.
 *
 * - AuthError     → 401 Unauthorized
 * - ValidationError → 400 Bad Request
 * - DatabaseError  → 500 Internal Server Error
 * - NetworkError   → 502 Bad Gateway
 * - ConfigError    → 500 Internal Server Error
 * - GitError       → 422 Unprocessable Entity
 */
export const errorToResponse = (error: ServerError): number => {
  switch (error._tag) {
    case "AuthError":
      return 401;
    case "ValidationError":
      return 400;
    case "DatabaseError":
      return 500;
    case "NetworkError":
      return 502;
    case "ConfigError":
      return 500;
    case "GitError":
      return 422;
  }
};

/**
 * Formats errors for structured logging.
 * Produces a JSON string with tag, message, optional cause chain, and timestamp.
 */
export const errorToLog = (error: ServerError): string => {
  const timestamp: string =
    error.timestamp ?? new Date().toISOString();
  let causeStr: string | undefined;
  if (error.cause instanceof Error) {
    causeStr = error.cause.stack ?? error.cause.message;
  } else if (error.cause !== undefined) {
    causeStr = String(error.cause);
  }
  return JSON.stringify({
    tag: error._tag,
    message: error.message,
    cause: causeStr,
    timestamp,
  });
};

/**
 * Creates an HTTP-friendly error response object from a server error.
 * Useful for middleware error handlers and route-level catch blocks.
 */
export const toHttpResponse = (
  error: ServerError,
): Effect.Effect<{ readonly status: number; readonly body: { readonly error: string; readonly message: string } }> =>
  Effect.succeed({
    status: errorToResponse(error),
    body: {
      error: error._tag,
      message: error.message,
    },
  });
