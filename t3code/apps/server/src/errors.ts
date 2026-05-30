import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";

type ServerErrorTag =
  | "AuthError"
  | "ValidationError"
  | "DatabaseError"
  | "NetworkError"
  | "ConfigError"
  | "GitError";

export type ServerErrorDetails = {
  readonly name: ServerErrorTag;
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
  readonly details?: unknown;
};

export type ServerError = Data.TaggedEnum<{
  AuthError: ServerErrorDetails;
  ValidationError: ServerErrorDetails;
  DatabaseError: ServerErrorDetails;
  NetworkError: ServerErrorDetails;
  ConfigError: ServerErrorDetails;
  GitError: ServerErrorDetails;
}>;

type ServerErrorInput = Omit<ServerErrorDetails, "name" | "timestamp"> & {
  readonly timestamp?: string;
};

const ServerErrors = Data.taggedEnum<ServerError>();

const nowIso = () => DateTime.formatIso(DateTime.nowUnsafe());

const withErrorDetails = (name: ServerErrorTag, input: ServerErrorInput): ServerErrorDetails => ({
  ...input,
  name,
  timestamp: input.timestamp ?? nowIso(),
});

export const AuthError = (input: ServerErrorInput) =>
  ServerErrors.AuthError(withErrorDetails("AuthError", input));
export type AuthError = Extract<ServerError, { readonly _tag: "AuthError" }>;

export const ValidationError = (input: ServerErrorInput) =>
  ServerErrors.ValidationError(withErrorDetails("ValidationError", input));
export type ValidationError = Extract<ServerError, { readonly _tag: "ValidationError" }>;

export const DatabaseError = (input: ServerErrorInput) =>
  ServerErrors.DatabaseError(withErrorDetails("DatabaseError", input));
export type DatabaseError = Extract<ServerError, { readonly _tag: "DatabaseError" }>;

export const NetworkError = (input: ServerErrorInput) =>
  ServerErrors.NetworkError(withErrorDetails("NetworkError", input));
export type NetworkError = Extract<ServerError, { readonly _tag: "NetworkError" }>;

export const ConfigError = (input: ServerErrorInput) =>
  ServerErrors.ConfigError(withErrorDetails("ConfigError", input));
export type ConfigError = Extract<ServerError, { readonly _tag: "ConfigError" }>;

export const GitError = (input: ServerErrorInput) =>
  ServerErrors.GitError(withErrorDetails("GitError", input));
export type GitError = Extract<ServerError, { readonly _tag: "GitError" }>;

export const isServerError = (value: unknown): value is ServerError =>
  ServerErrors.$is("AuthError")(value) ||
  ServerErrors.$is("ValidationError")(value) ||
  ServerErrors.$is("DatabaseError")(value) ||
  ServerErrors.$is("NetworkError")(value) ||
  ServerErrors.$is("ConfigError")(value) ||
  ServerErrors.$is("GitError")(value);

export interface ServerErrorResponse {
  readonly status: 400 | 401 | 422 | 500 | 502;
  readonly body: {
    readonly error: ServerError["_tag"];
    readonly message: string;
    readonly timestamp: string;
  };
}

export const errorToResponse = (error: ServerError): ServerErrorResponse => {
  const status = Match.valueTags(error, {
    AuthError: () => 401 as const,
    ValidationError: () => 400 as const,
    DatabaseError: () => 500 as const,
    NetworkError: () => 502 as const,
    ConfigError: () => 500 as const,
    GitError: () => 422 as const,
  });

  return {
    status,
    body: {
      error: error._tag,
      message: error.message,
      timestamp: error.timestamp,
    },
  };
};

const stackFromCause = (cause: unknown): string | undefined => {
  if (cause instanceof Error) {
    return cause.stack;
  }

  if (
    typeof cause === "object" &&
    cause !== null &&
    "stack" in cause &&
    typeof cause.stack === "string"
  ) {
    return cause.stack;
  }

  return undefined;
};

const messageFromCause = (cause: unknown): string | undefined => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (
    typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message;
  }

  if (cause === undefined) {
    return undefined;
  }

  return String(cause);
};

export interface ServerErrorLog {
  readonly tag: ServerError["_tag"];
  readonly message: string;
  readonly timestamp: string;
  readonly stack: string | undefined;
  readonly cause: string | undefined;
  readonly details: unknown;
}

export const errorToLog = (error: ServerError): ServerErrorLog => ({
  tag: error._tag,
  message: error.message,
  timestamp: error.timestamp,
  stack: stackFromCause(error.cause) ?? new Error(error.message).stack,
  cause: messageFromCause(error.cause),
  details: error.details,
});
