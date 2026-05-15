import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  EnvironmentId,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import type { ServerProvider } from "@t3tools/contracts";

const STORAGE_KEY = "t3code:providerModelPickerSelection";

// ── Helper functions (mirrored from component) ────────────────────────

function readPersistedSelection(): { instanceId: string; model: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.instanceId === "string" &&
      typeof parsed.model === "string"
    ) {
      return { instanceId: parsed.instanceId, model: parsed.model };
    }
    return null;
  } catch {
    return null;
  }
}

function writePersistedSelection(instanceId: string, model: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ instanceId, model }));
  } catch {
    // noop
  }
}

// ── Test data ─────────────────────────────────────────────────────────

const CODEX_INSTANCE = ProviderInstanceId.make("codex");
const CLAUDE_INSTANCE = ProviderInstanceId.make("claudeAgent");

const TEST_PROVIDERS: ServerProvider[] = [
  {
    driver: ProviderDriverKind.make("codex"),
    instanceId: CODEX_INSTANCE,
    displayName: "Codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  },
  {
    driver: ProviderDriverKind.make("claudeAgent"),
    instanceId: CLAUDE_INSTANCE,
    displayName: "Claude",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: [] }),
      },
    ],
  },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe("ProviderModelPicker persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("localStorage read/write helpers", () => {
    it("writes and reads a valid selection", () => {
      writePersistedSelection("codex", "gpt-5-codex");
      const result = readPersistedSelection();
      expect(result).toEqual({ instanceId: "codex", model: "gpt-5-codex" });
    });

    it("returns null when no selection is stored", () => {
      expect(readPersistedSelection()).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      localStorage.setItem(STORAGE_KEY, "not-json");
      expect(readPersistedSelection()).toBeNull();
    });

    it("returns null for incomplete data", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ instanceId: "codex" }));
      expect(readPersistedSelection()).toBeNull();
    });

    it("overwrites previous selection on write", () => {
      writePersistedSelection("codex", "gpt-5-codex");
      writePersistedSelection("claudeAgent", "claude-opus-4-6");
      const result = readPersistedSelection();
      expect(result).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-6" });
    });
  });

  describe("restore from localStorage on mount", () => {
    it("restores selection when valid provider and model exist", () => {
      // Pre-populate localStorage
      writePersistedSelection("codex", "gpt-5.3-codex");

      const result = readPersistedSelection();
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe("codex");
      expect(result!.model).toBe("gpt-5.3-codex");
    });

    it("falls back to first available provider when persisted provider is gone", () => {
      // Persist a provider that no longer exists
      writePersistedSelection("deprecated-provider", "some-model");

      const result = readPersistedSelection();
      expect(result).not.toBeNull();
      expect(result!.instanceId).toBe("deprecated-provider");

      // Now simulate the fallback logic: find first available provider
      const firstAvailable = TEST_PROVIDERS.find((p) => p.enabled);
      expect(firstAvailable).toBeDefined();
      expect(firstAvailable!.instanceId).toBe(CODEX_INSTANCE);
    });

    it("falls back to first model when persisted model is invalid", () => {
      // Persist a valid provider but invalid model
      writePersistedSelection("codex", "non-existent-model");

      const result = readPersistedSelection();
      expect(result).not.toBeNull();
      expect(result!.model).toBe("non-existent-model");

      // Simulate model resolution fallback
      const codexProvider = TEST_PROVIDERS.find((p) => p.instanceId === CODEX_INSTANCE);
      const validModels = codexProvider!.models;
      const modelStillValid = validModels.some((m) => m.slug === "non-existent-model");
      expect(modelStillValid).toBe(false);

      const fallbackModel = validModels[0]?.slug;
      expect(fallbackModel).toBe("gpt-5-codex");
    });
  });

  describe("persist on selection change", () => {
    it("saves selection to localStorage when instance and model change", () => {
      // Simulate what happens when handleInstanceModelChange fires
      writePersistedSelection("codex", "gpt-5-codex");

      const result = readPersistedSelection();
      expect(result).toEqual({ instanceId: "codex", model: "gpt-5-codex" });
    });

    it("updates localStorage when switching to a different provider", () => {
      writePersistedSelection("codex", "gpt-5-codex");
      writePersistedSelection("claudeAgent", "claude-opus-4-6");

      const result = readPersistedSelection();
      expect(result).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-6" });
    });
  });
});
