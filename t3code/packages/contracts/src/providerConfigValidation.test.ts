import * as Result from "effect/Result";
import { describe, expect, it } from "vitest";

import { ProviderConfigError, validateProviderConfig } from "./providerConfigValidation.ts";

describe("validateProviderConfig", () => {
  it("accepts a valid provider config with API keys and HTTPS endpoints", () => {
    const result = validateProviderConfig({
      driver: "codex",
      environment: [
        { name: "OPENAI_API_KEY", value: "sk-valid123456", sensitive: true },
        { name: "OPENAI_BASE_URL", value: "https://api.openai.com", sensitive: false },
      ],
      config: {
        apiKey: "provider-key-123",
        endpoint: "https://provider.example.com/v1",
      },
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.driver).toBe("codex");
    }
  });

  it("rejects empty and short API key values", () => {
    const errors = expectValidationFailure(
      validateProviderConfig({
        driver: "codex",
        environment: [{ name: "OPENAI_API_KEY", value: "", sensitive: true }],
        config: { apiKey: "short" },
      }),
    );

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.fieldName)).toEqual([
      "environment.OPENAI_API_KEY",
      "config.apiKey",
    ]);
    expect(errors.every((error) => error.expectedFormat.includes("at least 10"))).toBe(true);
  });

  it("rejects HTTP endpoint URLs with an HTTPS-specific error", () => {
    const errors = expectValidationFailure(
      validateProviderConfig({
        driver: "codex",
        environment: [
          { name: "OPENAI_BASE_URL", value: "http://api.openai.com", sensitive: false },
        ],
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.fieldName).toBe("environment.OPENAI_BASE_URL");
    expect(errors[0]?.detail).toContain("Use HTTPS");
  });

  it("rejects malformed endpoint URLs", () => {
    const errors = expectValidationFailure(
      validateProviderConfig({
        driver: "codex",
        config: { endpoint: "not a url" },
      }),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]?.fieldName).toBe("config.endpoint");
    expect(errors[0]?.expectedFormat).toBe("valid HTTPS URL with a hostname");
  });

  it("returns all validation errors at once", () => {
    const errors = expectValidationFailure(
      validateProviderConfig({
        driver: "codex",
        environment: [
          { name: "OPENAI_API_KEY", value: "short", sensitive: true },
          { name: "OPENAI_BASE_URL", value: "http://api.openai.com", sensitive: false },
        ],
        config: {
          endpoint: "not a url",
          nested: { refreshToken: "" },
        },
      }),
    );

    expect(errors.map((error) => error.fieldName)).toEqual([
      "environment.OPENAI_API_KEY",
      "environment.OPENAI_BASE_URL",
      "config.endpoint",
      "config.nested.refreshToken",
    ]);
  });

  it("maps schema decode failures to ProviderConfigError", () => {
    const errors = expectValidationFailure(validateProviderConfig({ driver: "1bad" }));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.fieldName).toBe("ProviderInstanceConfig");
    expect(errors[0]?.expectedFormat).toBe("ProviderInstanceConfig envelope");
  });
});

function expectValidationFailure(
  result: ReturnType<typeof validateProviderConfig>,
): ReadonlyArray<ProviderConfigError> {
  if (Result.isFailure(result)) {
    return result.failure;
  }

  throw new Error("Expected provider config validation to fail");
}
