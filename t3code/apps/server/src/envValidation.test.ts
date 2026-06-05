import { describe, expect, it } from "@effect/vitest";

import { formatServerEnvValidation, validateServerEnv } from "./envValidation.ts";

describe("server environment validation", () => {
  it("accepts an empty environment and documents optional defaults", () => {
    const result = validateServerEnv({});
    const output = formatServerEnvValidation(result);

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(output).toContain("T3 Code environment validation: OK");
    expect(output).toContain("Required variables: none currently");
    expect(output).toContain("T3CODE_PORT");
    expect(output).toContain("3773 or available port");
    expect(output).toContain("T3CODE_TAILSCALE_SERVE_PORT");
    expect(output).toContain("443");
  });

  it("accepts valid configured environment values", () => {
    const result = validateServerEnv({
      T3CODE_LOG_LEVEL: "Debug",
      T3CODE_TRACE_MIN_LEVEL: "Warn",
      T3CODE_TRACE_TIMING_ENABLED: "false",
      T3CODE_TRACE_MAX_BYTES: "4096",
      T3CODE_TRACE_MAX_FILES: "5",
      T3CODE_TRACE_BATCH_WINDOW_MS: "50",
      T3CODE_OTLP_TRACES_URL: "http://localhost:4318/v1/traces",
      T3CODE_OTLP_METRICS_URL: "http://localhost:4318/v1/metrics",
      T3CODE_OTLP_EXPORT_INTERVAL_MS: "2500",
      T3CODE_OTLP_SERVICE_NAME: "local-t3",
      T3CODE_MODE: "desktop",
      T3CODE_PORT: "4888",
      T3CODE_HOST: "127.0.0.1",
      T3CODE_HOME: "/tmp/t3-home",
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
      T3CODE_NO_BROWSER: "true",
      T3CODE_BOOTSTRAP_FD: "3",
      T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
      T3CODE_LOG_WS_EVENTS: "true",
      T3CODE_TAILSCALE_SERVE: "false",
      T3CODE_TAILSCALE_SERVE_PORT: "443",
      T3CODE_TELEMETRY_ENABLED: "false",
      T3CODE_POSTHOG_KEY: "phc_custom",
      T3CODE_POSTHOG_HOST: "https://posthog.test.local",
      T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: "10",
      T3CODE_TELEMETRY_MAX_BUFFERED_EVENTS: "500",
      T3CODE_BITBUCKET_API_BASE_URL: "https://bitbucket.test.local/2.0",
      T3CODE_BITBUCKET_ACCESS_TOKEN: "access-token",
      T3CODE_BITBUCKET_EMAIL: "user@example.com",
      T3CODE_BITBUCKET_API_TOKEN: "api-token",
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.rows.find((row) => row.name === "T3CODE_PORT")?.status).toBe("valid");
  });

  it("redacts sensitive configured values in the formatted output", () => {
    const result = validateServerEnv({
      T3CODE_POSTHOG_KEY: "phc_secret",
      T3CODE_BITBUCKET_ACCESS_TOKEN: "access-secret",
      T3CODE_BITBUCKET_EMAIL: "person@example.com",
      T3CODE_BITBUCKET_API_TOKEN: "api-secret",
    });
    const output = formatServerEnvValidation(result);

    expect(result.ok).toBe(true);
    expect(output).toContain("T3CODE_POSTHOG_KEY");
    expect(output).toContain("[set]");
    expect(output).not.toContain("phc_secret");
    expect(output).not.toContain("access-secret");
    expect(output).not.toContain("person@example.com");
    expect(output).not.toContain("api-secret");
  });

  it("reports invalid values with expected formats and received values", () => {
    const result = validateServerEnv({
      T3CODE_TRACE_TIMING_ENABLED: "sometimes",
      T3CODE_TRACE_MAX_BYTES: "-1",
      T3CODE_MODE: "mobile",
      T3CODE_PORT: "abc",
      VITE_DEV_SERVER_URL: "not a url",
      T3CODE_BOOTSTRAP_FD: "-1",
      T3CODE_POSTHOG_HOST: "not a url either",
      T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: "NaN",
      T3CODE_BITBUCKET_API_BASE_URL: "bitbucket",
    });
    const output = formatServerEnvValidation(result);

    expect(result.ok).toBe(false);
    expect(result.issues.map((row) => row.name)).toEqual([
      "T3CODE_TRACE_TIMING_ENABLED",
      "T3CODE_TRACE_MAX_BYTES",
      "T3CODE_MODE",
      "T3CODE_PORT",
      "VITE_DEV_SERVER_URL",
      "T3CODE_BOOTSTRAP_FD",
      "T3CODE_POSTHOG_HOST",
      "T3CODE_TELEMETRY_FLUSH_BATCH_SIZE",
      "T3CODE_BITBUCKET_API_BASE_URL",
    ]);
    expect(output).toContain("T3 Code environment validation: FAILED");
    expect(output).toContain("true or false");
    expect(output).toContain("sometimes");
    expect(output).toContain("web or desktop");
    expect(output).toContain("mobile");
    expect(output).toContain("port 1-65535");
    expect(output).toContain("abc");
    expect(output).toContain("absolute URL");
    expect(output).toContain("not a url");
    expect(output).toContain("not a url either");
    expect(output).toContain("NaN");
    expect(output).toContain("bitbucket");
  });

  it("includes all rows in failure output so defaulted variables remain documented", () => {
    const result = validateServerEnv({ T3CODE_PORT: "99999" });
    const output = formatServerEnvValidation(result);

    expect(result.ok).toBe(false);
    expect(output).toContain("T3CODE_LOG_LEVEL");
    expect(output).toContain("Info");
    expect(output).toContain("T3CODE_PORT");
    expect(output).toContain("99999");
  });
});
