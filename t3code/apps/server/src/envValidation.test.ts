import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  validateEnv,
  formatErrorTable,
  ENV_VAR_SPECS,
} from "./envValidation.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetEnv() {
  // Remove any added keys
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  // Restore original values
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// validateEnv
// ---------------------------------------------------------------------------

describe("validateEnv", () => {
  beforeEach(() => {
    resetEnv();
    // Clear T3_ vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("T3_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    resetEnv();
  });

  it("passes when all required vars have valid values", async () => {
    setEnv({
      T3_PORT: "3773",
      T3_MODE: "web",
      T3_LOG_LEVEL: "Info",
    });

    const result = await Effect.runPromise(validateEnv);
    expect(result._tag).toBe("ValidationSuccess");

    if (result._tag === "ValidationSuccess") {
      const portVar = result.validated.find((v) => v.name === "T3_PORT");
      expect(portVar?.value).toBe(3773);
      expect(portVar?.source).toBe("env");
    }
  });

  it("uses defaults when optional vars are missing", async () => {
    // Only set required vars
    setEnv({
      T3_PORT: "3773",
      T3_MODE: "web",
      T3_LOG_LEVEL: "Info",
    });

    const result = await Effect.runPromise(validateEnv);
    expect(result._tag).toBe("ValidationSuccess");

    if (result._tag === "ValidationSuccess") {
      const poolMin = result.validated.find((v) => v.name === "T3_SQLITE_POOL_MIN");
      expect(poolMin?.value).toBe(1);
      expect(poolMin?.source).toBe("default");
    }
  });

  it("fails on invalid port number", async () => {
    setEnv({
      T3_PORT: "not-a-number",
      T3_MODE: "web",
      T3_LOG_LEVEL: "Info",
    });

    const result = await Effect.runPromise(validateEnv);
    expect(result._tag).toBe("ValidationFailure");

    if (result._tag === "ValidationFailure") {
      const portError = result.errors.find((e) => e.name === "T3_PORT");
      expect(portError).toBeDefined();
      expect(portError?.issue).toContain("number");
    }
  });

  it("fails on port out of range", async () => {
    setEnv({
      T3_PORT: "99999",
      T3_MODE: "web",
      T3_LOG_LEVEL: "Info",
    });

    const result = await Effect.runPromise(validateEnv);
    expect(result._tag).toBe("ValidationFailure");

    if (result._tag === "ValidationFailure") {
      const portError = result.errors.find((e) => e.name === "T3_PORT");
      expect(portError?.issue).toContain("range");
    }
  });

  it("fails on invalid boolean value", async () => {
    setEnv({
      T3_PORT: "3773",
      T3_MODE: "web",
      T3_LOG_LEVEL: "Info",
      T3_NO_BROWSER: "yes",
    });

    const result = await Effect.runPromise(validateEnv);
    expect(result._tag).toBe("ValidationFailure");

    if (result._tag === "ValidationFailure") {
      const boolError = result.errors.find((e) => e.name === "T3_NO_BROWSER");
      expect(boolError).toBeDefined();
    }
  });

  it("accepts valid boolean values", async () => {
    setEnv({
      T3_PORT: "3773",
      T3_MODE: "web",
      T3_LOG_LEVEL: "Info",
      T3_NO_BROWSER: "true",
    });

    const result = await Effect.runPromise(validateEnv);
    expect(result._tag).toBe("ValidationSuccess");

    if (result._tag === "ValidationSuccess") {
      const boolVar = result.validated.find((v) => v.name === "T3_NO_BROWSER");
      expect(boolVar?.value).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// formatErrorTable
// ---------------------------------------------------------------------------

describe("formatErrorTable", () => {
  it("formats errors as a readable table", () => {
    const errors = [
      { name: "T3_PORT", issue: "Invalid number", expected: "Port number (0-65535)", received: "abc" },
      { name: "T3_MODE", issue: "Required variable is missing", expected: "Runtime mode: web|desktop", received: "(not set)" },
    ];

    const table = formatErrorTable(errors);

    expect(table).toContain("T3_PORT");
    expect(table).toContain("T3_MODE");
    expect(table).toContain("Invalid number");
    expect(table).toContain("(not set)");
    // Table structure
    expect(table).toContain("+");
    expect(table).toContain("|");
  });
});

// ---------------------------------------------------------------------------
// ENV_VAR_SPECS completeness
// ---------------------------------------------------------------------------

describe("ENV_VAR_SPECS", () => {
  it("has specs for all T3_ environment variables", () => {
    const names = ENV_VAR_SPECS.map((s) => s.name);
    expect(names).toContain("T3_PORT");
    expect(names).toContain("T3_MODE");
    expect(names).toContain("T3_LOG_LEVEL");
    expect(names).toContain("T3_SQLITE_POOL_MIN");
    expect(names).toContain("T3_SQLITE_POOL_MAX");
    expect(names).toContain("T3_GZIP_LEVEL");
    expect(names).toContain("T3_BROTLI_LEVEL");
  });

  it("all required specs have descriptions", () => {
    for (const spec of ENV_VAR_SPECS) {
      expect(spec.description).toBeTruthy();
      expect(spec.name).toBeTruthy();
    }
  });
});

// Need to import Effect for the tests
import * as Effect from "effect/Effect";
