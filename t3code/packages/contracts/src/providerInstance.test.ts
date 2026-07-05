import { describe, expect, it } from "vitest";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceConfigMap,
  ProviderInstanceId,
  ProviderInstanceRef,
  validateProviderConfig,
} from "./providerInstance.ts";

const decodeProviderDriverKind = Schema.decodeUnknownSync(ProviderDriverKind);
const decodeProviderInstanceId = Schema.decodeUnknownSync(ProviderInstanceId);
const decodeProviderInstanceRef = Schema.decodeUnknownSync(ProviderInstanceRef);
const decodeProviderInstanceConfig = Schema.decodeUnknownSync(ProviderInstanceConfig);
const decodeProviderInstanceConfigMap = Schema.decodeUnknownSync(ProviderInstanceConfigMap);

const expectProviderConfigErrors = (input: unknown) => {
  const decoded = decodeProviderInstanceConfig(input);
  const result = validateProviderConfig(decoded);
  expect(Result.isFailure(result)).toBe(true);
  if (!Result.isFailure(result)) {
    throw new Error("Expected provider config validation to fail");
  }
  return result.failure;
};

describe("provider slug validation (shared by driver + instance ids)", () => {
  const cases = [
    { schemaName: "ProviderInstanceId", decode: decodeProviderInstanceId },
    { schemaName: "ProviderDriverKind", decode: decodeProviderDriverKind },
  ] as const;

  for (const { schemaName, decode } of cases) {
    describe(schemaName, () => {
      it.each(["codex", "codex_personal", "codex-work", "claudeAgent", "x", "abc123", "ollama"])(
        "accepts %s",
        (id) => {
          expect(decode(id)).toBe(id);
        },
      );

      it.each([
        ["empty string", ""],
        ["leading digit", "1codex"],
        ["leading dash", "-codex"],
        ["leading underscore", "_codex"],
        ["whitespace inside", "codex personal"],
        ["dot inside", "codex.personal"],
        ["slash inside", "codex/personal"],
      ])("rejects %s", (_label, value) => {
        expect(() => decode(value)).toThrow();
      });

      it("trims surrounding whitespace before validating", () => {
        expect(decode("  codex_work  ")).toBe("codex_work");
      });

      it("rejects ids longer than 64 characters", () => {
        const tooLong = "a".repeat(65);
        expect(() => decode(tooLong)).toThrow();
        const justRight = "a".repeat(64);
        expect(decode(justRight)).toBe(justRight);
      });
    });
  }
});

describe("ProviderInstanceRef", () => {
  it("decodes a driver ref", () => {
    const ref = decodeProviderInstanceRef({
      instanceId: "codex_work",
      driver: "codex",
    });
    expect(ref.instanceId).toBe("codex_work");
    expect(ref.driver).toBe("codex");
  });

  it("decodes a fork-defined driver ref without complaint", () => {
    const ref = decodeProviderInstanceRef({
      instanceId: "ollama_local",
      driver: "ollama",
    });
    expect(ref.instanceId).toBe("ollama_local");
    expect(ref.driver).toBe("ollama");
  });

  it("rejects refs whose driver field is not a valid slug", () => {
    expect(() =>
      decodeProviderInstanceRef({
        instanceId: "codex",
        driver: "1nope",
      }),
    ).toThrow();
  });
});

describe("ProviderInstanceConfig", () => {
  it("accepts a minimal config envelope for a driver", () => {
    const decoded = decodeProviderInstanceConfig({ driver: "codex" });
    expect(decoded.driver).toBe("codex");
    expect(decoded.displayName).toBeUndefined();
    expect(decoded.enabled).toBeUndefined();
    expect(decoded.config).toBeUndefined();
  });

  it("preserves driver-opaque config payloads verbatim", () => {
    const opaqueConfig = { homePath: "~/.codex_personal", binaryPath: "codex" };
    const decoded = decodeProviderInstanceConfig({
      driver: "codex",
      displayName: "Codex (personal)",
      accentColor: "#dc2626",
      enabled: true,
      config: opaqueConfig,
    });
    expect(decoded.displayName).toBe("Codex (personal)");
    expect(decoded.accentColor).toBe("#dc2626");
    expect(decoded.enabled).toBe(true);
    expect(decoded.config).toEqual(opaqueConfig);
  });

  it("trims provider instance envelope fields", () => {
    const decoded = decodeProviderInstanceConfig({
      driver: "  codex  ",
      displayName: "  Codex Personal  ",
      accentColor: "  #dc2626  ",
      environment: [{ name: "  OPENROUTER_API_KEY  ", value: "  sk-or-test  " }],
    });

    expect(decoded).toMatchObject({
      driver: "codex",
      displayName: "Codex Personal",
      accentColor: "#dc2626",
      environment: [{ name: "OPENROUTER_API_KEY", value: "  sk-or-test  " }],
    });
  });

  it("decodes generic environment variables on the instance envelope", () => {
    const decoded = decodeProviderInstanceConfig({
      driver: "claudeAgent",
      environment: [
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
        { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
        { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
      ],
    });

    expect(decoded.environment).toEqual([
      { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      { name: "OPENROUTER_API_KEY", value: "sk-or-test", sensitive: true },
      { name: "ANTHROPIC_API_KEY", value: "", sensitive: false },
    ]);
  });

  it("rejects invalid environment variable names", () => {
    expect(() =>
      decodeProviderInstanceConfig({
        driver: "codex",
        environment: [{ name: "HAS-DASH", value: "x", sensitive: false }],
      }),
    ).toThrow();
  });

  it("decodes envelopes that name an unknown driver and preserves their config opaquely", () => {
    const opaqueConfig = { someUnknownKnob: 42, model: "llama3" };
    const decoded = decodeProviderInstanceConfig({
      driver: "ollama",
      displayName: "Ollama",
      enabled: true,
      config: opaqueConfig,
    });
    expect(decoded.driver).toBe("ollama");
    expect(decoded.config).toEqual(opaqueConfig);
  });

  it("rejects a blank displayName (must be trimmed non-empty)", () => {
    expect(() => decodeProviderInstanceConfig({ driver: "codex", displayName: "   " })).toThrow();
  });

  it("rejects driver values that do not satisfy the slug pattern", () => {
    expect(() => decodeProviderInstanceConfig({ driver: "" })).toThrow();
    expect(() => decodeProviderInstanceConfig({ driver: "has spaces" })).toThrow();
  });
});

describe("validateProviderConfig", () => {
  it("passes valid provider config API keys and HTTPS endpoints unchanged", () => {
    const decoded = decodeProviderInstanceConfig({
      driver: "claudeAgent",
      environment: [
        { name: "ANTHROPIC_API_KEY", value: "sk-ant-valid-12345", sensitive: true },
        { name: "ANTHROPIC_BASE_URL", value: "https://api.anthropic.com", sensitive: false },
      ],
      config: {
        apiKey: "provider-key-12345",
        endpointUrl: "https://provider.example.com/v1",
        nested: {
          baseUrl: "https://nested.example.com",
        },
      },
    });

    const result = validateProviderConfig(decoded);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toBe(decoded);
    }
  });

  it("rejects empty API key fields without breaking envelope decoding", () => {
    const decoded = decodeProviderInstanceConfig({
      driver: "claudeAgent",
      environment: [{ name: "ANTHROPIC_API_KEY", value: "", sensitive: true }],
    });

    expect(decoded.environment?.[0]?.value).toBe("");

    const result = validateProviderConfig(decoded);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toHaveLength(1);
      expect(result.failure[0]).toMatchObject({
        _tag: "ProviderConfigError",
        fieldName: "environment.ANTHROPIC_API_KEY",
        invalidValue: "",
        expectedFormat: expect.stringContaining("at least 10"),
      });
    }
  });

  it("rejects API keys shorter than 10 characters", () => {
    const errors = expectProviderConfigErrors({
      driver: "codex",
      config: { apiKey: "short" },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      fieldName: "config.apiKey",
      invalidValue: "short",
      expectedFormat: expect.stringContaining("at least 10"),
    });
  });

  it("rejects HTTP provider endpoint URLs with an HTTPS suggestion", () => {
    const errors = expectProviderConfigErrors({
      driver: "codex",
      environment: [{ name: "OPENAI_BASE_URL", value: "http://api.openai.com" }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      fieldName: "environment.OPENAI_BASE_URL",
      invalidValue: "http://api.openai.com",
      expectedFormat: expect.stringContaining("Use https://"),
    });
  });

  it("rejects malformed endpoint URLs", () => {
    const errors = expectProviderConfigErrors({
      driver: "codex",
      config: { endpointUrl: "not-a-url" },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      fieldName: "config.endpointUrl",
      invalidValue: "not-a-url",
      expectedFormat: expect.stringContaining("valid HTTPS URL"),
    });
  });

  it("returns all validation errors instead of only the first", () => {
    const errors = expectProviderConfigErrors({
      driver: "codex",
      config: {
        apiKey: "short",
        endpointUrl: "http://bad",
      },
    });

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.fieldName)).toEqual(["config.apiKey", "config.endpointUrl"]);
    expect(errors.map((error) => error.invalidValue)).toEqual(["short", "http://bad"]);
  });
});

describe("ProviderInstanceConfigMap", () => {
  it("decodes a multi-instance map mixing first-party and fork drivers", () => {
    const decoded = decodeProviderInstanceConfigMap({
      codex_personal: {
        driver: "codex",
        displayName: "Codex (personal)",
        config: { homePath: "~/.codex_personal" },
      },
      codex_work: {
        driver: "codex",
        config: { homePath: "~/.codex_work" },
      },
      claudeAgent: { driver: "claudeAgent" },
      ollama_local: { driver: "ollama", config: { endpoint: "http://localhost:11434" } },
    });
    expect(new Set(Object.keys(decoded))).toEqual(
      new Set(["claudeAgent", "codex_personal", "codex_work", "ollama_local"]),
    );
    expect(decoded[ProviderInstanceId.make("codex_personal")]?.driver).toBe("codex");
    expect(decoded[ProviderInstanceId.make("codex_work")]?.config).toEqual({
      homePath: "~/.codex_work",
    });
    expect(decoded[ProviderInstanceId.make("ollama_local")]?.driver).toBe("ollama");
  });

  it("rejects keys that fail the instance-id pattern", () => {
    expect(() =>
      decodeProviderInstanceConfigMap({
        "1codex": { driver: "codex" },
      }),
    ).toThrow();
  });
});
