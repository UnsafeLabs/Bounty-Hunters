/**
 * Standardized error types using Effect.Data.Tagged pattern.
 * Provides consistent error handling across the server codebase.
 */

import { Data, Effect } from "effect";

export type AppErrorTag =
  | "NotFound"
  | "Unauthorized"
  | "Forbidden"
  | "ValidationError"
  | "Conflict"
  | "InternalServerError"
  | "ServiceUnavailable";

export interface AppError<Data extends object = Record<string, unknown>> {
  readonly _tag: AppErrorTag;
  readonly message: string;
  readonly details?: Data;
  readonly timestamp: number;
}

export const AppErrors = {
  notFound: (resource: string, id: string): AppError =>
    Data.taggedError<AppError>("NotFound", {
      message: "Resource " + resource + " not found",
      details: { resource, id },
      timestamp: Date.now(),
    }),

  unauthorized: (reason: string): AppError =>
    Data.taggedError<AppError>("Unauthorized", {
      message: "Unauthorized: " + reason,
      details: { reason },
      timestamp: Date.now(),
    }),

  forbidden: (reason: string): AppError =>
    Data.taggedError<AppError>("Forbidden", {
      message: "Forbidden: " + reason,
      details: { reason },
      timestamp: Date.now(),
    }),

  validationError: (field: string, message: string): AppError =>
    Data.taggedError<AppError>("ValidationError", {
      message: "Validation failed: " + message,
      details: { field, message },
      timestamp: Date.now(),
    }),

  conflict: (message: string): AppError =>
    Data.taggedError<AppError>("Conflict", {
      message,
      timestamp: Date.now(),
    }),

  internal: (message: string): AppError =>
    Data.taggedError<AppError>("InternalServerError", {
      message,
      timestamp: Date.now(),
    }),

  serviceUnavailable: (service: string): AppError =>
    Data.taggedError<AppError>("ServiceUnavailable", {
      message: "Service unavailable: " + service,
      details: { service },
      timestamp: Date.now(),
    }),
};