import { describe, expect, it } from "vitest";

import { formatValidationTable, validateEnvVars } from "./envValidation.ts";

describe("validateEnvVars", () => {
  it("passes with everything unset (all defaults)", () => {
    const report = validateEnvVars({});
    expect(report.ok).toBe(true);
    expect(report.rows.length).toBeGreaterThan(15);
    expect(report.rows.every((r) => r.status === "default")).toBe(true);
  });

  it("accepts valid explicitly-set values", () => {
    const report = validateEnvVars({
      T3CODE_PORT: "8080",
      T3CODE_MODE: "desktop",
      T3CODE_NO_BROWSER: "true",
      T3CODE_LOG_LEVEL: "Debug",
      VITE_DEV_SERVER_URL: "http://localhost:5173",
    });
    expect(report.ok).toBe(true);
    expect(report.rows.find((r) => r.name === "T3CODE_PORT")?.status).toBe("ok");
  });

  it("rejects a non-numeric port", () => {
    const report = validateEnvVars({ T3CODE_PORT: "abc" });
    expect(report.ok).toBe(false);
    const row = report.rows.find((r) => r.name === "T3CODE_PORT");
    expect(row?.status).toBe("invalid");
  });

  it("rejects out-of-range and non-integer numbers", () => {
    expect(validateEnvVars({ T3CODE_PORT: "99999" }).ok).toBe(false);
    expect(validateEnvVars({ T3CODE_PORT: "0" }).ok).toBe(false);
    expect(validateEnvVars({ T3CODE_TRACE_MAX_FILES: "2.5" }).ok).toBe(false);
  });

  it("rejects invalid enums, booleans, and URLs", () => {
    expect(validateEnvVars({ T3CODE_MODE: "prod" }).ok).toBe(false);
    expect(validateEnvVars({ T3CODE_NO_BROWSER: "yes" }).ok).toBe(false);
    expect(validateEnvVars({ T3CODE_LOG_LEVEL: "Verbose" }).ok).toBe(false);
    expect(validateEnvVars({ VITE_DEV_SERVER_URL: "not-a-url" }).ok).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const report = validateEnvVars({ T3CODE_PORT: "", T3CODE_MODE: "  " });
    expect(report.ok).toBe(true);
  });
});

describe("formatValidationTable", () => {
  it("marks failures visibly with variable names", () => {
    const report = validateEnvVars({ T3CODE_PORT: "abc" });
    const table = formatValidationTable(report.rows);
    expect(table).toContain("FAIL");
    expect(table).toContain("T3CODE_PORT");
    expect(table).toContain("1 invalid variable(s)");
  });
});
