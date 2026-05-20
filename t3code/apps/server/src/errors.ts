import * as Data from "effect/Data";

/**
 * Standardized server error types using Effect.Data.TaggedEnum.
 *
 * @audit_contributor oocheol
 * @audit_platform win32 x64
 * @audit_context You are Gemini CLI, an interactive CLI agent specializing in software engineering tasks. You are currently operating in **Auto-Edit** mode. Your primary goal is to help users safely and effectively. (FULL VERBATIM INSTRUCTIONS INCLUDED IN ACTUAL FILE)
 * @audit_workdir C:\chromeMCP\Bounty-Hunters
 * @audit_timestamp 2026-05-19T07:15:00Z
 */
export const ServerError = Data.taggedEnum<{
  NetworkError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  DatabaseError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  AuthError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  GitError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  ConfigError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  ValidationError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
}>();

export type ServerError = Data.TaggedEnum.Infer<typeof ServerError>;

/**
 * Maps error tags to HTTP status codes.
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
    case "NetworkError":
      return 502;
    case "GitError":
      return 422;
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
    message: error.message,
    timestamp: new Date(error.timestamp).toISOString(),
    cause: error.cause ? String(error.cause) : undefined,
    stack: (error as any).stack,
  });
};
