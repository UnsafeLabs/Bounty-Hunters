import { Effect, Data } from "effect";

// Standardized server error types using Effect.Data.Error (#861)

export class ServerError extends Data.Error {
  readonly _tag = "ServerError";
  constructor(readonly code: string, readonly message: string, readonly statusCode: number = 500) {
    super();
  }
}

export class AuthenticationError extends ServerError {
  readonly _tag = "AuthenticationError";
  constructor(message: string = "Authentication required") {
    super("AUTH_FAILED", message, 401);
  }
}

export class AuthorizationError extends ServerError {
  readonly _tag = "AuthorizationError";
  constructor(message: string = "Insufficient permissions") {
    super("AUTHZ_FAILED", message, 403);
  }
}

export class ValidationError extends ServerError {
  readonly _tag = "ValidationError";
  constructor(message: string, readonly fields?: Record<string, string>) {
    super("VALIDATION_FAILED", message, 400);
  }
}

export class NotFoundError extends ServerError {
  readonly _tag = "NotFoundError";
  constructor(resource: string, id?: string) {
    super("NOT_FOUND", `${resource}${id ? ` ${id}` : ""} not found`, 404);
  }
}

export class RateLimitError extends ServerError {
  readonly _tag = "RateLimitError";
  constructor(readonly retryAfter: number = 60) {
    super("RATE_LIMITED", "Too many requests", 429);
  }
}

export class ProviderError extends ServerError {
  readonly _tag = "ProviderError";
  constructor(readonly provider: string, message: string) {
    super("PROVIDER_ERROR", `Provider ${provider}: ${message}`, 502);
  }
}

export class TimeoutError extends ServerError {
  readonly _tag = "TimeoutError";
  constructor(operation: string, readonly elapsed: number) {
    super("TIMEOUT", `${operation} timed out after ${elapsed}ms`, 504);
  }
}

export class ConfigurationError extends ServerError {
  readonly _tag = "ConfigurationError";
  constructor(message: string) {
    super("CONFIG_ERROR", message, 500);
  }
}

// Helper to convert any error to standardized ServerError
export const toServerError = (error: unknown): ServerError => {
  if (error instanceof ServerError) return error;
  if (error instanceof Error) {
    return new ServerError("INTERNAL_ERROR", error.message, 500);
  }
  return new ServerError("UNKNOWN_ERROR", String(error), 500);
};
