import { expect, it } from "vitest";

import { formatEnvironmentValidationTable, validateEnvironmentVariables } from "./envValidation.ts";

it("documents optional defaults when no server environment variables are set", () => {
  const result = validateEnvironmentVariables({});
  const output = formatEnvironmentValidationTable(result);

  expect(result.ok).toBe(true);
  expect(output).toContain("Environment variable validation passed.");
  expect(output).toContain("T3CODE_LOG_LEVEL");
  expect(output).toContain("(default Info)");
  expect(output).toContain("T3CODE_PORT");
  expect(output).toContain("first available at or above 3773");
});

it("reports invalid values with expected type information and received value", () => {
  const result = validateEnvironmentVariables({
    T3CODE_PORT: "not-a-port",
    T3CODE_NO_BROWSER: "yes",
    VITE_DEV_SERVER_URL: "not-a-url",
  });
  const output = formatEnvironmentValidationTable(result);

  expect(result.ok).toBe(false);
  expect(output).toContain("Environment variable validation failed.");
  expect(output).toContain("T3CODE_PORT");
  expect(output).toContain("integer port 1-65535");
  expect(output).toContain('"not-a-port"');
  expect(output).toContain("T3CODE_NO_BROWSER");
  expect(output).toContain("boolean: true|false");
  expect(output).toContain('"yes"');
  expect(output).toContain("VITE_DEV_SERVER_URL");
  expect(output).toContain("URL");
});

it("accepts valid typed values", () => {
  const result = validateEnvironmentVariables({
    T3CODE_LOG_LEVEL: "Debug",
    T3CODE_MODE: "desktop",
    T3CODE_PORT: "4888",
    T3CODE_NO_BROWSER: "true",
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
  });

  expect(result.ok).toBe(true);
  expect(result.rows.find((row) => row.name === "T3CODE_PORT")?.status).toBe("set");
});
