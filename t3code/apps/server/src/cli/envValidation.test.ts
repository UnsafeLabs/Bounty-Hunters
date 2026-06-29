import { assert, expect, it } from "@effect/vitest";

import {
  assertValidServerEnvironment,
  formatServerEnvironmentValidationTable,
  ServerEnvironmentValidationError,
  validateServerEnvironment,
} from "./envValidation.ts";

it("documents defaulted optional environment variables", () => {
  const result = validateServerEnvironment({});

  expect(result.valid).toBe(true);
  expect(result.entries.find((entry) => entry.name === "T3CODE_PORT")).toMatchObject({
    status: "default",
    defaultValue: "auto",
  });
  expect(result.entries.find((entry) => entry.name === "T3CODE_TAILSCALE_SERVE_PORT"))
    .toMatchObject({
      status: "default",
      defaultValue: "443",
    });

  const table = formatServerEnvironmentValidationTable(result);
  expect(table).toContain("Server environment validation passed.");
  expect(table).toContain("T3CODE_PORT");
  expect(table).toContain("platform default");
});

it("reports invalid environment variable values with expected formats", () => {
  const result = validateServerEnvironment({
    T3CODE_PORT: "not-a-port",
    T3CODE_NO_BROWSER: "sometimes",
    VITE_DEV_SERVER_URL: "localhost:5173",
  });

  expect(result.valid).toBe(false);
  expect(result.entries.find((entry) => entry.name === "T3CODE_PORT")).toMatchObject({
    status: "invalid",
    expected: "port 1-65535",
    received: "not-a-port",
  });
  expect(result.entries.find((entry) => entry.name === "T3CODE_NO_BROWSER")).toMatchObject({
    status: "invalid",
    expected: "boolean",
    received: "sometimes",
  });
  expect(result.entries.find((entry) => entry.name === "VITE_DEV_SERVER_URL")).toMatchObject({
    status: "invalid",
    expected: "absolute URL",
    received: "localhost:5173",
  });

  const table = formatServerEnvironmentValidationTable(result, { onlyProblems: true });
  expect(table).toContain("Server environment validation failed.");
  expect(table).toContain("not-a-port");
  expect(table).toContain("expected boolean");
  expect(table).not.toContain("T3CODE_HOME");
});

it("throws a validation error before config resolution when env values are invalid", () => {
  try {
    assertValidServerEnvironment({ T3CODE_TRACE_MAX_FILES: "0" });
    assert.fail("expected validation to fail");
  } catch (error) {
    assert.instanceOf(error, ServerEnvironmentValidationError);
    expect((error as ServerEnvironmentValidationError).result.valid).toBe(false);
  }
});
