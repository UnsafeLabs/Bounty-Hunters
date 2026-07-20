/**
 * Centralized server error types (issue #861).
 * Effect.Data.TaggedEnum-compatible shape without requiring Effect at runtime.
 */

export type ServerErrorTag =
  | "NetworkError"
  | "DatabaseError"
  | "AuthError"
  | "GitError"
  | "ConfigError"
  | "ValidationError";

export interface ServerError {
  readonly _tag: ServerErrorTag;
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}

function make(tag: ServerErrorTag, message: string, cause?: unknown): ServerError {
  return {
    _tag: tag,
    message,
    cause,
    timestamp: new Date().toISOString(),
  };
}

export const NetworkError = (message: string, cause?: unknown) =>
  make("NetworkError", message, cause);
export const DatabaseError = (message: string, cause?: unknown) =>
  make("DatabaseError", message, cause);
export const AuthError = (message: string, cause?: unknown) =>
  make("AuthError", message, cause);
export const GitError = (message: string, cause?: unknown) =>
  make("GitError", message, cause);
export const ConfigError = (message: string, cause?: unknown) =>
  make("ConfigError", message, cause);
export const ValidationError = (message: string, cause?: unknown) =>
  make("ValidationError", message, cause);

export const ERROR_STATUS: Record<ServerErrorTag, number> = {
  AuthError: 401,
  ValidationError: 400,
  DatabaseError: 500,
  NetworkError: 502,
  ConfigError: 500,
  GitError: 422,
};

export function errorToResponse(error: ServerError): {
  status: number;
  body: { error: string; tag: ServerErrorTag; message: string };
} {
  return {
    status: ERROR_STATUS[error._tag],
    body: {
      error: error._tag,
      tag: error._tag,
      message: error.message,
    },
  };
}

export function errorToLog(error: ServerError): string {
  const stack =
    error.cause instanceof Error
      ? error.cause.stack ?? error.cause.message
      : error.cause !== undefined
        ? String(error.cause)
        : undefined;
  return JSON.stringify({
    tag: error._tag,
    message: error.message,
    timestamp: error.timestamp,
    stack,
  });
}

/** Simple Match-style dispatcher. */
export function matchError<T>(
  error: ServerError,
  handlers: Partial<Record<ServerErrorTag, (e: ServerError) => T>> & {
    _: (e: ServerError) => T;
  },
): T {
  const h = handlers[error._tag];
  return h ? h(error) : handlers._(error);
}
