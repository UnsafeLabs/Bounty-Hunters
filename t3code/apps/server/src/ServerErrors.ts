import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

/**
 * Standardized server error types using Effect.Data.TaggedEnum.
 *
 * All server errors extend a common base and include:
 * - A unique tag for pattern matching
 * - A human-readable message
 * - An optional cause for error chaining
 * - An HTTP status code for API responses
 * - A machine-readable error code
 */

// Base error shape
const ServerErrorShape = Schema.Struct({
  message: Schema.String,
  code: Schema.String,
  statusCode: Schema.Number,
  cause: Schema.optional(Schema.Defect),
  timestamp: Schema.String,
});

// Tagged error definitions
export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()(
  "ConfigError",
  {
    ...ServerErrorShape.fields,
    field: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Configuration error: ${this.field ?? "unknown"} — ${this.code}`;
  }
}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()(
  "AuthError",
  {
    ...ServerErrorShape.fields,
    userId: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Authentication error: ${this.code}${this.userId ? ` for user ${this.userId}` : ""}`;
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    ...ServerErrorShape.fields,
    resource: Schema.optional(Schema.String),
    resourceId: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Not found: ${this.resource ?? "resource"}${this.resourceId ? ` (${this.resourceId})` : ""}`;
  }
}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()(
  "ValidationError",
  {
    ...ServerErrorShape.fields,
    field: Schema.optional(Schema.String),
    value: Schema.optional(Schema.Unknown),
  },
) {
  override get message(): string {
    return `Validation error: ${this.field ?? "unknown field"} — ${this.code}`;
  }
}

export class RateLimitError extends Schema.TaggedErrorClass<RateLimitError>()(
  "RateLimitError",
  {
    ...ServerErrorShape.fields,
    retryAfter: Schema.optional(Schema.Number),
  },
) {
  override get message(): string {
    return `Rate limit exceeded: ${this.code}${this.retryAfter ? ` (retry after ${this.retryAfter}s)` : ""}`;
  }
}

export class DatabaseError extends Schema.TaggedErrorClass<DatabaseError>()(
  "DatabaseError",
  {
    ...ServerErrorShape.fields,
    query: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Database error: ${this.code}${this.query ? ` in query: ${this.query}` : ""}`;
  }
}

export class ProviderError extends Schema.TaggedErrorClass<ProviderError>()(
  "ProviderError",
  {
    ...ServerErrorShape.fields,
    providerId: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return `Provider error: ${this.code}${this.providerId ? ` (provider: ${this.providerId})` : ""}`;
  }
}

export class InternalServerError extends Schema.TaggedErrorClass<InternalServerError>()(
  "InternalServerError",
  {
    ...ServerErrorShape.fields,
  },
) {
  override get message(): string {
    return `Internal server error: ${this.code}`;
  }
}

// Union type for all server errors
export type ServerError =
  | ConfigError
  | AuthError
  | NotFoundError
  | ValidationError
  | RateLimitError
  | DatabaseError
  | ProviderError
  | InternalServerError;

// Helper to create errors with timestamp
function makeTimestamp(): string {
  return new Date().toISOString();
}

// Factory functions
export const configError = (code: string, message: string, field?: string): ConfigError =>
  new ConfigError({
    message,
    code,
    statusCode: 500,
    field,
    timestamp: makeTimestamp(),
  });

export const authError = (code: string, message: string, userId?: string): AuthError =>
  new AuthError({
    message,
    code,
    statusCode: 401,
    userId,
    timestamp: makeTimestamp(),
  });

export const notFoundError = (resource: string, resourceId?: string): NotFoundError =>
  new NotFoundError({
    message: `Not found: ${resource}${resourceId ? ` (${resourceId})` : ""}`,
    code: "NOT_FOUND",
    statusCode: 404,
    resource,
    resourceId,
    timestamp: makeTimestamp(),
  });

export const validationError = (code: string, message: string, field?: string): ValidationError =>
  new ValidationError({
    message,
    code,
    statusCode: 400,
    field,
    timestamp: makeTimestamp(),
  });

export const rateLimitError = (code: string, message: string, retryAfter?: number): RateLimitError =>
  new RateLimitError({
    message,
    code,
    statusCode: 429,
    retryAfter,
    timestamp: makeTimestamp(),
  });

export const databaseError = (code: string, message: string, query?: string): DatabaseError =>
  new DatabaseError({
    message,
    code,
    statusCode: 500,
    query,
    timestamp: makeTimestamp(),
  });

export const providerError = (code: string, message: string, providerId?: string): ProviderError =>
  new ProviderError({
    message,
    code,
    statusCode: 502,
    providerId,
    timestamp: makeTimestamp(),
  });

export const internalServerError = (code: string, message: string): InternalServerError =>
  new InternalServerError({
    message,
    code,
    statusCode: 500,
    timestamp: makeTimestamp(),
  });

// HTTP status code mapping
export const statusCodeFor = (error: ServerError): number => error.statusCode;

// JSON serialization for API responses
export const serializeError = (error: ServerError): Record<string, unknown> => ({
  error: error._tag,
  code: error.code,
  message: error.message,
  statusCode: error.statusCode,
  timestamp: error.timestamp,
  ...(error.cause ? { cause: String(error.cause) } : {}),
});
