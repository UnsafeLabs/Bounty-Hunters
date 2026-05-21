import * as Data from "effect/Data";

export type ServerError = Data.TaggedEnum<{
  NetworkError: { readonly message: string; readonly statusCode?: number };
  DatabaseError: { readonly message: string; readonly cause?: unknown };
  AuthError: { readonly message: string; readonly userId?: string };
  GitError: { readonly message: string; readonly exitCode?: number };
  ConfigError: { readonly message: string; readonly key?: string };
  ValidationError: { readonly message: string; readonly field?: string };
  ProviderError: { readonly message: string; readonly providerId?: string };
  WebSocketError: { readonly message: string; readonly connectionId?: string };
  UnknownError: { readonly message: string; readonly cause?: unknown };
}>;

export const ServerError = Data.taggedEnum<ServerError>();

export function serverErrorToMessage(error: ServerError): string {
  switch (error._tag) {
    case "NetworkError":
      return `Network error (${error.statusCode ?? "unknown"}): ${error.message}`;
    case "DatabaseError":
      return `Database error: ${error.message}`;
    case "AuthError":
      return `Auth error${error.userId ? ` for user ${error.userId}` : ""}: ${error.message}`;
    case "GitError":
      return `Git error (exit ${error.exitCode ?? "?"}): ${error.message}`;
    case "ConfigError":
      return `Config error${error.key ? ` for key ${error.key}` : ""}: ${error.message}`;
    case "ValidationError":
      return `Validation error${error.field ? ` on ${error.field}` : ""}: ${error.message}`;
    case "ProviderError":
      return `Provider error (${error.providerId ?? "unknown"}): ${error.message}`;
    case "WebSocketError":
      return `WebSocket error (${error.connectionId ?? "unknown"}): ${error.message}`;
    case "UnknownError":
      return `Unknown error: ${error.message}`;
  }
}
