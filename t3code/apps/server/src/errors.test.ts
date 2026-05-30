import { describe, expect, it } from "vitest";
import * as Match from "effect/Match";

import {
  AuthError,
  ConfigError,
  DatabaseError,
  GitError,
  NetworkError,
  ValidationError,
  errorToLog,
  errorToResponse,
  isServerError,
  type ServerError,
} from "./errors.ts";

const timestamp = "2026-05-30T05:30:00.000Z";

describe("server errors", () => {
  it("constructs centralized tagged errors with timestamps and causes", () => {
    const cause = new Error("token expired");
    const error = AuthError({
      message: "Authentication failed.",
      cause,
      timestamp,
    });

    expect(error._tag).toBe("AuthError");
    expect(error.message).toBe("Authentication failed.");
    expect(error.timestamp).toBe(timestamp);
    expect(error.cause).toBe(cause);
    expect(isServerError(error)).toBe(true);
  });

  it("maps every server error category to the expected HTTP status", () => {
    const cases: ReadonlyArray<readonly [ServerError, number]> = [
      [AuthError({ message: "auth", timestamp }), 401],
      [ValidationError({ message: "validation", timestamp }), 400],
      [DatabaseError({ message: "database", timestamp }), 500],
      [NetworkError({ message: "network", timestamp }), 502],
      [ConfigError({ message: "config", timestamp }), 500],
      [GitError({ message: "git", timestamp }), 422],
    ];

    for (const [error, status] of cases) {
      expect(errorToResponse(error)).toEqual({
        status,
        body: {
          error: error._tag,
          message: error.message,
          timestamp,
        },
      });
    }
  });

  it("formats structured logs with tag, message, stack, timestamp, and details", () => {
    const cause = new Error("sqlite locked");
    const error = DatabaseError({
      message: "Persistence failed.",
      cause,
      details: {
        operation: "write",
      },
      timestamp,
    });

    const log = errorToLog(error);

    expect(log.tag).toBe("DatabaseError");
    expect(log.message).toBe("Persistence failed.");
    expect(log.timestamp).toBe(timestamp);
    expect(log.stack).toContain("sqlite locked");
    expect(log.cause).toBe("sqlite locked");
    expect(log.details).toEqual({
      operation: "write",
    });
  });

  it("supports Effect.Match pattern matching on error tags", () => {
    const matchMessage = (error: ServerError) =>
      Match.valueTags(error, {
        AuthError: () => "auth",
        ValidationError: () => "validation",
        DatabaseError: () => "database",
        NetworkError: () => "network",
        ConfigError: () => "config",
        GitError: (error) => `git:${error.message}`,
      });

    expect(matchMessage(GitError({ message: "push rejected", timestamp }))).toBe(
      "git:push rejected",
    );
  });
});
