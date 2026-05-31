import { describe, it, expect } from "vitest";
import { ServerError, errorToResponse, errorToLog } from "./errors.ts";

describe("errors", () => {
  it("should map AuthError to 401", () => {
    const error = ServerError.AuthError({ message: "test", timestamp: 123 });
    expect(errorToResponse(error)).toBe(401);
  });

  it("should map ValidationError to 400", () => {
    const error = ServerError.ValidationError({ message: "test", timestamp: 123 });
    expect(errorToResponse(error)).toBe(400);
  });

  it("should map DatabaseError to 500", () => {
    const error = ServerError.DatabaseError({ message: "test", timestamp: 123 });
    expect(errorToResponse(error)).toBe(500);
  });

  it("should map NetworkError to 502", () => {
    const error = ServerError.NetworkError({ message: "test", timestamp: 123 });
    expect(errorToResponse(error)).toBe(502);
  });

  it("should map ConfigError to 500", () => {
    const error = ServerError.ConfigError({ message: "test", timestamp: 123 });
    expect(errorToResponse(error)).toBe(500);
  });

  it("should map GitError to 422", () => {
    const error = ServerError.GitError({ message: "test", timestamp: 123 });
    expect(errorToResponse(error)).toBe(422);
  });

  it("should preserve cause chain and generate log JSON", () => {
    const cause = new Error("inner error");
    const error = ServerError.DatabaseError({
      message: "outer error",
      cause,
      timestamp: 12345,
    });
    
    const log = errorToLog(error);
    expect(log.tag).toBe("DatabaseError");
    expect(log.message).toBe("outer error");
    expect(log.timestamp).toBe(12345);
    expect(log.stackTrace).toBeDefined();
    expect(log.stackTrace).toContain("inner error");
  });
});
