/**
 * Standardized server error types using Effect.Data.TaggedEnum.
 * Provides consistent error handling across the codebase.
 */

import { Data } from "effect";

/**
 * Base application error using Effect Data.TaggedEnum
 */
export class AppError extends Data.TaggedEnum("AppError")<{
  NotFound: { readonly resource: string; readonly id: string | number };
  Unauthorized: { readonly reason: string };
  Forbidden: { readonly resource: string; readonly action: string };
  Validation: { readonly field: string; readonly message: string };
  Conflict: { readonly resource: string; readonly detail: string };
  Internal: { readonly message: string; readonly cause?: unknown };
  Timeout: { readonly operation: string; readonly timeoutMs: number };
  RateLimited: { readonly retryAfterMs: number };
  External: { readonly service: string; readonly detail: string };
}> {}

/**
 * Error to HTTP status code mapping
 */
export const errorToStatusCode = (error: AppError): number => {
  switch (error._tag) {
    case "NotFound": return 404;
    case "Unauthorized": return 401;
    case "Forbidden": return 403;
    case "Validation": return 422;
    case "Conflict": return 409;
    case "Internal": return 500;
    case "Timeout": return 504;
    case "RateLimited": return 429;
    case "External": return 502;
  }
};

/**
 * Error to user-friendly message
 */
export const errorToMessage = (error: AppError): string => {
  switch (error._tag) {
    case "NotFound": return `${error.resource} with id ${error.id} not found`;
    case "Unauthorized": return error.reason;
    case "Forbidden": return `Not allowed to ${error.action} ${error.resource}`;
    case "Validation": return `Invalid ${error.field}: ${error.message}`;
    case "Conflict": return `Conflict with ${error.resource}: ${error.detail}`;
    case "Internal": return "An internal error occurred";
    case "Timeout": return `Operation ${error.operation} timed out`;
    case "RateLimited": return `Rate limited. Retry after ${error.retryAfterMs}ms`;
    case "External": return `External service ${error.service} error: ${error.detail}`;
  }
};

/**
 * Convert AppError to JSON response
 */
export const errorToJson = (error: AppError) => ({
  error: {
    type: error._tag,
    message: errorToMessage(error),
    statusCode: errorToStatusCode(error),
  },
});
