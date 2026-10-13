import { describe, expect, it } from "vitest";
import type { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";

import {
  PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY,
  PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY,
  clearPersistedProviderModelSelection,
  getProviderModelPickerStorage,
  isProviderModelPickerStorageKey,
  readPersistedProviderModelSelection,
  readProviderModelPickerStorageChange,
  resolveRestoredProviderModelSelection,
  writePersistedProviderModelSelection,
  type ProviderModelPickerStorage,
} from "./providerModelPickerPersistence";
import type { ProviderInstanceEntry } from "../../providerInstances";

function createMemoryStorage(): ProviderModelPickerStorage & {
  dump: () => Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    dump: () => store,
  };
}

/** Storage stub whose mutations always fail (quota/security errors). */
function createThrowingStorage(): ProviderModelPickerStorage {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
}

function makeEntry(
  overrides: Partial<Omit<ProviderInstanceEntry, "instanceId">> & { instanceId: string },
): ProviderInstanceEntry {
  return {
    driverKind: "codex" as ProviderDriverKind,
    displayName: overrides.displayName ?? overrides.instanceId,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [],
    ...overrides,
    instanceId: overrides.instanceId as ProviderInstanceId,
  } as ProviderInstanceEntry;
}

function makeOptions(...models: Array<string | [slug: string, name: string]>): Array<{
  slug: string;
  name: string;
}> {
  return models.map((model) =>
    typeof model === "string" ? { slug: model, name: model } : { slug: model[0], name: model[1] },
  );
}

describe("readPersistedProviderModelSelection", () => {
  it("returns null for empty storage", () => {
    expect(readPersistedProviderModelSelection(createMemoryStorage())).toBeNull();
  });

  it("returns null when only the provider key is set", () => {
    const storage = createMemoryStorage();
    storage.setItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY, "codex");
    expect(readPersistedProviderModelSelection(storage)).toBeNull();
  });

  it("returns null when only the model key is set", () => {
    const storage = createMemoryStorage();
    storage.setItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY, "gpt-5-codex");
    expect(readPersistedProviderModelSelection(storage)).toBeNull();
  });

  it("returns null when either value is an empty string", () => {
    const storage = createMemoryStorage();
    // Writes are deliberately unvalidated: an empty component of the pair
    // reads back as "nothing saved" rather than being rejected on write.
    writePersistedProviderModelSelection(storage, "", "gpt-5-codex");
    expect(readPersistedProviderModelSelection(storage)).toBeNull();

    const other = createMemoryStorage();
    writePersistedProviderModelSelection(other, "codex", "");
    expect(readPersistedProviderModelSelection(other)).toBeNull();
  });

  it("round-trips a written selection", () => {
    const storage = createMemoryStorage();
    writePersistedProviderModelSelection(storage, "claudeAgent", "claude-opus-4-6");
    expect(readPersistedProviderModelSelection(storage)).toEqual({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
    });
  });

  it("swallows storage failures on write and clear instead of throwing", () => {
    expect(() =>
      writePersistedProviderModelSelection(createThrowingStorage(), "codex", "gpt-5-codex"),
    ).not.toThrow();
    expect(() => clearPersistedProviderModelSelection(createThrowingStorage())).not.toThrow();
  });
});

describe("getProviderModelPickerStorage", () => {
  it("returns null outside a browser environment", () => {
    // Unit tests run in the node environment where `window` is undefined.
    expect(typeof window).toBe("undefined");
    expect(getProviderModelPickerStorage()).toBeNull();
  });
});

describe("readProviderModelPickerStorageChange", () => {
  it("reports a selection when both keys hold values", () => {
    const storage = createMemoryStorage();
    writePersistedProviderModelSelection(storage, "codex", "gpt-5-codex");
    expect(readProviderModelPickerStorageChange(storage)).toEqual({
      kind: "selection",
      persisted: { provider: "codex", model: "gpt-5-codex" },
    });
  });

  it("reports cleared when both keys are absent", () => {
    const storage = createMemoryStorage();
    expect(readProviderModelPickerStorageChange(storage)).toEqual({ kind: "cleared" });

    writePersistedProviderModelSelection(storage, "codex", "gpt-5-codex");
    clearPersistedProviderModelSelection(storage);
    expect(readProviderModelPickerStorageChange(storage)).toEqual({ kind: "cleared" });
  });

  it("ignores the transient half-written state between the two keys", () => {
    const providerOnly = createMemoryStorage();
    providerOnly.setItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY, "codex");
    expect(readProviderModelPickerStorageChange(providerOnly)).toBeNull();

    const modelOnly = createMemoryStorage();
    modelOnly.setItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY, "gpt-5-codex");
    expect(readProviderModelPickerStorageChange(modelOnly)).toBeNull();
  });
});

describe("clearPersistedProviderModelSelection", () => {
  it("removes both namespaced keys and nothing else", () => {
    const storage = createMemoryStorage();
    writePersistedProviderModelSelection(storage, "codex", "gpt-5-codex");
    storage.setItem("t3code:client-settings:v1", "{}");

    clearPersistedProviderModelSelection(storage);

    expect(storage.getItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("t3code:client-settings:v1")).toBe("{}");
    expect(readPersistedProviderModelSelection(storage)).toBeNull();
  });
});

describe("isProviderModelPickerStorageKey", () => {
  it("matches both picker keys and rejects everything else", () => {
    expect(isProviderModelPickerStorageKey("t3code.provider")).toBe(true);
    expect(isProviderModelPickerStorageKey("t3code.model")).toBe(true);
    expect(isProviderModelPickerStorageKey("t3code:client-settings:v1")).toBe(false);
    expect(isProviderModelPickerStorageKey(null)).toBe(false);
  });
});

describe("resolveRestoredProviderModelSelection", () => {
  const codexEntry = makeEntry({ instanceId: "codex" });
  const claudeEntry = makeEntry({
    instanceId: "claudeAgent",
    driverKind: "claudeAgent" as ProviderDriverKind,
  });

  function baseInput(overrides?: {
    persisted?: { provider: string; model: string } | null;
    instanceEntries?: ReadonlyArray<ProviderInstanceEntry>;
    lockedProvider?: ProviderDriverKind | null;
    lockedContinuationGroupKey?: string | null;
  }) {
    return {
      persisted: overrides?.persisted ?? null,
      instanceEntries: overrides?.instanceEntries ?? [codexEntry, claudeEntry],
      modelOptionsByInstance: new Map<ProviderInstanceId, ReadonlyArray<{ slug: string; name: string }>>([
        [
          "codex" as ProviderInstanceId,
          makeOptions(["gpt-5-codex", "GPT-5 Codex"], ["gpt-5.3-codex", "GPT-5.3 Codex"]),
        ],
        [
          "claudeAgent" as ProviderInstanceId,
          makeOptions("claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"),
        ],
      ]),
      lockedProvider: overrides?.lockedProvider ?? null,
      lockedContinuationGroupKey: overrides?.lockedContinuationGroupKey ?? null,
    };
  }

  it("restores a valid persisted provider and model unchanged", () => {
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({ persisted: { provider: "claudeAgent", model: "claude-sonnet-4-6" } }),
      ),
    ).toEqual({ instanceId: "claudeAgent", model: "claude-sonnet-4-6" });
  });

  it("keeps the persisted provider and falls back to its first model when the slug is stale", () => {
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({ persisted: { provider: "claudeAgent", model: "claude-4-obsolete" } }),
      ),
    ).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-6" });
  });

  it("keeps the persisted provider when the model resolves through a display-name match", () => {
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({ persisted: { provider: "codex", model: "GPT-5.3 Codex" } }),
      ),
    ).toEqual({ instanceId: "codex", model: "gpt-5.3-codex" });
  });

  it("falls back to the first available provider when the persisted provider is unknown", () => {
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({ persisted: { provider: "nonexistent_provider", model: "whatever" } }),
      ),
    ).toEqual({ instanceId: "codex", model: "gpt-5-codex" });
  });

  it("falls back to the first available provider when the persisted provider is disabled", () => {
    const disabledClaude = makeEntry({
      instanceId: "claudeAgent",
      driverKind: "claudeAgent" as ProviderDriverKind,
      enabled: false,
      status: "disabled",
    });
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({
          persisted: { provider: "claudeAgent", model: "claude-opus-4-6" },
          instanceEntries: [codexEntry, disabledClaude],
        }),
      ),
    ).toEqual({ instanceId: "codex", model: "gpt-5-codex" });
  });

  it("skips not-ready and unavailable entries", () => {
    const notReady = makeEntry({ instanceId: "codex", status: "error" });
    const unavailable = makeEntry({ instanceId: "claudeAgent", isAvailable: false });
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({
          persisted: { provider: "codex", model: "gpt-5-codex" },
          instanceEntries: [notReady, unavailable],
        }),
      ),
    ).toBeNull();
  });

  it("skips instances without model options when picking the fallback", () => {
    const emptyCodex = makeEntry({ instanceId: "codex" });
    const input = baseInput({ instanceEntries: [emptyCodex, claudeEntry] });
    input.modelOptionsByInstance = new Map([
      ["codex" as ProviderInstanceId, []],
      [
        "claudeAgent" as ProviderInstanceId,
        makeOptions("claude-opus-4-6", "claude-sonnet-4-6"),
      ],
    ]);
    expect(resolveRestoredProviderModelSelection(input)).toEqual({
      instanceId: "claudeAgent",
      model: "claude-opus-4-6",
    });
  });

  it("returns null when nothing is selectable", () => {
    expect(resolveRestoredProviderModelSelection(baseInput({ instanceEntries: [] }))).toBeNull();
  });

  it("returns the first available selection when nothing was persisted (reset path)", () => {
    expect(resolveRestoredProviderModelSelection(baseInput())).toEqual({
      instanceId: "codex",
      model: "gpt-5-codex",
    });
  });

  it("respects a locked provider by excluding other driver kinds", () => {
    expect(
      resolveRestoredProviderModelSelection(
        baseInput({
          persisted: { provider: "codex", model: "gpt-5-codex" },
          lockedProvider: "claudeAgent" as ProviderDriverKind,
        }),
      ),
    ).toEqual({ instanceId: "claudeAgent", model: "claude-opus-4-6" });
  });

  it("respects a locked continuation group key", () => {
    const isolatedCodex = makeEntry({
      instanceId: "codex_isolated",
      continuationGroupKey: "codex:home:/isolated",
    });
    const groupedClaude = makeEntry({
      instanceId: "claudeAgent",
      driverKind: "claudeAgent" as ProviderDriverKind,
      continuationGroupKey: "claudeAgent:primary",
    });
    const input = baseInput({
      persisted: { provider: "codex_isolated", model: "gpt-isolated" },
      lockedProvider: "codex" as ProviderDriverKind,
      lockedContinuationGroupKey: "codex:home:/primary",
      instanceEntries: [isolatedCodex, groupedClaude],
    });
    input.modelOptionsByInstance = new Map([
      ["codex_isolated" as ProviderInstanceId, makeOptions("gpt-isolated")],
      ["claudeAgent" as ProviderInstanceId, makeOptions("claude-opus-4-6")],
    ]);
    expect(resolveRestoredProviderModelSelection(input)).toBeNull();
  });
});
