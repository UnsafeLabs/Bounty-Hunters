import { describe, expect, it } from "vitest";
import * as Result from "effect/Result";

import type { ProviderInstanceConfig } from "./providerInstance.ts";
import { validateProviderConfig } from "./providerConfigValidation.ts";

const baseConfig = {
  driver: "codex",
} as ProviderInstanceConfig;

const expectFailures = (config: ProviderInstanceConfig) => {
  const result = validateProviderConfig(config);
  expect(Result.isFailure(result)).toBe(true);

  if (Result.isFailure(result)) {
    return result.failure;
  }

  return [];
};

describe("validateProviderConfig", () => {
  it("accepts valid provider config values", () => {
    const result = validateProviderConfig({
      ...baseConfig,
      environment: [
        { name: "OPENROUTER_API_KEY", value: "sk-valid-key-123", sensitive: true },
        { name: "ANTHROPIC_BASE_URL", value: "https://api.anthropic.com", sensitive: false },
      ],
      config: {
        endpoint: "https://api.example.com/v1",
        nested: { apiKey: "provider-key-12345" },
      },
    });

    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects empty and short API keys", () => {
    const errors = expectFailures({
      ...baseConfig,
      environment: [{ name: "OPENROUTER_API_KEY", value: "", sensitive: true }],
      config: { apiKey: "short" },
    });

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.field)).toEqual([
      "environment.OPENROUTER_API_KEY",
      "config.apiKey",
    ]);
  });

  it("rejects HTTP URLs with a clear HTTPS expectation", () => {
    const errors = expectFailures({
      ...baseConfig,
      config: { endpoint: "http://api.example.com/v1" },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("config.endpoint");
    expect(errors[0]?.expected).toContain("https://");
  });

  it("rejects malformed endpoint URLs", () => {
    const errors = expectFailures({
      ...baseConfig,
      environment: [{ name: "ANTHROPIC_BASE_URL", value: "not a url", sensitive: false }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.invalidValue).toBe("not a url");
  });

  it("returns all validation errors at once", () => {
    const errors = expectFailures({
      ...baseConfig,
      environment: [
        { name: "OPENROUTER_API_KEY", value: "tiny", sensitive: true },
        { name: "ANTHROPIC_BASE_URL", value: "http://localhost:3000", sensitive: false },
      ],
      config: {
        nested: {
          apiKey: "bad",
          endpointUrl: "ftp://api.example.com",
        },
      },
    });

    expect(errors.map((error) => error.field)).toEqual([
      "environment.OPENROUTER_API_KEY",
      "environment.ANTHROPIC_BASE_URL",
      "config.nested.apiKey",
      "config.nested.endpointUrl",
    ]);
  });
});
