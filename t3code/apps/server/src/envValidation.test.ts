import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  type EnvVarSpec,
  EnvValidationError,
  formatEnvValidationTable,
  SERVER_ENV_SPECS,
  validateEnvironment,
  validateEnvironmentEffect,
  validateEnvValue,
} from "./envValidation.ts";

describe("envValidation", () => {
  it("accepts empty env when no required variables are set", () => {
    const result = validateEnvironment({});
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.optionalWithDefaults.length).toBe(SERVER_ENV_SPECS.length);
  });

  it("accepts a fully valid configuration", () => {
    const result = validateEnvironment({
      T3CODE_LOG_LEVEL: "Warn",
      T3CODE_MODE: "desktop",
      T3CODE_PORT: "4001",
      T3CODE_HOST: "0.0.0.0",
      T3CODE_NO_BROWSER: "true",
      T3CODE_OTLP_TRACES_URL: "https://otlp.example.com/v1/traces",
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports invalid types with expected format and received value", () => {
    const result = validateEnvironment({
      T3CODE_PORT: "not-a-port",
      T3CODE_LOG_LEVEL: "loud",
      T3CODE_MODE: "cloud",
      T3CODE_NO_BROWSER: "maybe",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.name).sort()).toEqual(
      ["T3CODE_LOG_LEVEL", "T3CODE_MODE", "T3CODE_NO_BROWSER", "T3CODE_PORT"].sort(),
    );
    const portIssue = result.issues.find((i) => i.name === "T3CODE_PORT");
    expect(portIssue?.kind).toBe("invalid");
    expect(portIssue?.received).toBe('"not-a-port"');
    expect(portIssue?.expectedFormat).toContain("1-65535");
  });

  it("reports missing required variables", () => {
    const requiredSpec: EnvVarSpec = {
      name: "T3CODE_REQUIRED_TEST",
      kind: "string",
      required: true,
      defaultValue: undefined,
      description: "test-only required var",
      expectedFormat: "non-empty string",
    };
    const result = validateEnvironment({}, [requiredSpec]);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        name: "T3CODE_REQUIRED_TEST",
        kind: "missing",
        expectedFormat: "non-empty string",
        received: "(unset)",
        description: "test-only required var",
      },
    ]);
  });

  it("formats a validation table including optional defaults", () => {
    const result = validateEnvironment({ T3CODE_PORT: "99999" });
    const table = formatEnvValidationTable(result);
    expect(table).toContain("Variable");
    expect(table).toContain("T3CODE_PORT");
    expect(table).toContain("invalid");
    expect(table).toContain("T3CODE_LOG_LEVEL");
    expect(table).toContain("optional");
    expect(table).toContain("default:");
  });

  it("validateEnvironmentEffect succeeds for valid env", async () => {
    const result = await Effect.runPromise(validateEnvironmentEffect({}));
    expect(result.ok).toBe(true);
  });

  it("validateEnvironmentEffect fails with EnvValidationError for invalid env", async () => {
    const exit = await Effect.runPromiseExit(
      validateEnvironmentEffect({ T3CODE_PORT: "abc" }),
    );
    assert(exit._tag === "Failure");
    const error = exit.cause;
    // Flatten to find EnvValidationError
    const message = String(error);
    expect(message).toContain("Environment validation failed");
    expect(message).toContain("T3CODE_PORT");
  });

  it("validateEnvValue covers kind parsers", () => {
    expect(validateEnvValue("port", "8080")).toEqual({ ok: true, value: 8080 });
    expect(validateEnvValue("port", "0").ok).toBe(false);
    expect(validateEnvValue("boolean", "1")).toEqual({ ok: true, value: true });
    expect(validateEnvValue("boolean", "no")).toEqual({ ok: true, value: false });
    expect(validateEnvValue("url", "ftp://x").ok).toBe(false);
    expect(validateEnvValue("url", "https://example.com").ok).toBe(true);
    expect(validateEnvValue("mode", "WEB")).toEqual({ ok: true, value: "web" });
    expect(validateEnvValue("logLevel", "Info").ok).toBe(true);
    expect(validateEnvValue("int", "42").ok).toBe(true);
    expect(validateEnvValue("string", "  ").ok).toBe(false);
  });

  it("EnvValidationError message embeds the table", () => {
    const result = validateEnvironment({ T3CODE_PORT: "x" });
    const err = new EnvValidationError(result);
    expect(err.message).toContain("| Variable");
    expect(err._tag).toBe("EnvValidationError");
  });
});
