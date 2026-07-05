import { describe, expect, it } from "vitest";
import * as Match from "effect/Match";

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
  it("maps canonical tags to HTTP responses", () => {
    const timestamp = "2026-07-05T00:00:00.000Z";

    expect(errorToResponse(AuthError({ message: "auth", timestamp })).status).toBe(401);
    expect(errorToResponse(ValidationError({ message: "validation", timestamp })).status).toBe(400);
    expect(errorToResponse(DatabaseError({ message: "database", timestamp })).status).toBe(500);
    expect(errorToResponse(NetworkError({ message: "network", timestamp })).status).toBe(502);
    expect(errorToResponse(ConfigError({ message: "config", timestamp })).status).toBe(500);
    expect(errorToResponse(GitError({ message: "git", timestamp })).status).toBe(422);
  });

  it("preserves cause chains for structured logs", () => {
    const root = new Error("disk unavailable");
    const wrapped = new Error("settings load failed");
    Object.assign(wrapped, { cause: root });

    const log = errorToLog(
      DatabaseError({
        message: "database open failed",
        cause: wrapped,
        timestamp: "2026-07-05T00:00:00.000Z",
      }),
    );

    expect(log).toMatchObject({
      tag: "DatabaseError",
      message: "database open failed",
      timestamp: "2026-07-05T00:00:00.000Z",
    });
    expect(log.stack).toContain("settings load failed");
    expect(log.causeChain.map((cause) => cause.message)).toEqual([
      "settings load failed",
      "disk unavailable",
    ]);
  });

  it("supports Effect Match tag pattern matching", () => {
    const classify = Match.typeTags<ServerError, string>()({
      AuthError: () => "auth",
      ValidationError: () => "client",
      DatabaseError: () => "server",
      NetworkError: () => "upstream",
      ConfigError: () => "server",
      GitError: () => "git",
    });

    expect(classify(GitError({ message: "bad ref", timestamp: "2026-07-05T00:00:00.000Z" }))).toBe(
      "git",
    );
  });
});
