import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";

type ServerErrorPayload = {
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
};

type AuthErrorPayload = ServerErrorPayload & {
  readonly status?: 400 | 401 | 403 | 500;
};

export type ServerError = Data.TaggedEnum<{
  readonly NetworkError: ServerErrorPayload;
  readonly DatabaseError: ServerErrorPayload;
  readonly AuthError: AuthErrorPayload;
  readonly GitError: ServerErrorPayload;
  readonly ConfigError: ServerErrorPayload;
  readonly ValidationError: ServerErrorPayload;
}>;

export type NetworkError = Extract<ServerError, { readonly _tag: "NetworkError" }>;
export type DatabaseError = Extract<ServerError, { readonly _tag: "DatabaseError" }>;
export type AuthError = Extract<ServerError, { readonly _tag: "AuthError" }>;
export type GitError = Extract<ServerError, { readonly _tag: "GitError" }>;
export type ConfigError = Extract<ServerError, { readonly _tag: "ConfigError" }>;
export type ValidationError = Extract<ServerError, { readonly _tag: "ValidationError" }>;

export type ServerErrorInput<T extends ServerError> = Omit<T, "_tag" | "timestamp"> & {
  readonly timestamp?: string;
};

export type ServerErrorResponse = {
  readonly status: 400 | 401 | 422 | 500 | 502;
  readonly body: {
    readonly error: string;
    readonly tag: ServerError["_tag"];
    readonly timestamp: string;
  };
};

export type ServerErrorLogCause = {
  readonly tag?: string;
  readonly message: string;
  readonly stack: string;
  readonly cause?: ServerErrorLogCause;
};

export type ServerErrorLog = {
  readonly tag: ServerError["_tag"];
  readonly message: string;
  readonly stack: string;
  readonly timestamp: string;
  readonly cause?: ServerErrorLogCause;
};

const serverError = Data.taggedEnum<ServerError>();

const serverErrorTags = new Set<ServerError["_tag"]>([
  "NetworkError",
  "DatabaseError",
  "AuthError",
  "GitError",
  "ConfigError",
  "ValidationError",
]);

const withTimestamp = <T extends { readonly timestamp?: string }>(
  input: T,
): T & { readonly timestamp: string } => ({
  ...input,
  timestamp: input.timestamp ?? DateTime.formatIso(DateTime.nowUnsafe()),
});

export const NetworkError = (input: ServerErrorInput<NetworkError>): NetworkError =>
  serverError.NetworkError(withTimestamp(input));

export const DatabaseError = (input: ServerErrorInput<DatabaseError>): DatabaseError =>
  serverError.DatabaseError(withTimestamp(input));

export const AuthError = (input: ServerErrorInput<AuthError>): AuthError =>
  serverError.AuthError(withTimestamp(input));

export const GitError = (input: ServerErrorInput<GitError>): GitError =>
  serverError.GitError(withTimestamp(input));

export const ConfigError = (input: ServerErrorInput<ConfigError>): ConfigError =>
  serverError.ConfigError(withTimestamp(input));

export const ValidationError = (input: ServerErrorInput<ValidationError>): ValidationError =>
  serverError.ValidationError(withTimestamp(input));

const responseBody = (error: ServerError): ServerErrorResponse["body"] => ({
  error: error.message,
  tag: error._tag,
  timestamp: error.timestamp,
});

const toResponse = (
  status: ServerErrorResponse["status"],
  error: ServerError,
): ServerErrorResponse => ({
  status,
  body: responseBody(error),
});

export const errorToResponse = (error: ServerError): ServerErrorResponse =>
  Match.value(error).pipe(
    Match.tag("AuthError", (error) => toResponse(401, error)),
    Match.tag("ValidationError", (error) => toResponse(400, error)),
    Match.tag("DatabaseError", (error) => toResponse(500, error)),
    Match.tag("NetworkError", (error) => toResponse(502, error)),
    Match.tag("ConfigError", (error) => toResponse(500, error)),
    Match.tag("GitError", (error) => toResponse(422, error)),
    Match.exhaustive,
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const isServerError = (value: unknown): value is ServerError =>
  isRecord(value) &&
  typeof value._tag === "string" &&
  serverErrorTags.has(value._tag as ServerError["_tag"]) &&
  typeof value.message === "string" &&
  typeof value.timestamp === "string";

const stringifyCause = (cause: unknown): string => {
  if (typeof cause === "string") return cause;
  if (typeof cause === "number" || typeof cause === "boolean" || typeof cause === "bigint") {
    return cause.toString();
  }
  if (cause === undefined) return "undefined";
  if (cause === null) return "null";
  if (isRecord(cause) && typeof cause.message === "string") return cause.message;
  return String(cause);
};

const stackFromCause = (cause: unknown): string =>
  isRecord(cause) && typeof cause.stack === "string" ? cause.stack : "";

const tagFromCause = (cause: unknown): string | undefined =>
  isRecord(cause) && typeof cause._tag === "string" ? cause._tag : undefined;

const nestedCauseFrom = (cause: unknown): unknown =>
  isRecord(cause) && "cause" in cause ? cause.cause : undefined;

const causeToLog = (cause: unknown): ServerErrorLogCause => {
  if (isServerError(cause)) {
    const logged = errorToLog(cause);
    return {
      tag: logged.tag,
      message: logged.message,
      stack: logged.stack,
      ...(logged.cause ? { cause: logged.cause } : {}),
    };
  }

  const nestedCause = nestedCauseFrom(cause);
  const tag = tagFromCause(cause);
  return {
    ...(tag ? { tag } : {}),
    message: stringifyCause(cause),
    stack: stackFromCause(cause),
    ...(nestedCause !== undefined ? { cause: causeToLog(nestedCause) } : {}),
  };
};

export const errorToLog = (error: ServerError): ServerErrorLog => ({
  tag: error._tag,
  message: error.message,
  stack: stackFromCause(error.cause),
  timestamp: error.timestamp,
  ...(error.cause !== undefined ? { cause: causeToLog(error.cause) } : {}),
});
