import * as Match from "effect/Match";
import { describe, expect, it } from "vitest";

import {
  AuthError,
  ConfigError,
  DatabaseError,
  GitError,
  NetworkError,
  type ServerError,
  ValidationError,
  errorToLog,
  errorToResponse,
} from "./errors.ts";

describe("server errors", () => {
  it("maps every server error tag to the expected HTTP status code", () => {
    expect(errorToResponse(AuthError({ message: "missing token" })).status).toBe(401);
    expect(errorToResponse(ValidationError({ message: "bad input" })).status).toBe(400);
    expect(errorToResponse(DatabaseError({ message: "query failed" })).status).toBe(500);
    expect(errorToResponse(NetworkError({ message: "upstream failed" })).status).toBe(502);
    expect(errorToResponse(ConfigError({ message: "missing env" })).status).toBe(500);
    expect(errorToResponse(GitError({ message: "rebase failed" })).status).toBe(422);
  });

  it("formats structured logs with tag, message, stack, timestamp, and cause chain", () => {
    const cause = new Error("root cause");
    const error = GitError({
      message: "git command failed",
      cause,
      timestamp: "2026-05-30T00:00:00.000Z",
    });

    expect(errorToLog(error)).toMatchObject({
      tag: "GitError",
      message: "git command failed",
      timestamp: "2026-05-30T00:00:00.000Z",
      cause: {
        message: "root cause",
      },
    });
    expect(errorToLog(error).stack).toEqual(expect.any(String));
  });

  it("supports exhaustive pattern matching by error tag", () => {
    const error: ServerError = ValidationError({ message: "missing project id" });

    const matchServerError = Match.type<ServerError>().pipe(
      Match.tag("AuthError", () => "auth"),
      Match.tag("ConfigError", () => "config"),
      Match.tag("DatabaseError", () => "database"),
      Match.tag("GitError", () => "git"),
      Match.tag("NetworkError", () => "network"),
      Match.tag("ValidationError", () => "validation"),
      Match.exhaustive,
    );

    expect(matchServerError(error)).toBe("validation");
  });
});
