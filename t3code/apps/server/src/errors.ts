import * as Data from "effect/Data"
import * as Match from "effect/Match"

export type ServerError = Data.TaggedEnum<{
  NetworkError: { message: string, cause?: unknown, timestamp: number }
  DatabaseError: { message: string, cause?: unknown, timestamp: number }
  AuthError: { message: string, cause?: unknown, timestamp: number }
  GitError: { message: string, cause?: unknown, timestamp: number }
  ConfigError: { message: string, cause?: unknown, timestamp: number }
  ValidationError: { message: string, cause?: unknown, timestamp: number }
}>

export const ServerError = Data.taggedEnum<ServerError>()

export const errorToResponse = (error: ServerError): { status: number, body: string } => {
  return Match.value(error).pipe(
    Match.tag("AuthError", () => ({ status: 401, body: error.message })),
    Match.tag("ValidationError", () => ({ status: 400, body: error.message })),
    Match.tag("DatabaseError", () => ({ status: 500, body: error.message })),
    Match.tag("NetworkError", () => ({ status: 502, body: error.message })),
    Match.tag("ConfigError", () => ({ status: 500, body: error.message })),
    Match.tag("GitError", () => ({ status: 422, body: error.message })),
    Match.exhaustive
  )
}

export const errorToLog = (error: ServerError): string => {
  return JSON.stringify({
    tag: error._tag,
    message: error.message,
    cause: error.cause,
    timestamp: error.timestamp,
    stack: (error.cause instanceof Error) ? error.cause.stack : undefined
  })
}
