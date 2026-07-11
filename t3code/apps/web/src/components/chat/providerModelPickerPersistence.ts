import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";

/** Namespaced localStorage key for last selected provider + model. */
export const PROVIDER_MODEL_PICKER_STORAGE_KEY = "t3code:provider-model-picker:v1";

export type PersistedProviderModelSelection = {
  instanceId: string;
  model: string;
};

export type ResolvedProviderModelSelection = {
  instanceId: ProviderInstanceId;
  model: string;
};

const memoryStore = new Map<string, string>();

function getStorage(): Storage | { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return window.localStorage;
  }
  return {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => {
      memoryStore.set(k, v);
    },
    removeItem: (k) => {
      memoryStore.delete(k);
    },
  };
}

export function readPersistedProviderModelSelection(): PersistedProviderModelSelection | null {
  try {
    const raw = getStorage().getItem(PROVIDER_MODEL_PICKER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedProviderModelSelection>;
    if (
      typeof parsed?.instanceId !== "string" ||
      parsed.instanceId.length === 0 ||
      typeof parsed?.model !== "string" ||
      parsed.model.length === 0
    ) {
      return null;
    }
    return { instanceId: parsed.instanceId, model: parsed.model };
  } catch {
    return null;
  }
}

export function writePersistedProviderModelSelection(
  selection: PersistedProviderModelSelection,
): void {
  try {
    getStorage().setItem(PROVIDER_MODEL_PICKER_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function clearPersistedProviderModelSelection(): void {
  try {
    getStorage().removeItem(PROVIDER_MODEL_PICKER_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Resolve a preferred selection against currently available instances/models.
 * Falls back to the first available instance + its first model when the
 * preferred pair is missing or incomplete.
 */
export function resolveProviderModelSelection(
  preferred: PersistedProviderModelSelection | null | undefined,
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): ResolvedProviderModelSelection | null {
  if (instanceEntries.length === 0) return null;

  if (preferred) {
    const preferredEntry = instanceEntries.find(
      (entry) => entry.instanceId === preferred.instanceId,
    );
    if (preferredEntry) {
      const options = modelOptionsByInstance.get(preferredEntry.instanceId) ?? [];
      const modelMatch = options.find((option) => option.slug === preferred.model);
      if (modelMatch) {
        return { instanceId: preferredEntry.instanceId, model: modelMatch.slug };
      }
      if (options[0]) {
        return { instanceId: preferredEntry.instanceId, model: options[0].slug };
      }
    }
  }

  const firstEntry = instanceEntries[0]!;
  const firstOptions = modelOptionsByInstance.get(firstEntry.instanceId) ?? [];
  if (!firstOptions[0]) {
    return { instanceId: firstEntry.instanceId, model: "" };
  }
  return { instanceId: firstEntry.instanceId, model: firstOptions[0].slug };
}
