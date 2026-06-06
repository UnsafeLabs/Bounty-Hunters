import * as Data from "effect/Data";

// Effect v4 exposes Data.TaggedError at runtime; this module centralizes the
// server error tagged union that issue text describes as Effect.Data.TaggedEnum.
export type ServerErrorCategory =
  | "AuthError"
  | "ValidationError"
  | "DatabaseError"
  | "NetworkError"
  | "ConfigError"
  | "GitError";

export interface ServerErrorFields {
  readonly message: string;
  readonly cause?: unknown;
  readonly timestamp: string;
}

export class AuthError extends Data.TaggedError("AuthError")<ServerErrorFields> {}
export class ValidationError extends Data.TaggedError("ValidationError")<ServerErrorFields> {}
export class DatabaseError extends Data.TaggedError("DatabaseError")<ServerErrorFields> {}
export class NetworkError extends Data.TaggedError("NetworkError")<ServerErrorFields> {}
export class ConfigError extends Data.TaggedError("ConfigError")<ServerErrorFields> {}
export class GitError extends Data.TaggedError("GitError")<ServerErrorFields> {}

export type StandardServerError =
  | AuthError
  | ValidationError
  | DatabaseError
  | NetworkError
  | ConfigError
  | GitError;

export interface ServerHttpErrorResponse {
  readonly status: 400 | 401 | 422 | 500 | 502;
  readonly body: {
    readonly error: ServerErrorCategory;
    readonly message: string;
    readonly timestamp: string;
  };
}

export interface ServerErrorLogRecord {
  readonly tag: string;
  readonly category: ServerErrorCategory;
  readonly message: string;
  readonly timestamp: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

export const nowTimestamp = (): string => new Date().toISOString();

export const makeAuthError = (
  input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string },
): AuthError => new AuthError({ ...input, timestamp: input.timestamp ?? nowTimestamp() });

export const makeValidationError = (
  input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string },
): ValidationError =>
  new ValidationError({ ...input, timestamp: input.timestamp ?? nowTimestamp() });

export const makeDatabaseError = (
  input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string },
): DatabaseError =>
  new DatabaseError({ ...input, timestamp: input.timestamp ?? nowTimestamp() });

export const makeNetworkError = (
  input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string },
): NetworkError => new NetworkError({ ...input, timestamp: input.timestamp ?? nowTimestamp() });

export const makeConfigError = (
  input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string },
): ConfigError => new ConfigError({ ...input, timestamp: input.timestamp ?? nowTimestamp() });

export const makeGitError = (
  input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string },
): GitError => new GitError({ ...input, timestamp: input.timestamp ?? nowTimestamp() });

export function errorToResponse(error: StandardServerError): ServerHttpErrorResponse {
  const statusByTag: Record<ServerErrorCategory, ServerHttpErrorResponse["status"]> = {
    AuthError: 401,
    ValidationError: 400,
    DatabaseError: 500,
    NetworkError: 502,
    ConfigError: 500,
    GitError: 422,
  };

  return {
    status: statusByTag[error._tag],
    body: {
      error: error._tag,
      message: error.message,
      timestamp: error.timestamp,
    },
  };
}

export function errorToLog(error: StandardServerError): ServerErrorLogRecord {
  return {
    tag: error._tag,
    category: error._tag,
    message: error.message,
    timestamp: error.timestamp,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
  };
}

export class BootstrapError extends ConfigError {
  constructor(input: Omit<ServerErrorFields, "timestamp"> & { readonly timestamp?: string }) {
    super({ ...input, timestamp: input.timestamp ?? nowTimestamp() });
  }
}

export class DecodeOtlpTraceRecordsError extends ValidationError {
  readonly bodyJson: unknown;

  constructor(input: Omit<ServerErrorFields, "timestamp"> & { readonly bodyJson: unknown }) {
    super({ message: input.message, cause: input.cause, timestamp: nowTimestamp() });
    this.bodyJson = input.bodyJson;
  }
}

export class ProcessSpawnError extends Data.TaggedError("ProcessSpawnError")<{
  readonly category: "NetworkError";
  readonly message: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly cause: unknown;
  readonly timestamp: string;
}> {
  constructor(input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly cause: unknown;
    readonly timestamp?: string;
  }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Failed to spawn process: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessStdinError extends Data.TaggedError("ProcessStdinError")<{
  readonly category: "NetworkError";
  readonly message: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly cause: unknown;
  readonly timestamp: string;
}> {
  constructor(input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly cause: unknown;
    readonly timestamp?: string;
  }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Failed to write stdin for process: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessOutputLimitError extends Data.TaggedError("ProcessOutputLimitError")<{
  readonly category: "NetworkError";
  readonly message: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly stream: "stdout" | "stderr";
  readonly maxBytes: number;
  readonly timestamp: string;
}> {
  constructor(input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly stream: "stdout" | "stderr";
    readonly maxBytes: number;
    readonly timestamp?: string;
  }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Process ${input.stream} exceeded ${input.maxBytes} bytes: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessReadError extends Data.TaggedError("ProcessReadError")<{
  readonly category: "NetworkError";
  readonly message: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly stream: "stdout" | "stderr" | "exitCode";
  readonly cause: unknown;
  readonly timestamp: string;
}> {
  constructor(input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly stream: "stdout" | "stderr" | "exitCode";
    readonly cause: unknown;
    readonly timestamp?: string;
  }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Failed to read process ${input.stream}: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}

export class ProcessTimeoutError extends Data.TaggedError("ProcessTimeoutError")<{
  readonly category: "NetworkError";
  readonly message: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
  readonly timeoutMs: number;
  readonly timestamp: string;
}> {
  constructor(input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly cwd?: string | undefined;
    readonly timeoutMs: number;
    readonly timestamp?: string;
  }) {
    super({
      ...input,
      category: "NetworkError",
      message: `Process timed out after ${input.timeoutMs}ms: ${input.command}`,
      timestamp: input.timestamp ?? nowTimestamp(),
    });
  }
}
