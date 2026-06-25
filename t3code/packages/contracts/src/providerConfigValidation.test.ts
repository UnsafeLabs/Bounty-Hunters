import { describe, expect, it } from "vitest";
import * as Result from "effect/Result";

import {
  ProviderConfigError,
  validateProviderConfig,
  type ProviderConfigInput,
} from "./providerConfigValidation.ts";

const expectErrors = (input: ProviderConfigInput): ReadonlyArray<ProviderConfigError> => {
  const result = validateProviderConfig(input);
  expect(Result.isFailure(result)).toBe(true);
  if (!Result.isFailure(result)) {
    throw new Error("expected validation to fail");
  }
  return result.failure;
};

const errorForField = (input: ProviderConfigInput, field: string): ProviderConfigError => {
  const error = expectErrors(input).find((candidate) => candidate.field === field);
  if (error === undefined) {
    throw new Error(`expected a validation error for field "${field}"`);
  }
  return error;
};

describe("validateProviderConfig", () => {
  it("accepts a valid config and returns the input unchanged", () => {
    const input = { apiKey: "sk-or-test-key", endpointUrl: "https://example.com" };
    const result = validateProviderConfig(input);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(input);
    }
  });

  it("accepts a config with no validated fields present", () => {
    expect(Result.isSuccess(validateProviderConfig({}))).toBe(true);
  });

  it("accepts an api key at exactly the minimum length", () => {
    expect(Result.isSuccess(validateProviderConfig({ apiKey: "sk-or-test" }))).toBe(true);
  });

  describe("api key validation", () => {
    it("rejects an empty api key", () => {
      const error = errorForField({ apiKey: "" }, "apiKey");
      expect(error._tag).toBe("ProviderConfigError");
      expect(error.value).toBe("");
      expect(error.expectedFormat).toContain("10");
    });

    it("rejects a whitespace-only api key", () => {
      expect(Result.isFailure(validateProviderConfig({ apiKey: "      " }))).toBe(true);
    });

    it("rejects an api key shorter than 10 characters", () => {
      const error = errorForField({ apiKey: "sk-short" }, "apiKey");
      expect(error.value).toBe("sk-short");
    });

    it("rejects an api key containing whitespace", () => {
      expect(Result.isFailure(validateProviderConfig({ apiKey: "sk has spaces in it" }))).toBe(
        true,
      );
    });
  });

  describe("endpoint url validation", () => {
    it("rejects an http url with a message suggesting https", () => {
      const error = errorForField({ endpointUrl: "http://openrouter.ai/api" }, "endpointUrl");
      expect(error.value).toBe("http://openrouter.ai/api");
      expect(error.message.toLowerCase()).toContain("https");
    });

    it("rejects a malformed url", () => {
      const error = errorForField({ endpointUrl: "not a url" }, "endpointUrl");
      expect(error.field).toBe("endpointUrl");
    });

    it("rejects a non-http(s) scheme", () => {
      expect(Result.isFailure(validateProviderConfig({ endpointUrl: "ftp://example.com" }))).toBe(
        true,
      );
    });

    it("accepts a valid https url", () => {
      expect(
        Result.isSuccess(validateProviderConfig({ endpointUrl: "https://api.example.com/v1" })),
      ).toBe(true);
    });
  });

  it("reports all validation errors at once", () => {
    const errors = expectErrors({ apiKey: "", endpointUrl: "http://example.com" });
    const fields = errors.map((error) => error.field);
    expect(errors).toHaveLength(2);
    expect(new Set(fields)).toEqual(new Set(["apiKey", "endpointUrl"]));
  });

  it("includes the field name, invalid value, and expected format in the error", () => {
    const error = errorForField({ apiKey: "bad" }, "apiKey");
    expect(error.field).toBe("apiKey");
    expect(error.value).toBe("bad");
    expect(error.expectedFormat).toBe("a non-empty key of at least 10 characters");
    expect(error.detail.length).toBeGreaterThan(0);
  });
});
