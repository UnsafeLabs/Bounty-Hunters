import * as Data from "effect/Data";

export type ServerErrorTag =
  | "AuthError"
  | "ValidationError"
  | "DatabaseError"
  | "NetworkError"
  | "ConfigError"
  | "GitError";

export type AuthErrorStatus = 400 | 401 | 403 | 500;

export interface ServerErrorFields {
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}

export type StandardServerError = Data.TaggedEnum<{
  readonly AuthError: ServerErrorFields & {
    readonly status?: AuthErrorStatus;
  };
  readonly ValidationError: ServerErrorFields;
  readonly DatabaseError: ServerErrorFields;
  readonly NetworkError: ServerErrorFields;
  readonly ConfigError: ServerErrorFields;
  readonly GitError: ServerErrorFields;
}>;

export const ServerError = Data.taggedEnum<StandardServerError>();

export type ServerErrorInput = Omit<ServerErrorFields, "timestamp"> & {
  readonly timestamp?: string;
};

export type AuthErrorInput = ServerErrorInput & {
  readonly status?: AuthErrorStatus;
};

export const nowTimestamp = (): string => new Date().toISOString();

const withTimestamp = <A extends { readonly timestamp?: string }>(
  input: A,
): Omit<A, "timestamp"> & { readonly timestamp: string } => ({
  ...input,
  timestamp: input.timestamp ?? nowTimestamp(),
});

export const makeAuthError = (input: AuthErrorInput): StandardServerError =>
  ServerError.AuthError(withTimestamp(input));

export const makeValidationError = (input: ServerErrorInput): StandardServerError =>
  ServerError.ValidationError(withTimestamp(input));

export const makeDatabaseError = (input: ServerErrorInput): StandardServerError =>
  ServerError.DatabaseError(withTimestamp(input));

export const makeNetworkError = (input: ServerErrorInput): StandardServerError =>
  ServerError.NetworkError(withTimestamp(input));

export const makeConfigError = (input: ServerErrorInput): StandardServerError =>
  ServerError.ConfigError(withTimestamp(input));

export const makeGitError = (input: ServerErrorInput): StandardServerError =>
  ServerError.GitError(withTimestamp(input));

export class AuthError extends Data.TaggedError("AuthError")<
  ServerErrorFields & { readonly status?: AuthErrorStatus }
> {
  constructor(input: AuthErrorInput) {
    super(withTimestamp(input));
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<ServerErrorFields> {
  constructor(input: ServerErrorInput) {
    super(withTimestamp(input));
  }
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<ServerErrorFields> {
  constructor(input: ServerErrorInput) {
    super(withTimestamp(input));
  }
}

export class NetworkError extends Data.TaggedError("NetworkError")<ServerErrorFields> {
  constructor(input: ServerErrorInput) {
    super(withTimestamp(input));
  }
}

export class ConfigError extends Data.TaggedError("ConfigError")<ServerErrorFields> {
  constructor(input: ServerErrorInput) {
    super(withTimestamp(input));
  }
}

export class GitError extends Data.TaggedError("GitError")<ServerErrorFields> {
  constructor(input: ServerErrorInput) {
    super(withTimestamp(input));
  }
}

export class BootstrapError extends ConfigError {}

export class DecodeOtlpTraceRecordsError extends ValidationError {
  readonly bodyJson: unknown;

  constructor(input: ServerErrorInput & { readonly bodyJson: unknown }) {
    super(input);
    this.bodyJson = input.bodyJson;
  }
}

type ProcessErrorInput = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly timestamp?: string;
};

export class ProcessSpawnError extends Data.TaggedError("ProcessSpawnError")<
  ServerErrorFields & {
    readonly category: "NetworkError";
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly cause: unknown;
  }
> {
  constructor(input: ProcessErrorInput & { readonly cause: unknown }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Failed to spawn process: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessStdinError extends Data.TaggedError("ProcessStdinError")<
  ServerErrorFields & {
    readonly category: "NetworkError";
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly cause: unknown;
  }
> {
  constructor(input: ProcessErrorInput & { readonly cause: unknown }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Failed to write stdin for process: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessOutputLimitError extends Data.TaggedError("ProcessOutputLimitError")<
  ServerErrorFields & {
    readonly category: "NetworkError";
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly stream: "stdout" | "stderr";
    readonly maxBytes: number;
  }
> {
  constructor(
    input: ProcessErrorInput & {
      readonly stream: "stdout" | "stderr";
      readonly maxBytes: number;
    },
  ) {
    super({
      ...input,
      category: "NetworkError",
      message: `Process ${input.stream} exceeded ${input.maxBytes} bytes: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessReadError extends Data.TaggedError("ProcessReadError")<
  ServerErrorFields & {
    readonly category: "NetworkError";
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly stream: "stdout" | "stderr" | "exitCode";
    readonly cause: unknown;
  }
> {
  constructor(
    input: ProcessErrorInput & {
      readonly stream: "stdout" | "stderr" | "exitCode";
      readonly cause: unknown;
    },
  ) {
    super({
      ...input,
      category: "NetworkError",
      message: `Failed to read process ${input.stream}: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessTimeoutError extends Data.TaggedError("ProcessTimeoutError")<
  ServerErrorFields & {
    readonly category: "NetworkError";
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly timeoutMs: number;
  }
> {
  constructor(input: ProcessErrorInput & { readonly timeoutMs: number }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Process timed out after ${input.timeoutMs}ms: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export type MigratedServerError =
  | StandardServerError
  | AuthError
  | ValidationError
  | DatabaseError
  | NetworkError
  | ConfigError
  | GitError
  | BootstrapError
  | DecodeOtlpTraceRecordsError
  | ProcessSpawnError
  | ProcessStdinError
  | ProcessOutputLimitError
  | ProcessReadError
  | ProcessTimeoutError;

export interface ServerHttpErrorResponse {
  readonly status: 400 | 401 | 403 | 422 | 500 | 502;
  readonly body: {
    readonly error: ServerErrorTag;
    readonly message: string;
    readonly timestamp: string;
  };
}

export interface ServerErrorLogRecord {
  readonly tag: string;
  readonly category: ServerErrorTag;
  readonly message: string;
  readonly timestamp: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

const statusByTag: Record<ServerErrorTag, ServerHttpErrorResponse["status"]> = {
  AuthError: 401,
  ValidationError: 400,
  DatabaseError: 500,
  NetworkError: 502,
  ConfigError: 500,
  GitError: 422,
};

const isStandardServerErrorTag = (tag: string): tag is ServerErrorTag =>
  tag === "AuthError" ||
  tag === "ValidationError" ||
  tag === "DatabaseError" ||
  tag === "NetworkError" ||
  tag === "ConfigError" ||
  tag === "GitError";

export function toStandardServerError(error: MigratedServerError): StandardServerError {
  if (isStandardServerErrorTag(error._tag)) {
    if (error._tag === "AuthError") {
      const input = {
        message: error.message,
        cause: error.cause,
        timestamp: error.timestamp,
      };
      if ("status" in error && error.status !== undefined) {
        return makeAuthError({
          ...input,
          status: error.status,
        });
      }
      return makeAuthError({
        ...input,
      });
    }
    return ServerError[error._tag]({
      message: error.message,
      cause: error.cause,
      timestamp: error.timestamp,
    });
  }

  return makeNetworkError({
    message: error.message,
    cause: error.cause,
    timestamp: error.timestamp,
  });
}

export function errorToResponse(error: MigratedServerError): ServerHttpErrorResponse {
  const standardError = toStandardServerError(error);
  const status =
    standardError._tag === "AuthError" && standardError.status !== undefined
      ? standardError.status
      : statusByTag[standardError._tag];

  return {
    status,
    body: {
      error: standardError._tag,
      message: standardError.message,
      timestamp: standardError.timestamp,
    },
  };
}

export function errorToLog(error: MigratedServerError): ServerErrorLogRecord {
  const standardError = toStandardServerError(error);
  return {
    tag: error._tag,
    category: standardError._tag,
    message: error.message,
    timestamp: standardError.timestamp,
    ...("stack" in error && typeof error.stack === "string" ? { stack: error.stack } : {}),
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
  };
}
