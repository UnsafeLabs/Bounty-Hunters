import * as Schema from "effect/Schema";

/**
 * Centralized server error types using Effect.Data.TaggedEnum pattern.
 * All server modules should import and use these error types for
 * consistent error handling, response formatting, and logging.
 */

export class NetworkError extends Schema.TaggedErrorClass<NetworkError>()("NetworkError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.optional(Schema.Date),
  statusCode: Schema.optional(Schema.Number),
}) {
  override get message() {
    return this.message;
  }
}

export class DatabaseError extends Schema.TaggedErrorClass<DatabaseError>()("DatabaseError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.optional(Schema.Date),
  query: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.message;
  }
}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.optional(Schema.Date),
}) {
  override get message() {
    return this.message;
  }
}

export class GitError extends Schema.TaggedErrorClass<GitError>()("GitError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.optional(Schema.Date),
  command: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.message;
  }
}

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()("ConfigError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.optional(Schema.Date),
  key: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.message;
  }
}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("ValidationError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.optional(Schema.Date),
  field: Schema.optional(Schema.String),
}) {
  override get message() {
    return this.message;
  }
}

export type ServerError = NetworkError | DatabaseError | AuthError | GitError | ConfigError | ValidationError;

const errorStatusMap: Record<string, number> = {
  NetworkError: 502,
  DatabaseError: 500,
  AuthError: 401,
  GitError: 500,
  ConfigError: 500,
  ValidationError: 400,
};

/**
 * Map a server error to an HTTP status code based on its tag.
 */
export const errorToResponse = (error: ServerError): { statusCode: number; body: { error: string; message: string; timestamp?: string } } => {
  const statusCode = errorStatusMap[error._tag] ?? 500;
  return {
    statusCode,
    body: {
      error: error._tag,
      message: error.message,
      timestamp: error.timestamp?.toISOString(),
    },
  };
};

/**
 * Format a server error for structured logging.
 */
export const errorToLog = (error: ServerError): Record<string, unknown> => ({
  error: error._tag,
  message: error.message,
  timestamp: error.timestamp?.toISOString() ?? new Date().toISOString(),
  cause: error.cause ?? null,
});
