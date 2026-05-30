import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";

interface ServerErrorFields {
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}

type ServerErrorVariants = {
  readonly AuthError: ServerErrorFields;
  readonly ConfigError: ServerErrorFields;
  readonly DatabaseError: ServerErrorFields;
  readonly GitError: ServerErrorFields;
  readonly NetworkError: ServerErrorFields;
  readonly ValidationError: ServerErrorFields;
};

export type ServerError = Data.TaggedEnum<ServerErrorVariants>;
export type AuthError = Extract<ServerError, { readonly _tag: "AuthError" }>;
export type ConfigError = Extract<ServerError, { readonly _tag: "ConfigError" }>;
export type DatabaseError = Extract<ServerError, { readonly _tag: "DatabaseError" }>;
export type GitError = Extract<ServerError, { readonly _tag: "GitError" }>;
export type NetworkError = Extract<ServerError, { readonly _tag: "NetworkError" }>;
export type ValidationError = Extract<ServerError, { readonly _tag: "ValidationError" }>;

const ServerErrors = Data.taggedEnum<ServerError>();

type ServerErrorInput = Omit<ServerErrorFields, "timestamp"> & {
  readonly timestamp?: string;
};

function withTimestamp(input: ServerErrorInput): ServerErrorFields {
  return {
    ...input,
    timestamp: input.timestamp ?? DateTime.formatIso(DateTime.nowUnsafe()),
  };
}

export const AuthError = (input: ServerErrorInput): AuthError =>
  ServerErrors.AuthError(withTimestamp(input));
export const ConfigError = (input: ServerErrorInput): ConfigError =>
  ServerErrors.ConfigError(withTimestamp(input));
export const DatabaseError = (input: ServerErrorInput): DatabaseError =>
  ServerErrors.DatabaseError(withTimestamp(input));
export const GitError = (input: ServerErrorInput): GitError =>
  ServerErrors.GitError(withTimestamp(input));
export const NetworkError = (input: ServerErrorInput): NetworkError =>
  ServerErrors.NetworkError(withTimestamp(input));
export const ValidationError = (input: ServerErrorInput): ValidationError =>
  ServerErrors.ValidationError(withTimestamp(input));

export interface ServerErrorResponse {
  readonly status: 400 | 401 | 422 | 500 | 502;
  readonly body: {
    readonly error: string;
    readonly message: string;
  };
}

export function errorToResponse(error: ServerError): ServerErrorResponse {
  const status = ServerErrors.$match(error, {
    AuthError: () => 401 as const,
    ConfigError: () => 500 as const,
    DatabaseError: () => 500 as const,
    GitError: () => 422 as const,
    NetworkError: () => 502 as const,
    ValidationError: () => 400 as const,
  });

  return {
    status,
    body: {
      error: error._tag,
      message: error.message,
    },
  };
}

interface CauseLog {
  readonly tag?: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: CauseLog;
}

export interface ServerErrorLog {
  readonly tag: ServerError["_tag"];
  readonly message: string;
  readonly stack: string;
  readonly timestamp: string;
  readonly cause?: CauseLog;
}

function causeToLog(cause: unknown): CauseLog | undefined {
  if (cause === undefined) {
    return undefined;
  }

  if (cause instanceof Error) {
    const result: CauseLog = {
      message: cause.message,
      ...(cause.stack ? { stack: cause.stack } : {}),
    };
    const nestedCause = causeToLog(cause.cause);
    return nestedCause === undefined ? result : { ...result, cause: nestedCause };
  }

  if (typeof cause === "object" && cause !== null) {
    const record = cause as Record<string, unknown>;
    const tag = typeof record._tag === "string" ? record._tag : undefined;
    const message = typeof record.message === "string" ? record.message : JSON.stringify(record);
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    const result: CauseLog = {
      ...(tag === undefined ? {} : { tag }),
      message,
      ...(stack === undefined ? {} : { stack }),
    };
    const nestedCause = causeToLog(record.cause);
    return nestedCause === undefined ? result : { ...result, cause: nestedCause };
  }

  return { message: String(cause) };
}

export function errorToLog(error: ServerError): ServerErrorLog {
  const result: ServerErrorLog = {
    tag: error._tag,
    message: error.message,
    stack: new Error(error.message).stack ?? "",
    timestamp: error.timestamp,
  };
  const cause = causeToLog(error.cause);
  return cause === undefined ? result : { ...result, cause };
}
