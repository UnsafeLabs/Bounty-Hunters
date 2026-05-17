import { describe, expect, it } from "vitest";
import * as Either from "effect/Either";

import {
  validateProviderConfig,
  validateAllProviderConfigs,
  ProviderConfigError,
  ApiKeySchema,
  HttpsUrlSchema,
} from "./providerConfigValidation.ts";

// ---------------------------------------------------------------------------
// validateProviderConfig
// ---------------------------------------------------------------------------

describe("validateProviderConfig", () => {
  it("passes for a valid configuration", () => {
    const config = {
      driver: "codex",
      apiKey: "sk-1234567890abcdef",
      endpointUrl: "https://api.openai.com/v1",
    };
    const result = validateProviderConfig(config);
    expect(Either.isRight(result)).toBe(true);
  });

  it("passes when only driver is specified (apiKey/endpointUrl optional)", () => {
    const config = { driver: "claudeAgent" };
    const result = validateProviderConfig(config);
    expect(Either.isRight(result)).toBe(true);
  });

  it("fails when driver is missing", () => {
    const config = { apiKey: "sk-1234567890abcdef" };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.some((e) => e.field === "driver")).toBe(true);
    }
  });

  it("fails when driver has invalid format", () => {
    const config = { driver: "123invalid" };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const driverError = result.left.find((e) => e.field === "driver");
      expect(driverError).toBeDefined();
    }
  });

  it("fails when API key is empty string", () => {
    const config = { driver: "codex", apiKey: "" };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const apiKeyError = result.left.find((e) => e.field === "apiKey");
      expect(apiKeyError).toBeDefined();
      expect(apiKeyError?.expected).toContain("10 characters");
    }
  });

  it("fails when API key is too short (< 10 chars)", () => {
    const config = { driver: "codex", apiKey: "short" };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const apiKeyError = result.left.find((e) => e.field === "apiKey");
      expect(apiKeyError).toBeDefined();
      expect(apiKeyError?.expected).toContain("10 characters");
    }
  });

  it("fails when endpoint URL uses HTTP instead of HTTPS", () => {
    const config = {
      driver: "codex",
      endpointUrl: "http://api.example.com/v1",
    };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const urlError = result.left.find((e) => e.field === "endpointUrl");
      expect(urlError).toBeDefined();
      expect(urlError?.expected).toContain("HTTPS");
    }
  });

  it("fails when endpoint URL is malformed", () => {
    const config = {
      driver: "codex",
      endpointUrl: "not-a-url",
    };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const urlError = result.left.find((e) => e.field === "endpointUrl");
      expect(urlError).toBeDefined();
      expect(urlError?.expected).toContain("HTTPS");
    }
  });

  it("returns all errors at once, not just the first", () => {
    const config = {
      driver: "123invalid",
      apiKey: "",
      endpointUrl: "http://insecure.com",
    };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      // Should have multiple errors
      expect(result.left.length).toBeGreaterThanOrEqual(2);
      const fields = result.left.map((e) => e.field);
      expect(fields).toContain("driver");
      expect(fields).toContain("apiKey");
      expect(fields).toContain("endpointUrl");
    }
  });

  it("extracts apiKey from nested config envelope", () => {
    const config = {
      driver: "codex",
      config: {
        apiKey: "sk-1234567890abcdef",
        baseURL: "https://api.openai.com/v1",
      },
    };
    const result = validateProviderConfig(config);
    expect(Either.isRight(result)).toBe(true);
  });

  it("catches short API key in nested config envelope", () => {
    const config = {
      driver: "codex",
      config: {
        api_key: "short",
      },
    };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.some((e) => e.field === "apiKey")).toBe(true);
    }
  });

  it("includes instanceId in error when provided", () => {
    const config = {
      driver: "codex",
      apiKey: "short",
      instanceId: "my-instance",
    };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      const apiKeyError = result.left.find((e) => e.field === "apiKey");
      expect(apiKeyError?.instanceId).toBe("my-instance");
    }
  });

  it("allows localhost HTTPS URLs", () => {
    const config = {
      driver: "ollama",
      endpointUrl: "https://localhost:11434",
    };
    const result = validateProviderConfig(config);
    expect(Either.isRight(result)).toBe(true);
  });

  it("validates environment variables with short API key values", () => {
    const config = {
      driver: "codex",
      environment: [
        { name: "API_KEY", value: "short", sensitive: true },
      ],
    };
    const result = validateProviderConfig(config);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.some((e) => e.field.startsWith("environment"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateAllProviderConfigs
// ---------------------------------------------------------------------------

describe("validateAllProviderConfigs", () => {
  it("passes for all valid configurations", () => {
    const configs = {
      "codex-main": {
        driver: "codex",
        apiKey: "sk-1234567890abcdef",
        endpointUrl: "https://api.openai.com/v1",
      },
      "claude-agent": {
        driver: "claudeAgent",
        apiKey: "sk-ant-1234567890abcdef",
      },
    };
    const result = validateAllProviderConfigs(configs);
    expect(Either.isRight(result)).toBe(true);
  });

  it("collects errors across multiple instances", () => {
    const configs = {
      "bad-1": { driver: "123", apiKey: "" },
      "bad-2": { endpointUrl: "http://bad.com" },
    };
    const result = validateAllProviderConfigs(configs);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Schema refinements
// ---------------------------------------------------------------------------

describe("ApiKeySchema", () => {
  it("accepts valid API keys", () => {
    const result = Schema.decodeUnknownEither(ApiKeySchema)("sk-1234567890abcdef");
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects short API keys", () => {
    const result = Schema.decodeUnknownEither(ApiKeySchema)("short");
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("HttpsUrlSchema", () => {
  it("accepts valid HTTPS URLs", () => {
    const result = Schema.decodeUnknownEither(HttpsUrlSchema)("https://api.example.com/v1");
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects HTTP URLs", () => {
    const result = Schema.decodeUnknownEither(HttpsUrlSchema)("http://api.example.com/v1");
    expect(Either.isLeft(result)).toBe(true);
  });
});

import * as Schema from "effect/Schema";
