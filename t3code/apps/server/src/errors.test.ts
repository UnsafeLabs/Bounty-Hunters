import { describe, expect, it } from "vitest";
import * as Match from "effect/Match";

import {
  AuthError,
  ConfigError,
  DatabaseError,
  errorToLog,
  errorToResponse,
  GitError,
  NetworkError,
  type ServerError,
  ValidationError,
} from "./errors.ts";

const timestamp = "2026-05-16T00:00:00.000Z";

describe("server errors", () => {
  it("maps every server error type to the expected HTTP response", () => {
    const cases: ReadonlyArray<readonly [ServerError, number]> = [
      [AuthError({ message: "auth failed", timestamp }), 401],
      [ValidationError({ message: "invalid input", timestamp }), 400],
      [DatabaseError({ message: "database failed", timestamp }), 500],
      [NetworkError({ message: "upstream failed", timestamp }), 502],
      [ConfigError({ message: "config failed", timestamp }), 500],
      [GitError({ message: "git failed", timestamp }), 422],
    ];

    for (const [error, status] of cases) {
      expect(errorToResponse(error)).toEqual({
        status,
        body: {
          error: error.message,
          tag: error._tag,
          timestamp,
        },
      });
    }
  });

  it("preserves cause chains in structured logs", () => {
    const rootCause = new Error("root cause");
    const parentCause = new Error("parent cause", { cause: rootCause });
    const error = DatabaseError({
      message: "could not write event",
      cause: parentCause,
      timestamp,
    });

    expect(error.cause).toBe(parentCause);
    expect(errorToLog(error)).toMatchObject({
      tag: "DatabaseError",
      message: "could not write event",
      timestamp,
      cause: {
        message: "parent cause",
        cause: {
          message: "root cause",
        },
      },
    });
    expect(errorToLog(error).cause?.stack).toContain("parent cause");
  });

  it("supports exhaustive Effect Match pattern matching by tag", () => {
    const toCategory = Match.type<ServerError>().pipe(
      Match.tag("AuthError", () => "auth"),
      Match.tag("ValidationError", () => "validation"),
      Match.tag("DatabaseError", () => "database"),
      Match.tag("NetworkError", () => "network"),
      Match.tag("ConfigError", () => "config"),
      Match.tag("GitError", () => "git"),
      Match.exhaustive,
    );

    expect(toCategory(GitError({ message: "merge conflict", timestamp }))).toBe("git");
  });
});
