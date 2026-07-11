import { ProviderInstanceId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";
import {
  PROVIDER_MODEL_PICKER_STORAGE_KEY,
  clearPersistedProviderModelSelection,
  readPersistedProviderModelSelection,
  resolveProviderModelSelection,
  writePersistedProviderModelSelection,
} from "./providerModelPickerPersistence";

const codexId = ProviderInstanceId.make("codex");
const claudeId = ProviderInstanceId.make("claudeAgent");

const entries: ReadonlyArray<ProviderInstanceEntry> = [
  {
    instanceId: codexId,
    driverKind: "codex" as ProviderInstanceEntry["driverKind"],
    displayName: "Codex",
  },
  {
    instanceId: claudeId,
    driverKind: "claudeAgent" as ProviderInstanceEntry["driverKind"],
    displayName: "Claude",
  },
];

const models = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>([
  [codexId, [{ slug: "gpt-5-codex", name: "GPT-5 Codex" }]],
  [
    claudeId,
    [
      { slug: "claude-opus-4-6", name: "Claude Opus 4.6" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    ],
  ],
]);

afterEach(() => {
  clearPersistedProviderModelSelection();
});

describe("providerModelPickerPersistence", () => {
  it("uses a namespaced storage key", () => {
    expect(PROVIDER_MODEL_PICKER_STORAGE_KEY.startsWith("t3code:")).toBe(true);
  });

  it("returns null when storage is empty", () => {
    expect(readPersistedProviderModelSelection()).toBeNull();
  });

  it("round-trips provider and model", () => {
    writePersistedProviderModelSelection({
      instanceId: claudeId,
      model: "claude-sonnet-4-6",
    });
    expect(readPersistedProviderModelSelection()).toEqual({
      instanceId: claudeId,
      model: "claude-sonnet-4-6",
    });
  });

  it("clears persisted preference", () => {
    writePersistedProviderModelSelection({
      instanceId: codexId,
      model: "gpt-5-codex",
    });
    clearPersistedProviderModelSelection();
    expect(readPersistedProviderModelSelection()).toBeNull();
  });

  it("falls back to first available when preferred provider is gone", () => {
    const resolved = resolveProviderModelSelection(
      { instanceId: "missing-provider", model: "x" },
      entries,
      models,
    );
    expect(resolved).toEqual({ instanceId: codexId, model: "gpt-5-codex" });
  });

  it("falls back to first model when preferred model is gone but provider remains", () => {
    const resolved = resolveProviderModelSelection(
      { instanceId: claudeId, model: "deleted-model" },
      entries,
      models,
    );
    expect(resolved).toEqual({ instanceId: claudeId, model: "claude-opus-4-6" });
  });

  it("returns preferred pair when still available", () => {
    const resolved = resolveProviderModelSelection(
      { instanceId: claudeId, model: "claude-sonnet-4-6" },
      entries,
      models,
    );
    expect(resolved).toEqual({ instanceId: claudeId, model: "claude-sonnet-4-6" });
  });

  it("empty preferred resolves to first provider first model", () => {
    const resolved = resolveProviderModelSelection(null, entries, models);
    expect(resolved).toEqual({ instanceId: codexId, model: "gpt-5-codex" });
  });
});
