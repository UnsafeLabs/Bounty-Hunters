import * as Data from "effect/Data";
import { type SchemaError } from "effect/Schema";

/**
 * Standardized server error types using Effect.Data.TaggedEnum.
 * This provides a unified interface for all internal errors, enabling
 * consistent logging, HTTP response mapping, and type-safe pattern matching.
 *
 * @audit_contributor oocheol
 * @audit_platform win32 x64
 * @audit_context Advanced Error Standardization (#861)
 * @audit_workdir C:\chromeMCP\Bounty-Hunters
 * @audit_timestamp 2026-05-21T03:00:00Z
 */
export const ServerError = Data.taggedEnum<{
  /** Low-level network or connection failures */
  NetworkError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  
  /** Database/SQL execution failures */
  DatabaseError: { readonly operation: string; readonly detail: string; readonly cause?: unknown; readonly timestamp: number };
  
  /** Failures during data decoding/validation (Schema errors) */
  DecodeError: { readonly operation: string; readonly issue: string; readonly cause?: unknown; readonly timestamp: number };
  
  /** Authentication or Authorization failures */
  AuthError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  
  /** Git operation or filesystem repository failures */
  GitError: { readonly operation: string; readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  
  /** Application configuration or environment failures */
  ConfigError: { readonly key?: string; readonly message: string; readonly timestamp: number };
  
  /** High-level business logic or request validation failures */
  ValidationError: { readonly field?: string; readonly message: string; readonly timestamp: number };
}>();

export type ServerError = Data.TaggedEnum.Infer<typeof ServerError>;

// ===============================
// Factory Utilities
// ===============================

export const makeDatabaseError = (operation: string, detail: string, cause?: unknown): ServerError =>
  ServerError.DatabaseError({ operation, detail, cause, timestamp: Date.now() });

export const makeDecodeError = (operation: string, issue: string, cause?: unknown): ServerError =>
  ServerError.DecodeError({ operation, issue, cause, timestamp: Date.now() });

export const makeAuthError = (message: string, cause?: unknown): ServerError =>
  ServerError.AuthError({ message, cause, timestamp: Date.now() });

// ===============================
// Response Mapping
// ===============================

/**
 * Maps ServerError instances to appropriate HTTP status codes.
 */
export const errorToResponse = (error: ServerError): number => {
  switch (error._tag) {
    case "AuthError":
      return 401;
    case "ValidationError":
      return 400;
    case "DatabaseError":
    case "ConfigError":
      return 500;
    case "DecodeError":
      return 422;
    case "NetworkError":
      return 502;
    case "GitError":
      return 500;
    default:
      return 500;
  }
};

/**
 * Formats errors for structured logging.
 */
export const errorToLog = (error: ServerError): string => {
  return JSON.stringify({
    tag: error._tag,
    timestamp: new Date(error.timestamp).toISOString(),
    ...error,
  });
};
