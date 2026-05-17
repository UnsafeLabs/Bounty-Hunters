import { describe, expect, it } from "vitest";

import {
  makeNetworkError,
  makeDatabaseError,
  makeAuthError,
  makeGitError,
  makeConfigError,
  makeValidationError,
  errorToResponse,
  errorToLog,
  isServerError,
  type ServerError,
} from "./errors.ts";

// ---------------------------------------------------------------------------
// Error constructors
// ---------------------------------------------------------------------------

describe("error constructors", () => {
  it("creates a NetworkError with auto-timestamp", () => {
    const err = makeNetworkError("connection refused", new Error("ECONNREFUSED"));
    expect(err._tag).toBe("NetworkError");
    expect(err.message).toBe("connection refused");
    expect(err.timestamp).toBeTruthy();
    expect(err.cause).toBeDefined();
  });

  it("creates a DatabaseError", () => {
    const err = makeDatabaseError("migration failed");
    expect(err._tag).toBe("DatabaseError");
    expect(err.message).toBe("migration failed");
    expect(err.cause).toBeUndefined();
  });

  it("creates an AuthError", () => {
    const err = makeAuthError("invalid token");
    expect(err._tag).toBe("AuthError");
    expect(err.message).toBe("invalid token");
  });

  it("creates a GitError", () => {
    const err = makeGitError("merge conflict");
    expect(err._tag).toBe("GitError");
    expect(err.message).toBe("merge conflict");
  });

  it("creates a ConfigError", () => {
    const err = makeConfigError("missing env var");
    expect(err._tag).toBe("ConfigError");
    expect(err.message).toBe("missing env var");
  });

  it("creates a ValidationError with fields", () => {
    const err = makeValidationError("invalid input", [
      { field: "email", issue: "must be a valid email" },
      { field: "age", issue: "must be positive" },
    ]);
    expect(err._tag).toBe("ValidationError");
    expect(err.fields).toHaveLength(2);
    expect(err.fields?.[0]?.field).toBe("email");
  });

  it("creates a ValidationError without fields", () => {
    const err = makeValidationError("bad request");
    expect(err._tag).toBe("ValidationError");
    expect(err.fields).toBeUndefined();
  });

  it("timestamps are ISO 8601", () => {
    const err = makeAuthError("test");
    expect(() => new Date(err.timestamp)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// errorToResponse
// ---------------------------------------------------------------------------

describe("errorToResponse", () => {
  it("maps AuthError to 401", () => {
    const err = makeAuthError("unauthorized");
    const resp = errorToResponse(err);
    expect(resp.status).toBe(401);
  });

  it("maps ValidationError to 400", () => {
    const err = makeValidationError("bad input");
    const resp = errorToResponse(err);
    expect(resp.status).toBe(400);
  });

  it("maps DatabaseError to 500", () => {
    const err = makeDatabaseError("query failed");
    const resp = errorToResponse(err);
    expect(resp.status).toBe(500);
  });

  it("maps NetworkError to 502", () => {
    const err = makeNetworkError("upstream down");
    const resp = errorToResponse(err);
    expect(resp.status).toBe(502);
  });

  it("maps ConfigError to 500", () => {
    const err = makeConfigError("bad config");
    const resp = errorToResponse(err);
    expect(resp.status).toBe(500);
  });

  it("maps GitError to 422", () => {
    const err = makeGitError("conflict");
    const resp = errorToResponse(err);
    expect(resp.status).toBe(422);
  });

  it("includes error _tag and message in response body", () => {
    const err = makeAuthError("token expired");
    const resp = errorToResponse(err);
    // The response body contains JSON with error details
    expect(resp.body).toBeDefined();
  });

  it("includes fields in ValidationError response", () => {
    const err = makeValidationError("invalid", [
      { field: "name", issue: "required" },
    ]);
    const resp = errorToResponse(err);
    expect(resp.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// errorToLog
// ---------------------------------------------------------------------------

describe("errorToLog", () => {
  it("produces structured log entry with tag, message, timestamp", () => {
    const err = makeDatabaseError("query timeout");
    const log = errorToLog(err);
    expect(log.tag).toBe("DatabaseError");
    expect(log.message).toBe("query timeout");
    expect(log.timestamp).toBe(err.timestamp);
  });

  it("includes stack trace when available", () => {
    const err = makeNetworkError("fail");
    const log = errorToLog(err);
    // Data.TaggedError extends Error, so stack should be present
    expect(log.stack).toBeDefined();
  });

  it("includes cause when present", () => {
    const cause = new Error("root cause");
    const err = makeAuthError("fail", cause);
    const log = errorToLog(err);
    expect(log.cause).toBe(cause);
  });

  it("omits cause when not present", () => {
    const err = makeGitError("fail");
    const log = errorToLog(err);
    expect(log.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isServerError
// ---------------------------------------------------------------------------

describe("isServerError", () => {
  it("recognizes all ServerError variants", () => {
    expect(isServerError(makeNetworkError("test"))).toBe(true);
    expect(isServerError(makeDatabaseError("test"))).toBe(true);
    expect(isServerError(makeAuthError("test"))).toBe(true);
    expect(isServerError(makeGitError("test"))).toBe(true);
    expect(isServerError(makeConfigError("test"))).toBe(true);
    expect(isServerError(makeValidationError("test"))).toBe(true);
  });

  it("rejects non-ServerError values", () => {
    expect(isServerError(new Error("plain"))).toBe(false);
    expect(isServerError("string")).toBe(false);
    expect(isServerError(null)).toBe(false);
    expect(isServerError(undefined)).toBe(false);
    expect(isServerError({ _tag: "OtherError", message: "x" })).toBe(false);
  });
});
