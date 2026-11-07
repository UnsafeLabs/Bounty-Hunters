import { describe, it, expect } from "vitest";
import {
  AuthError,
  DatabaseError,
  NetworkError,
  GitError,
  ConfigError,
  ValidationError,
  errorToResponse,
  errorToLog,
  isServerError,
  authError,
  databaseError,
  networkError,
  gitError,
  configError,
  validationError,
} from "./errors.ts";

describe("Server Errors", () => {
  describe("Error Types", () => {
    it("should create AuthError with tag and timestamp", () => {
      const error = new AuthError({ message: "Unauthorized" });
      expect(error._tag).toBe("AuthError");
      expect(error.message).toBe("Unauthorized");
      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp).toISOString()).toBe(error.timestamp);
    });

    it("should create AuthError with status code", () => {
      const error = new AuthError({ message: "Forbidden", status: 403 });
      expect(error._tag).toBe("AuthError");
      expect(error.status).toBe(403);
    });

    it("should create DatabaseError with cause", () => {
      const cause = new Error("Connection failed");
      const error = new DatabaseError({ message: "DB error", cause });
      expect(error._tag).toBe("DatabaseError");
      expect(error.cause).toBe(cause);
    });

    it("should create NetworkError", () => {
      const error = new NetworkError({ message: "Timeout" });
      expect(error._tag).toBe("NetworkError");
    });

    it("should create GitError", () => {
      const error = new GitError({ message: "Merge conflict" });
      expect(error._tag).toBe("GitError");
    });

    it("should create ConfigError", () => {
      const error = new ConfigError({ message: "Missing env var" });
      expect(error._tag).toBe("ConfigError");
    });

    it("should create ValidationError", () => {
      const error = new ValidationError({ message: "Invalid input" });
      expect(error._tag).toBe("ValidationError");
    });
  });

  describe("Factory Functions", () => {
    it("should create errors with factory functions", () => {
      expect(authError("test")._tag).toBe("AuthError");
      expect(databaseError("test")._tag).toBe("DatabaseError");
      expect(networkError("test")._tag).toBe("NetworkError");
      expect(gitError("test")._tag).toBe("GitError");
      expect(configError("test")._tag).toBe("ConfigError");
      expect(validationError("test")._tag).toBe("ValidationError");
    });

    it("should preserve cause in factory functions", () => {
      const cause = new Error("root cause");
      const error = authError("auth failed", cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe("errorToResponse", () => {
    it("should map AuthError to 401", () => {
      const error = new AuthError({ message: "test" });
      expect(errorToResponse(error)).toBe(401);
    });

    it("should map AuthError with status to its status code", () => {
      expect(errorToResponse(new AuthError({ message: "test", status: 403 }))).toBe(403);
      expect(errorToResponse(new AuthError({ message: "test", status: 400 }))).toBe(400);
      expect(errorToResponse(new AuthError({ message: "test", status: 500 }))).toBe(500);
    });

    it("should map ValidationError to 400", () => {
      const error = new ValidationError({ message: "test" });
      expect(errorToResponse(error)).toBe(400);
    });

    it("should map DatabaseError to 500", () => {
      const error = new DatabaseError({ message: "test" });
      expect(errorToResponse(error)).toBe(500);
    });

    it("should map NetworkError to 502", () => {
      const error = new NetworkError({ message: "test" });
      expect(errorToResponse(error)).toBe(502);
    });

    it("should map ConfigError to 500", () => {
      const error = new ConfigError({ message: "test" });
      expect(errorToResponse(error)).toBe(500);
    });

    it("should map GitError to 422", () => {
      const error = new GitError({ message: "test" });
      expect(errorToResponse(error)).toBe(422);
    });
  });

  describe("errorToLog", () => {
    it("should produce structured log output", () => {
      const error = new AuthError({ message: "test" });
      const log = errorToLog(error);

      expect(log.tag).toBe("AuthError");
      expect(log.message).toBe("test");
      expect(log.timestamp).toBeDefined();
      expect(log.stack).toBeDefined();
      expect(log.cause).toBeUndefined();
    });

    it("should include cause in log output", () => {
      const cause = new Error("root cause");
      const error = new DatabaseError({ message: "db error", cause });
      const log = errorToLog(error);

      expect(log.cause).toBe("Error: root cause");
    });

    it("should include status in log output for AuthError", () => {
      const error = new AuthError({ message: "forbidden", status: 403 });
      const log = errorToLog(error);

      expect(log.status).toBe(403);
    });
  });

  describe("isServerError", () => {
    it("should return true for server errors", () => {
      expect(isServerError(new AuthError({ message: "test" }))).toBe(true);
      expect(isServerError(new DatabaseError({ message: "test" }))).toBe(true);
      expect(isServerError(new NetworkError({ message: "test" }))).toBe(true);
      expect(isServerError(new GitError({ message: "test" }))).toBe(true);
      expect(isServerError(new ConfigError({ message: "test" }))).toBe(true);
      expect(isServerError(new ValidationError({ message: "test" }))).toBe(true);
    });

    it("should return false for non-server errors", () => {
      expect(isServerError(new Error("plain error"))).toBe(false);
      expect(isServerError("string error")).toBe(false);
      expect(isServerError(null)).toBe(false);
      expect(isServerError(undefined)).toBe(false);
    });
  });

  describe("Pattern Matching with Effect.Match", () => {
    it("should support pattern matching on error tags", () => {
      const error = new AuthError({ message: "test" });

      const result = Match.value(error._tag).pipe(
        Match.when("AuthError", () => "auth"),
        Match.when("DatabaseError", () => "db"),
        Match.orElse(() => "unknown"),
      );

      expect(result).toBe("auth");
    });
  });

  describe("Cause Chain Preservation", () => {
    it("should preserve cause chain through error wrapping", () => {
      const rootCause = new Error("root");
      const dbError = new DatabaseError({ message: "db failed", cause: rootCause });
      const authError = new AuthError({ message: "auth failed", cause: dbError });

      expect(authError.cause).toBe(dbError);
      expect((authError.cause as DatabaseError).cause).toBe(rootCause);
    });
  });
});
