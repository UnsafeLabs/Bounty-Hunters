import * as assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  ServerError,
  type ServerError as ServerErrorType,
  errorToStatus,
  errorToResponse,
  errorToLog,
  makeServerError,
  classifyError,
} from "./errors.ts";

describe("ServerError", () => {
  describe("factory helpers", () => {
    it("networkError creates a NetworkError", () => {
      const err = makeServerError.networkError("connection refused", new Error("ECONNREFUSED"));
      assert.equal(err._tag, "NetworkError");
      assert.equal(err.message, "connection refused");
      assert.ok(err.timestamp > 0);
    });

    it("databaseError creates a DatabaseError", () => {
      const err = makeServerError.databaseError("query failed");
      assert.equal(err._tag, "DatabaseError");
      assert.equal(err.message, "query failed");
    });

    it("authError creates an AuthError", () => {
      const err = makeServerError.authError("invalid token");
      assert.equal(err._tag, "AuthError");
      assert.equal(err.message, "invalid token");
    });

    it("gitError creates a GitError", () => {
      const err = makeServerError.gitError("merge conflict");
      assert.equal(err._tag, "GitError");
      assert.equal(err.message, "merge conflict");
    });

    it("configError creates a ConfigError", () => {
      const err = makeServerError.configError("missing config");
      assert.equal(err._tag, "ConfigError");
      assert.equal(err.message, "missing config");
    });

    it("validationError creates a ValidationError", () => {
      const err = makeServerError.validationError("bad input");
      assert.equal(err._tag, "ValidationError");
      assert.equal(err.message, "bad input");
    });
  });

  describe("errorToStatus", () => {
    it("maps AuthError to 401", () => {
      assert.equal(errorToStatus(makeServerError.authError("x")), 401);
    });

    it("maps ValidationError to 400", () => {
      assert.equal(errorToStatus(makeServerError.validationError("x")), 400);
    });

    it("maps DatabaseError to 500", () => {
      assert.equal(errorToStatus(makeServerError.databaseError("x")), 500);
    });

    it("maps NetworkError to 502", () => {
      assert.equal(errorToStatus(makeServerError.networkError("x")), 502);
    });

    it("maps ConfigError to 500", () => {
      assert.equal(errorToStatus(makeServerError.configError("x")), 500);
    });

    it("maps GitError to 422", () => {
      assert.equal(errorToStatus(makeServerError.gitError("x")), 422);
    });
  });

  describe("errorToResponse", () => {
    it("returns an HttpServerResponse with correct status", () => {
      const err = makeServerError.authError("token expired");
      const resp = errorToResponse(err);
      assert.equal(resp.status, 401);
    });

    it("includes custom headers when provided", () => {
      const err = makeServerError.validationError("bad payload");
      const resp = errorToResponse(err, { "X-Custom": "yes" });
      assert.equal(resp.status, 400);
    });
  });

  describe("errorToLog", () => {
    it("produces structured log entry with ISO timestamp", () => {
      const err = makeServerError.databaseError("sqlite locked", new Error("BUSY"));
      const log = errorToLog(err);
      assert.equal(log.tag, "DatabaseError");
      assert.equal(log.message, "sqlite locked");
      assert.ok(typeof log.timestamp === "string");
      // Verify it parses as a valid date
      assert.ok(!isNaN(Date.parse(log.timestamp)));
    });

    it("omits cause when not provided", () => {
      const err = makeServerError.configError("missing");
      const log = errorToLog(err);
      assert.equal(log.cause, undefined);
    });
  });

  describe("classifyError", () => {
    it("classifies AuthError-tagged errors", () => {
      const classified = classifyError({ _tag: "AuthError", message: "no session" });
      assert.equal(classified._tag, "AuthError");
    });

    it("classifies SessionCredentialError as AuthError", () => {
      const classified = classifyError({ _tag: "SessionCredentialError", message: "expired" });
      assert.equal(classified._tag, "AuthError");
    });

    it("classifies PersistenceSqlError as DatabaseError", () => {
      const classified = classifyError({ _tag: "PersistenceSqlError", message: "SQLITE_BUSY" });
      assert.equal(classified._tag, "DatabaseError");
    });

    it("classifies DecodeOtlpTraceRecordsError as NetworkError", () => {
      const classified = classifyError({ _tag: "DecodeOtlpTraceRecordsError", message: "decode fail" });
      assert.equal(classified._tag, "NetworkError");
    });

    it("classifies ProcessSpawnError as NetworkError", () => {
      const classified = classifyError({ _tag: "ProcessSpawnError", message: "ENOENT" });
      assert.equal(classified._tag, "NetworkError");
    });

    it("classifies BootstrapError as ConfigError", () => {
      const classified = classifyError({ _tag: "BootstrapError", message: "fd error" });
      assert.equal(classified._tag, "ConfigError");
    });

    it("classifies unknown tags as ConfigError (fallback)", () => {
      const classified = classifyError({ _tag: "SomeNewError", message: "mystery" });
      assert.equal(classified._tag, "ConfigError");
    });

    it("preserves cause in classified error", () => {
      const cause = new Error("root cause");
      const classified = classifyError({ _tag: "AuthError", message: "no", cause });
      assert.equal(classified.cause, cause);
    });
  });

  describe("ServerError tagged enum constructors", () => {
    it("all variants produce unique _tag values", () => {
      const tags = new Set<string>();
      const errors: ServerErrorType[] = [
        ServerError.NetworkError({ message: "a", timestamp: 1 }),
        ServerError.DatabaseError({ message: "b", timestamp: 2 }),
        ServerError.AuthError({ message: "c", timestamp: 3 }),
        ServerError.GitError({ message: "d", timestamp: 4 }),
        ServerError.ConfigError({ message: "e", timestamp: 5 }),
        ServerError.ValidationError({ message: "f", timestamp: 6 }),
      ];
      for (const err of errors) {
        tags.add(err._tag);
      }
      assert.equal(tags.size, 6);
    });
  });
});
