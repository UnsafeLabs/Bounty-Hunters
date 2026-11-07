/**
 * Server Errors - Centralized error types using Effect.Data.TaggedEnum.
 *
 * Provides consistent error handling across the server codebase with
 * structured error types, HTTP status mapping, and logging utilities.
 *
 * @module Errors
 */
import * as Data from "effect/Data";
import * as Match from "effect/Match";

/**
 * Base error interface for all server errors.
 */
export interface ServerErrorBase {
  readonly _tag: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}

/**
 * Authentication and authorization errors.
 */
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string;
  readonly status?: 400 | 401 | 403 | 500;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {
  constructor(input: { message: string; status?: 400 | 401 | 403 | 500; cause?: unknown }) {
    super({
      ...input,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Database operation errors.
 */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {
  constructor(input: { message: string; cause?: unknown }) {
    super({
      ...input,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Network and HTTP client errors.
 */
export class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {
  constructor(input: { message: string; cause?: unknown }) {
    super({
      ...input,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Git operation errors.
 */
export class GitError extends Data.TaggedError("GitError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {
  constructor(input: { message: string; cause?: unknown }) {
    super({
      ...input,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Configuration and environment errors.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {
  constructor(input: { message: string; cause?: unknown }) {
    super({
      ...input,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Input validation errors.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}> {
  constructor(input: { message: string; cause?: unknown }) {
    super({
      ...input,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Union type of all server errors.
 */
export type ServerError =
  | AuthError
  | DatabaseError
  | NetworkError
  | GitError
  | ConfigError
  | ValidationError;

/**
 * Map error tags to HTTP status codes.
 */
export const errorToResponse = (error: ServerError): number => {
  if (error._tag === "AuthError" && error.status !== undefined) {
    return error.status;
  }
  return Match.value(error._tag).pipe(
    Match.when("AuthError", () => 401),
    Match.when("ValidationError", () => 400),
    Match.when("DatabaseError", () => 500),
    Match.when("NetworkError", () => 502),
    Match.when("ConfigError", () => 500),
    Match.when("GitError", () => 422),
    Match.orElse(() => 500),
  );
};

/**
 * Format error for structured logging.
 */
export const errorToLog = (error: ServerError) => ({
  tag: error._tag,
  message: error.message,
  timestamp: error.timestamp,
  stack: error.stack,
  cause: error.cause ? String(error.cause) : undefined,
  ...(error._tag === "AuthError" && error.status !== undefined ? { status: error.status } : {}),
});

/**
 * Type guard for server errors.
 */
export const isServerError = (error: unknown): error is ServerError =>
  error instanceof AuthError ||
  error instanceof DatabaseError ||
  error instanceof NetworkError ||
  error instanceof GitError ||
  error instanceof ConfigError ||
  error instanceof ValidationError;

/**
 * Create an AuthError.
 */
export const authError = (
  message: string,
  causeOrStatus?: unknown | 400 | 401 | 403 | 500,
  cause?: unknown,
) => {
  if (typeof causeOrStatus === "number") {
    return new AuthError({ message, status: causeOrStatus as 400 | 401 | 403 | 500, cause });
  }
  return new AuthError({ message, cause: causeOrStatus });
};

/**
 * Create a DatabaseError.
 */
export const databaseError = (message: string, cause?: unknown) =>
  new DatabaseError({ message, cause });

/**
 * Create a NetworkError.
 */
export const networkError = (message: string, cause?: unknown) =>
  new NetworkError({ message, cause });

/**
 * Create a GitError.
 */
export const gitError = (message: string, cause?: unknown) =>
  new GitError({ message, cause });

/**
 * Create a ConfigError.
 */
export const configError = (message: string, cause?: unknown) =>
  new ConfigError({ message, cause });

/**
 * Create a ValidationError.
 */
export const validationError = (message: string, cause?: unknown) =>
  new ValidationError({ message, cause });
