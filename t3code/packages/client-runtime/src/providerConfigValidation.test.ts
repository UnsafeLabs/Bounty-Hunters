import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { validateProviderConfig, validateConfigFile, createDefaultConfig } from "./providerConfigValidation";

describe("validateProviderConfig", () => {
  it("should validate a correct config", async () => {
    const config = {
      id: "openai",
      name: "OpenAI",
      apiEndpoint: "https://api.openai.com/v1",
      apiKey: "sk-test-key-1234567890abcdef",
      model: "gpt-4",
      maxTokens: 4096,
      temperature: 0.7,
      enabled: true,
      priority: 0,
    };
    const result = await Effect.runPromise(validateProviderConfig(config));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should reject invalid apiEndpoint", async () => {
    const config = {
      id: "bad",
      name: "Bad",
      apiEndpoint: "not-a-url",
      apiKey: "key",
      model: "x",
      maxTokens: 100,
      temperature: 0.5,
      enabled: true,
      priority: 0,
    };
    const result = await Effect.runPromise(validateProviderConfig(config));
    expect(result.valid).toBe(false);
  });

  it("should warn on very high maxTokens", async () => {
    const config = createDefaultConfig("t", "T", "k".repeat(20), "https://api.test.com");
    config.maxTokens = 200000;
    const result = await Effect.runPromise(validateProviderConfig(config));
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("validateConfigFile", () => {
  it("should detect duplicate names", async () => {
    const configs = [
      { id: "a", name: "Same", apiEndpoint: "https://a.com", apiKey: "k".repeat(20), model: "m", maxTokens: 100, temperature: 0.5, enabled: true, priority: 0 },
      { id: "b", name: "Same", apiEndpoint: "https://b.com", apiKey: "k".repeat(20), model: "m", maxTokens: 100, temperature: 0.5, enabled: true, priority: 0 },
    ];
    const results = await Effect.runPromise(validateConfigFile(configs));
    expect(results[1].errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });
});
