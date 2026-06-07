import { describe, expect, it } from "vitest";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import {
  ProviderConfigError,
  validateProviderConfigUnknown,
} from "./providerConfigValidation.ts";

const validConfig = {
  driver: "codex",
  environment: [
    {
      name: "OPENAI_API_KEY",
      value: "sk-valid-key-12345",
      sensitive: true,
    },
    {
      name: "OPENAI_BASE_URL",
      value: "https://api.openai.com/v1",
      sensitive: false,
    },
  ],
  config: {
    endpointUrl: "https://api.example.com",
    nested: {
      apiToken: "token-value-12345",
    },
  },
};

function failureMessages(input: unknown): ReadonlyArray<ProviderConfigError> {
  const result = validateProviderConfigUnknown(input);
  expect(Result.isFailure(result)).toBe(true);
  return Option.getOrThrow(Result.getFailure(result));
}

describe("provider config validation", () => {
  it("accepts valid provider configuration", () => {
    const result = validateProviderConfigUnknown(validConfig);
    expect(Result.isSuccess(result)).toBe(true);
    expect(Option.getOrThrow(Result.getSuccess(result)).driver).toBe("codex");
  });

  it("rejects empty and short API keys", () => {
    const errors = failureMessages({
      ...validConfig,
      environment: [{ name: "OPENAI_API_KEY", value: "", sensitive: true }],
      config: { apiKey: "short" },
    });

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.field)).toEqual(["environment.OPENAI_API_KEY", "config.apiKey"]);
    expect(errors.every((error) => error.message.includes("at least 10"))).toBe(true);
  });

  it("rejects HTTP URLs with a clear HTTPS message", () => {
    const errors = failureMessages({
      ...validConfig,
      config: { endpointUrl: "http://api.example.com" },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("config.endpointUrl");
    expect(errors[0]?.message).toContain("HTTPS");
  });

  it("rejects malformed endpoint URLs", () => {
    const errors = failureMessages({
      ...validConfig,
      environment: [{ name: "PROVIDER_ENDPOINT", value: "not a url", sensitive: false }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("malformed");
  });

  it("returns all validation errors at once", () => {
    const errors = failureMessages({
      ...validConfig,
      environment: [
        { name: "OPENAI_API_KEY", value: "short", sensitive: true },
        { name: "OPENAI_BASE_URL", value: "http://api.example.com", sensitive: false },
      ],
      config: {
        endpointUrl: "notaurl",
        nested: { apiToken: "" },
      },
    });

    expect(errors.map((error) => error.field)).toEqual([
      "environment.OPENAI_API_KEY",
      "environment.OPENAI_BASE_URL",
      "config.endpointUrl",
      "config.nested.apiToken",
    ]);
  });

  it("maps Effect Schema decode failures to ProviderConfigError", () => {
    const errors = failureMessages({ driver: "not a valid driver slug!" });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ProviderConfigError);
    expect(errors[0]?.field).toBe("config");
    expect(errors[0]?.expected).toBe("ProviderInstanceConfig schema");
  });
});
