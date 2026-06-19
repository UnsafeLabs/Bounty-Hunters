/**
 * Tests for environment variable validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateEnvVars, formatValidationTable } from "./env-validation.ts";

describe("validateEnvVars", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all T3CODE_ env vars before each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("T3CODE_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("T3CODE_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  it("passes with no env vars set (all optional)", () => {
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes with valid T3CODE_PORT", () => {
    process.env.T3CODE_PORT = "3773";
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
  });

  it("fails with invalid T3CODE_PORT (non-numeric)", () => {
    process.env.T3CODE_PORT = "abc";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_PORT")).toBe(true);
  });

  it("fails with invalid T3CODE_PORT (out of range)", () => {
    process.env.T3CODE_PORT = "99999";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_PORT")).toBe(true);
  });

  it("passes with valid T3CODE_MODE", () => {
    process.env.T3CODE_MODE = "web";
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
  });

  it("fails with invalid T3CODE_MODE", () => {
    process.env.T3CODE_MODE = "invalid";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_MODE")).toBe(true);
  });

  it("passes with valid T3CODE_LOG_LEVEL", () => {
    process.env.T3CODE_LOG_LEVEL = "Info";
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
  });

  it("fails with invalid T3CODE_LOG_LEVEL", () => {
    process.env.T3CODE_LOG_LEVEL = "Verbose";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_LOG_LEVEL")).toBe(true);
  });

  it("passes with valid T3CODE_DEV_SERVER_URL", () => {
    process.env.T3CODE_DEV_SERVER_URL = "http://localhost:5173";
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
  });

  it("fails with invalid T3CODE_DEV_SERVER_URL", () => {
    process.env.T3CODE_DEV_SERVER_URL = "not-a-url";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_DEV_SERVER_URL")).toBe(true);
  });

  it("passes with valid boolean values", () => {
    process.env.T3CODE_NO_BROWSER = "true";
    process.env.T3CODE_LOG_WS_EVENTS = "false";
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
  });

  it("fails with invalid boolean values", () => {
    process.env.T3CODE_NO_BROWSER = "yes";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_NO_BROWSER")).toBe(true);
  });

  it("passes with valid integer values", () => {
    process.env.T3CODE_TRACE_MAX_BYTES = "10485760";
    process.env.T3CODE_TRACE_MAX_FILES = "10";
    const result = validateEnvVars();
    expect(result.valid).toBe(true);
  });

  it("fails with invalid integer values", () => {
    process.env.T3CODE_TRACE_MAX_BYTES = "not-a-number";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.variable === "T3CODE_TRACE_MAX_BYTES")).toBe(true);
  });

  it("reports multiple errors at once", () => {
    process.env.T3CODE_PORT = "abc";
    process.env.T3CODE_MODE = "invalid";
    process.env.T3CODE_LOG_LEVEL = "Verbose";
    const result = validateEnvVars();
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("formatValidationTable", () => {
  it("formats valid result", () => {
    const result = { valid: true, errors: [], warnings: [] };
    const table = formatValidationTable(result);
    expect(table).toContain("✅");
    expect(table).toContain("valid");
  });

  it("formats invalid result with errors", () => {
    const result = {
      valid: false,
      errors: [
        {
          variable: "T3CODE_PORT",
          expected: "integer (1-65535)",
          received: "abc",
          description: "Port for the HTTP/WebSocket server",
        },
      ],
      warnings: [],
    };
    const table = formatValidationTable(result);
    expect(table).toContain("❌");
    expect(table).toContain("T3CODE_PORT");
    expect(table).toContain("integer (1-65535)");
    expect(table).toContain("abc");
  });

  it("includes warnings", () => {
    const result = {
      valid: true,
      errors: [],
      warnings: ["T3CODE_OTLP_SERVICE_NAME not set, using default: t3-server"],
    };
    const table = formatValidationTable(result);
    expect(table).toContain("⚠️");
    expect(table).toContain("T3CODE_OTLP_SERVICE_NAME");
  });

  it("includes optional vars documentation", () => {
    const result = { valid: true, errors: [], warnings: [] };
    const table = formatValidationTable(result);
    expect(table).toContain("T3CODE_LOG_LEVEL");
    expect(table).toContain("T3CODE_TRACE_MIN_LEVEL");
    expect(table).toContain("Default");
  });
});
