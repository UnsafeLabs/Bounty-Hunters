import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";

export interface ServerErrorInput {
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp?: string;
}

export interface ServerErrorFields {
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}

export type ServerError = Data.TaggedEnum<{
  readonly NetworkError: ServerErrorFields;
  readonly DatabaseError: ServerErrorFields;
  readonly AuthError: ServerErrorFields;
  readonly GitError: ServerErrorFields;
  readonly ConfigError: ServerErrorFields;
  readonly ValidationError: ServerErrorFields;
}>;

export type NetworkError = Extract<ServerError, { readonly _tag: "NetworkError" }>;
export type DatabaseError = Extract<ServerError, { readonly _tag: "DatabaseError" }>;
export type AuthError = Extract<ServerError, { readonly _tag: "AuthError" }>;
export type GitError = Extract<ServerError, { readonly _tag: "GitError" }>;
export type ConfigError = Extract<ServerError, { readonly _tag: "ConfigError" }>;
export type ValidationError = Extract<ServerError, { readonly _tag: "ValidationError" }>;

const ServerErrors = Data.taggedEnum<ServerError>();

const timestampNow = () => DateTime.formatIso(DateTime.nowUnsafe());

const withTimestamp = (input: ServerErrorInput): ServerErrorFields => ({
  message: input.message,
  timestamp: input.timestamp ?? timestampNow(),
  ...(input.cause === undefined ? {} : { cause: input.cause }),
});

export const NetworkError = (input: ServerErrorInput): NetworkError =>
  ServerErrors.NetworkError(withTimestamp(input));
export const DatabaseError = (input: ServerErrorInput): DatabaseError =>
  ServerErrors.DatabaseError(withTimestamp(input));
export const AuthError = (input: ServerErrorInput): AuthError =>
  ServerErrors.AuthError(withTimestamp(input));
export const GitError = (input: ServerErrorInput): GitError =>
  ServerErrors.GitError(withTimestamp(input));
export const ConfigError = (input: ServerErrorInput): ConfigError =>
  ServerErrors.ConfigError(withTimestamp(input));
export const ValidationError = (input: ServerErrorInput): ValidationError =>
  ServerErrors.ValidationError(withTimestamp(input));

export interface ServerErrorResponse {
  readonly status: 400 | 401 | 422 | 500 | 502;
  readonly body: {
    readonly error: string;
  };
}

export const errorToResponse = Match.typeTags<ServerError, ServerErrorResponse>()({
  AuthError: (error) => ({ status: 401, body: { error: error.message } }),
  ValidationError: (error) => ({ status: 400, body: { error: error.message } }),
  DatabaseError: (error) => ({ status: 500, body: { error: error.message } }),
  NetworkError: (error) => ({ status: 502, body: { error: error.message } }),
  ConfigError: (error) => ({ status: 500, body: { error: error.message } }),
  GitError: (error) => ({ status: 422, body: { error: error.message } }),
});

export interface ServerErrorCauseLog {
  readonly tag?: string;
  readonly message: string;
  readonly stack?: string;
}

export interface ServerErrorLog {
  readonly tag: ServerError["_tag"];
  readonly message: string;
  readonly timestamp: string;
  readonly stack: string;
  readonly causeChain: ReadonlyArray<ServerErrorCauseLog>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (isRecord(cause) && typeof cause.message === "string") return cause.message;
  return String(cause);
};

const causeStack = (cause: unknown): string | undefined => {
  if (cause instanceof Error) return cause.stack;
  if (isRecord(cause) && typeof cause.stack === "string") return cause.stack;
  return undefined;
};

const causeTag = (cause: unknown): string | undefined =>
  isRecord(cause) && typeof cause._tag === "string" ? cause._tag : undefined;

const nestedCause = (cause: unknown): unknown =>
  isRecord(cause) && "cause" in cause ? cause.cause : undefined;

const collectCauseChain = (cause: unknown): ReadonlyArray<ServerErrorCauseLog> => {
  const chain: ServerErrorCauseLog[] = [];
  let current = cause;
  const seen = new Set<unknown>();

  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    const stack = causeStack(current);
    const tag = causeTag(current);
    chain.push({
      message: causeMessage(current),
      ...(tag ? { tag } : {}),
      ...(stack ? { stack } : {}),
    });
    current = nestedCause(current);
  }

  return chain;
};

export function errorToLog(error: ServerError): ServerErrorLog {
  const causeChain = collectCauseChain(error.cause);
  return {
    tag: error._tag,
    message: error.message,
    timestamp: error.timestamp,
    stack:
      causeChain.find((cause) => cause.stack !== undefined)?.stack ??
      new Error(error.message).stack ??
      "",
    causeChain,
  };
}
