import { describe, expect, it } from "@effect/vitest";
import {
  configError, authError, notFoundError, validationError,
  rateLimitError, databaseError, providerError, internalServerError,
  statusCodeFor, serializeError,
} from "./ServerErrors.ts";

describe("ServerErrors", () => {
  it("configError has 500 status", () => {
    const e = configError("MISSING_CONFIG", "Missing required config", "T3CODE_HOME");
    expect(e.statusCode).toBe(500);
    expect(e._tag).toBe("ConfigError");
    expect(e.field).toBe("T3CODE_HOME");
  });

  it("authError has 401 status", () => {
    const e = authError("INVALID_TOKEN", "Token expired", "user123");
    expect(e.statusCode).toBe(401);
    expect(e._tag).toBe("AuthError");
  });

  it("notFoundError has 404 status", () => {
    const e = notFoundError("Project", "proj-123");
    expect(e.statusCode).toBe(404);
    expect(e._tag).toBe("NotFoundError");
    expect(e.resource).toBe("Project");
  });

  it("validationError has 400 status", () => {
    const e = validationError("INVALID_INPUT", "Port must be 1-65535", "port");
    expect(e.statusCode).toBe(400);
    expect(e._tag).toBe("ValidationError");
  });

  it("rateLimitError has 429 status", () => {
    const e = rateLimitError("RATE_LIMITED", "Too many requests", 60);
    expect(e.statusCode).toBe(429);
    expect(e.retryAfter).toBe(60);
  });

  it("databaseError has 500 status", () => {
    const e = databaseError("QUERY_FAILED", "SQL syntax error", "SELECT * FROM");
    expect(e.statusCode).toBe(500);
    expect(e._tag).toBe("DatabaseError");
  });

  it("providerError has 502 status", () => {
    const e = providerError("PROVIDER_DOWN", "Provider unreachable", "openai");
    expect(e.statusCode).toBe(502);
  });

  it("internalServerError has 500 status", () => {
    const e = internalServerError("UNEXPECTED", "Unexpected error");
    expect(e.statusCode).toBe(500);
  });

  it("statusCodeFor returns correct status", () => {
    expect(statusCodeFor(notFoundError("User"))).toBe(404);
    expect(statusCodeFor(authError("BAD", "Bad"))).toBe(401);
  });

  it("serializeError produces JSON-safe object", () => {
    const e = validationError("BAD_INPUT", "Invalid", "name");
    const serialized = serializeError(e);
    expect(serialized.error).toBe("ValidationError");
    expect(serialized.code).toBe("BAD_INPUT");
    expect(serialized.statusCode).toBe(400);
    expect(serialized.timestamp).toBeDefined();
  });
});
