import { Data } from "effect";

export class NetworkError extends Data.TaggedError("NetworkError")<{ readonly message: string; readonly cause?: unknown; readonly timestamp: number }> {}
export class DatabaseError extends Data.TaggedError("DatabaseError")<{ readonly message: string; readonly cause?: unknown; readonly timestamp: number }> {}
export class AuthError extends Data.TaggedError("AuthError")<{ readonly message: string; readonly cause?: unknown; readonly timestamp: number }> {}
export class GitError extends Data.TaggedError("GitError")<{ readonly message: string; readonly cause?: unknown; readonly timestamp: number }> {}
export class ConfigError extends Data.TaggedError("ConfigError")<{ readonly message: string; readonly cause?: unknown; readonly timestamp: number }> {}
export class ValidationError extends Data.TaggedError("ValidationError")<{ readonly message: string; readonly cause?: unknown; readonly timestamp: number }> {}

export type ServerError = NetworkError | DatabaseError | AuthError | GitError | ConfigError | ValidationError;

const statusMap: Record<ServerError["_tag"], number> = {
  NetworkError: 503, DatabaseError: 500, AuthError: 401, GitError: 500, ConfigError: 500, ValidationError: 400,
};

export function errorToResponse(error: ServerError) {
  return { status: statusMap[error._tag], body: { error: error._tag, message: error.message } };
}

const logMap: Record<ServerError["_tag"], "debug" | "info" | "warn" | "error" | "fatal"> = {
  NetworkError: "warn", DatabaseError: "error", AuthError: "info", GitError: "error", ConfigError: "fatal", ValidationError: "debug",
};

export function errorToLog(error: ServerError) {
  return { level: logMap[error._tag], message: error.message, tag: error._tag, ...(error.cause ? { cause: error.cause } : {}) };
}

export function createError<T extends new (...args: any) => ServerError>(Cls: T, message: string, cause?: unknown): InstanceType<T> {
  return new Cls({ message, timestamp: Date.now(), ...(cause !== undefined ? { cause } : {}) }) as InstanceType<T>;
}
