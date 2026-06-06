import { describe, expect, it } from "@effect/vitest";
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
  makeAuthError,
  makeConfigError,
  makeDatabaseError,
  makeGitError,
  makeNetworkError,
  makeValidationError,
  ProcessTimeoutError,
} from "./errors.ts";

const fixedTimestamp = "2026-06-06T23:59:00.000Z";

describe("server errors", () => {
  it("maps all standard server error tags to HTTP responses", () => {
    const errors = [
      [new AuthError({ message: "auth", timestamp: fixedTimestamp }), 401],
      [new ValidationError({ message: "validation", timestamp: fixedTimestamp }), 400],
      [new DatabaseError({ message: "database", timestamp: fixedTimestamp }), 500],
      [new NetworkError({ message: "network", timestamp: fixedTimestamp }), 502],
      [new ConfigError({ message: "config", timestamp: fixedTimestamp }), 500],
      [new GitError({ message: "git", timestamp: fixedTimestamp }), 422],
    ] as const;

    for (const [error, status] of errors) {
      expect(errorToResponse(error)).toEqual({
        status,
        body: {
          error: error._tag,
          message: error.message,
          timestamp: fixedTimestamp,
        },
      });
    }
  });

  it("constructors attach timestamps and preserve cause chains", () => {
    const cause = new Error("root cause");
    const error = makeDatabaseError({
      message: "database unavailable",
      cause,
      timestamp: fixedTimestamp,
    });

    expect(error._tag).toBe("DatabaseError");
    expect(error.cause).toBe(cause);
    expect(error.timestamp).toBe(fixedTimestamp);
  });

  it("formats structured log records with tag, message, stack, cause, and timestamp", () => {
    const cause = { code: "ECONNREFUSED" };
    const error = makeNetworkError({
      message: "upstream failed",
      cause,
      timestamp: fixedTimestamp,
    });
    const log = errorToLog(error);

    expect(log).toMatchObject({
      tag: "NetworkError",
      category: "NetworkError",
      message: "upstream failed",
      timestamp: fixedTimestamp,
      cause,
    });
    expect(typeof log.stack).toBe("string");
  });

  it("supports Effect.Match pattern matching by error tag", () => {
    const classify = (error:
      | AuthError
      | ValidationError
      | DatabaseError
      | NetworkError
      | ConfigError
      | GitError) =>
      Match.value(error).pipe(
        Match.tag("AuthError", () => "auth"),
        Match.tag("ValidationError", () => "validation"),
        Match.tag("DatabaseError", () => "database"),
        Match.tag("NetworkError", () => "network"),
        Match.tag("ConfigError", () => "config"),
        Match.tag("GitError", () => "git"),
        Match.exhaustive,
      );

    expect(classify(makeAuthError({ message: "auth", timestamp: fixedTimestamp }))).toBe("auth");
    expect(
      classify(makeValidationError({ message: "validation", timestamp: fixedTimestamp })),
    ).toBe("validation");
    expect(classify(makeDatabaseError({ message: "database", timestamp: fixedTimestamp }))).toBe(
      "database",
    );
    expect(classify(makeNetworkError({ message: "network", timestamp: fixedTimestamp }))).toBe(
      "network",
    );
    expect(classify(makeConfigError({ message: "config", timestamp: fixedTimestamp }))).toBe(
      "config",
    );
    expect(classify(makeGitError({ message: "git", timestamp: fixedTimestamp }))).toBe("git");
  });

  it("keeps migrated process errors tagged for existing process matching while adding category metadata", () => {
    const error = new ProcessTimeoutError({
      command: "git",
      args: ["status"],
      timeoutMs: 15000,
      timestamp: fixedTimestamp,
    });

    expect(error._tag).toBe("ProcessTimeoutError");
    expect(error.category).toBe("NetworkError");
    expect(error.timestamp).toBe(fixedTimestamp);
  });
});
