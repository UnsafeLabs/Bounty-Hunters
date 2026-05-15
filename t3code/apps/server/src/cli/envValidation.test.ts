import { expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  formatEnvironmentValidationReport,
  type EnvVarSpec,
  SERVER_ENV_VAR_SPECS,
  validateEnvironmentVariables,
} from "./envValidation.ts";

it("documents optional environment variables and defaults when config is valid", () => {
  const result = validateEnvironmentVariables({});
  const report = formatEnvironmentValidationReport(result, {});

  expect(result.valid).toBe(true);
  expect(report).toContain("Configuration validation passed.");
  expect(report).toContain("T3CODE_PORT");
  expect(report).toContain("3773 or next available port");
  expect(report).toContain("T3CODE_TAILSCALE_SERVE_PORT");
  expect(report).toContain("443");
});

it("reports invalid environment values with expected formats and received values", () => {
  const env = {
    T3CODE_MODE: "terminal",
    T3CODE_PORT: "not-a-port",
    T3CODE_NO_BROWSER: "sometimes",
    VITE_DEV_SERVER_URL: "localhost:5173",
  };
  const result = validateEnvironmentVariables(env);
  const report = formatEnvironmentValidationReport(result, env);

  expect(result.valid).toBe(false);
  expect(result.issues.map((issue) => issue.name).sort()).toEqual([
    "T3CODE_MODE",
    "T3CODE_NO_BROWSER",
    "T3CODE_PORT",
    "VITE_DEV_SERVER_URL",
  ]);
  expect(report).toContain("Configuration validation failed.");
  expect(report).toContain("web or desktop");
  expect(report).toContain("terminal");
  expect(report).toContain("expected integer from 0 to 65535");
  expect(report).toContain("not-a-port");
  expect(report).toContain("true or false");
  expect(report).toContain("sometimes");
  expect(report).toContain("absolute http(s) URL");
  expect(report).toContain("localhost:5173");
});

it("reports missing required variables when a required schema is configured", () => {
  const specs: readonly EnvVarSpec[] = [
    ...SERVER_ENV_VAR_SPECS,
    {
      name: "T3CODE_REQUIRED_TEST_VALUE",
      description: "Required test value.",
      expected: "non-empty string",
      required: true,
      schema: Schema.String,
      validate: (value) => (value.trim().length === 0 ? "expected non-empty string" : undefined),
    },
  ];
  const result = validateEnvironmentVariables({}, specs);
  const report = formatEnvironmentValidationReport(result, {});

  expect(result.valid).toBe(false);
  expect(result.issues).toEqual([
    {
      name: "T3CODE_REQUIRED_TEST_VALUE",
      kind: "missing",
      expected: "non-empty string",
      description: "Required test value.",
      received: undefined,
    },
  ]);
  expect(report).toContain("T3CODE_REQUIRED_TEST_VALUE");
  expect(report).toContain("<missing>");
});
