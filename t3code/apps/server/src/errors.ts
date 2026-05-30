import { Data, Match } from "effect";

export type ServerError = Data.TaggedEnum<{
  NetworkError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  DatabaseError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  AuthError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  GitError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  ConfigError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
  ValidationError: { readonly message: string; readonly cause?: unknown; readonly timestamp: number };
}>;

export const ServerError = Data.taggedEnum<ServerError>();

export const errorToResponse = (error: ServerError): number =>
  Match.value(error).pipe(
    Match.tag("AuthError", () => 401),
    Match.tag("ValidationError", () => 400),
    Match.tag("DatabaseError", () => 500),
    Match.tag("NetworkError", () => 502),
    Match.tag("ConfigError", () => 500),
    Match.tag("GitError", () => 422),
    Match.exhaustive
  );

export const errorToLog = (error: ServerError) => {
  let stackTrace = undefined;
  if (error.cause instanceof Error && error.cause.stack) {
    stackTrace = error.cause.stack;
  }
  return {
    tag: error._tag,
    message: error.message,
    stackTrace,
    timestamp: error.timestamp,
  };
};
