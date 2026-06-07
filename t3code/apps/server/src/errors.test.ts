import { describe, expect, it } from "@effect/vitest";
import * as Match from "effect/Match";

import {
  AuthError,
  BootstrapError,
  DecodeOtlpTraceRecordsError,
  ProcessTimeoutError,
  ServerError,
  errorToLog,
  errorToResponse,
  makeAuthError,
  makeConfigError,
  makeDatabaseError,
  makeGitError,
  makeNetworkError,
  makeValidationError,
  toStandardServerError,
  type StandardServerError,
} from "./errors.ts";

const fixedTimestamp = "2026-06-07T09:45:00.000Z";

describe("server errors", () => {
  it("defines all standard categories with Data.TaggedEnum constructors", () => {
    const errors = [
      makeAuthError({ message: "auth", timestamp: fixedTimestamp }),
      makeValidationError({ message: "validation", timestamp: fixedTimestamp }),
      makeDatabaseError({ message: "database", timestamp: fixedTimestamp }),
      makeNetworkError({ message: "network", timestamp: fixedTimestamp }),
      makeConfigError({ message: "config", timestamp: fixedTimestamp }),
      makeGitError({ message: "git", timestamp: fixedTimestamp }),
    ];

    expect(errors.map((error) => error._tag)).toEqual([
      "AuthError",
      "ValidationError",
      "DatabaseError",
      "NetworkError",
      "ConfigError",
      "GitError",
    ]);
    expect(ServerError.$is("AuthError")(errors[0])).toBe(true);
    expect(ServerError.$is("GitError")(errors[5])).toBe(true);
  });

  it("maps all standard server error tags to HTTP responses", () => {
    const cases = [
      [makeAuthError({ message: "auth", timestamp: fixedTimestamp }), 401],
      [makeValidationError({ message: "validation", timestamp: fixedTimestamp }), 400],
      [makeDatabaseError({ message: "database", timestamp: fixedTimestamp }), 500],
      [makeNetworkError({ message: "network", timestamp: fixedTimestamp }), 502],
      [makeConfigError({ message: "config", timestamp: fixedTimestamp }), 500],
      [makeGitError({ message: "git", timestamp: fixedTimestamp }), 422],
    ] as const;

    for (const [error, status] of cases) {
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

  it("supports Effect.Match pattern matching by error tag", () => {
    const classify = (error: StandardServerError) =>
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

  it("preserves cause chains and structured log fields", () => {
    const cause = new Error("root cause");
    const error = makeDatabaseError({
      message: "database unavailable",
      cause,
      timestamp: fixedTimestamp,
    });
    const log = errorToLog(error);

    expect(log).toMatchObject({
      tag: "DatabaseError",
      category: "DatabaseError",
      message: "database unavailable",
      timestamp: fixedTimestamp,
      cause,
    });
  });

  it("normalizes migrated class-based errors to the standard tagged enum", () => {
    const authError = new AuthError({
      message: "owner only",
      status: 403,
      timestamp: fixedTimestamp,
    });
    const bootstrapError = new BootstrapError({
      message: "bootstrap failed",
      timestamp: fixedTimestamp,
    });
    const traceError = new DecodeOtlpTraceRecordsError({
      message: "bad trace",
      bodyJson: { resourceSpans: [] },
      timestamp: fixedTimestamp,
    });
    const processError = new ProcessTimeoutError({
      command: "git",
      args: ["status"],
      timeoutMs: 1000,
      timestamp: fixedTimestamp,
    });

    expect(toStandardServerError(authError)._tag).toBe("AuthError");
    expect(errorToResponse(authError).status).toBe(403);
    expect(toStandardServerError(bootstrapError)._tag).toBe("ConfigError");
    expect(toStandardServerError(traceError)._tag).toBe("ValidationError");
    expect(toStandardServerError(processError)._tag).toBe("NetworkError");
    expect(errorToLog(processError)).toMatchObject({
      tag: "ProcessTimeoutError",
      category: "NetworkError",
      timestamp: fixedTimestamp,
    });
  });
});
