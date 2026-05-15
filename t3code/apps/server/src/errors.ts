/**
 * Centralized server error module for t3code.
 *
 * Defines standardized error categories using Effect.Data.TaggedEnum and
 * provides utilities for mapping errors to HTTP responses and structured
 * log entries.
 *
 * @module errors
 */
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import { HttpServerResponse } from "effect/unstable/http";

// ---------------------------------------------------------------------------
// Error categories
// ---------------------------------------------------------------------------

export const ServerError = Data.taggedEnum<{
  NetworkError: {
    readonly message: string;
    readonly cause?: unknown;
    readonly timestamp: number;
  };
  DatabaseError: {
    readonly message: string;
    readonly cause?: unknown;
    readonly timestamp: number;
  };
  AuthError: {
    readonly message: string;
    readonly cause?: unknown;
    readonly timestamp: number;
  };
  GitError: {
    readonly message: string;
    readonly cause?: unknown;
    readonly timestamp: number;
  };
  ConfigError: {
    readonly message: string;
    readonly cause?: unknown;
    readonly timestamp: number;
  };
  ValidationError: {
    readonly message: string;
    readonly cause?: unknown;
    readonly timestamp: number;
  };
}>();

export type ServerError = Data.TaggedEnum.Value<typeof ServerError>;

// ---------------------------------------------------------------------------
// HTTP status code mapping
// ---------------------------------------------------------------------------

const ERROR_STATUS_MAP: Record<ServerError["_tag"], number> = {
  AuthError: 401,
  ValidationError: 400,
  DatabaseError: 500,
  NetworkError: 502,
  ConfigError: 500,
  GitError: 422,
} as const;

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Maps a ServerError to an HTTP status code. */
export const errorToStatus = (error: ServerError): number =>
  ERROR_STATUS_MAP[error._tag];

/** Maps a ServerError to an HTTP JSON response with the correct status code. */
export const errorToResponse = (
  error: ServerError,
  headers?: Record<string, string>,
) =>
  HttpServerResponse.jsonUnsafe(
    { error: error.message, tag: error._tag },
    { status: errorToStatus(error), headers: headers ?? {} },
  );

/** Maps a ServerError to a structured log entry suitable for JSON logging. */
export const errorToLog = (error: ServerError) => ({
  tag: error._tag,
  message: error.message,
  cause: error.cause ?? undefined,
  timestamp: new Date(error.timestamp).toISOString(),
});

// ---------------------------------------------------------------------------
// Factory helpers — create ServerError instances with current timestamp
// ---------------------------------------------------------------------------

export const makeServerError = {
  networkError: (message: string, cause?: unknown): ServerError =>
    ServerError.NetworkError({ message, cause, timestamp: Date.now() }),

  databaseError: (message: string, cause?: unknown): ServerError =>
    ServerError.DatabaseError({ message, cause, timestamp: Date.now() }),

  authError: (message: string, cause?: unknown): ServerError =>
    ServerError.AuthError({ message, cause, timestamp: Date.now() }),

  gitError: (message: string, cause?: unknown): ServerError =>
    ServerError.GitError({ message, cause, timestamp: Date.now() }),

  configError: (message: string, cause?: unknown): ServerError =>
    ServerError.ConfigError({ message, cause, timestamp: Date.now() }),

  validationError: (message: string, cause?: unknown): ServerError =>
    ServerError.ValidationError({ message, cause, timestamp: Date.now() }),
};

// ---------------------------------------------------------------------------
// Domain-error classifier — maps existing module errors to ServerError
// ---------------------------------------------------------------------------

export interface ClassifiableError {
  readonly _tag: string;
  readonly message?: string;
  readonly cause?: unknown;
}

/** Classifies a domain error into a ServerError category based on its _tag. */
export const classifyError = (
  error: ClassifiableError,
): ServerError => {
  const message =
    typeof error.message === "string" ? error.message : String(error._tag);
  const ts = Date.now();

  switch (error._tag) {
    // Auth-category errors
    case "AuthError":
    case "AuthControlPlaneError":
    case "SessionCredentialError":
    case "BootstrapCredentialError":
    case "SecretStoreError":
      return ServerError.AuthError({ message, cause: error.cause, timestamp: ts });

    // Validation-category errors
    case "ValidationError":
    case "ProviderAdapterValidationError":
    case "ProjectCommandError":
      return ServerError.ValidationError({ message, cause: error.cause, timestamp: ts });

    // Database-category errors
    case "PersistenceSqlError":
    case "PersistenceDecodeError":
    case "ProviderSessionRepositoryValidationError":
    case "ProviderSessionRepositoryPersistenceError":
      return ServerError.DatabaseError({ message, cause: error.cause, timestamp: ts });

    // Network-category errors
    case "DecodeOtlpTraceRecordsError":
    case "ProcessSpawnError":
    case "ProcessReadError":
    case "ProviderAdapterRequestError":
      return ServerError.NetworkError({ message, cause: error.cause, timestamp: ts });

    // Git-category errors
    case "GitManagerServiceError":
    case "GitWorkflowError":
      return ServerError.GitError({ message, cause: error.cause, timestamp: ts });

    // Config-category errors
    case "ConfigError":
    case "BootstrapError":
    case "ProcessTimeoutError":
    case "ProcessOutputLimitError":
      return ServerError.ConfigError({ message, cause: error.cause, timestamp: ts });

    default:
      return ServerError.ConfigError({ message, cause: error, timestamp: ts });
  }
};
