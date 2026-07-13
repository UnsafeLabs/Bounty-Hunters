import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";

/**
 * Namespaced localStorage key for the last selected provider/model. The
 * `t3code:` prefix keeps it from colliding with other apps on the same origin.
 */
export const PROVIDER_MODEL_PICKER_STORAGE_KEY =
  "t3code:provider-model-picker:selection";

export interface PersistedSelection {
  instanceId: string;
  model: string;
}

export interface SelectionResolverDeps {
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
}

/**
 * Minimal storage surface so the module is fully testable with an in-memory
 * fake instead of `window.localStorage`.
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Read the persisted selection. Returns `null` for any unreadable, missing, or
 * malformed payload so callers can fall back to the default selection.
 */
export function readPersistedSelection(
  storage: KeyValueStorage,
  key: string = PROVIDER_MODEL_PICKER_STORAGE_KEY,
): PersistedSelection | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { instanceId?: unknown }).instanceId === "string" &&
      typeof (parsed as { model?: unknown }).model === "string" &&
      (parsed as { instanceId: string }).instanceId.length > 0 &&
      (parsed as { model: string }).model.length > 0
    ) {
      return {
        instanceId: (parsed as { instanceId: string }).instanceId,
        model: (parsed as { model: string }).model,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist a selection as JSON. Failures (quota / private mode) are ignored. */
export function writePersistedSelection(
  storage: KeyValueStorage,
  selection: PersistedSelection,
  key: string = PROVIDER_MODEL_PICKER_STORAGE_KEY,
): void {
  try {
    storage.setItem(key, JSON.stringify(selection));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/** Remove the persisted preference. Failures are ignored. */
export function clearPersistedSelection(
  storage: KeyValueStorage,
  key: string = PROVIDER_MODEL_PICKER_STORAGE_KEY,
): void {
  try {
    storage.removeItem(key);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * True when the persisted selection still resolves to a real, selectable
 * option: the instance exists and the model is one of that instance's options.
 */
export function isSelectionValid(
  selection: PersistedSelection | null,
  deps: SelectionResolverDeps,
): selection is PersistedSelection {
  if (!selection) return false;
  const entry = deps.instanceEntries.find(
    (e) => String(e.instanceId) === selection.instanceId,
  );
  if (!entry) return false;
  const options = deps.modelOptionsByInstance.get(entry.instanceId) ?? [];
  return options.some((o) => o.slug === selection.model);
}

/** First selectable instance + model — used as the default / fallback. */
export function resolveDefaultSelection(
  deps: SelectionResolverDeps,
): PersistedSelection | null {
  const firstEntry = deps.instanceEntries[0];
  if (!firstEntry) return null;
  const options = deps.modelOptionsByInstance.get(firstEntry.instanceId) ?? [];
  const firstModel = options[0];
  if (!firstModel) return null;
  return { instanceId: String(firstEntry.instanceId), model: firstModel.slug };
}

/**
 * Return the persisted selection when valid, otherwise the default. This is the
 * single source of truth the component uses to decide what to restore.
 */
export function resolveEffectiveSelection(
  persisted: PersistedSelection | null,
  deps: SelectionResolverDeps,
): PersistedSelection | null {
  if (isSelectionValid(persisted, deps)) return persisted;
  return resolveDefaultSelection(deps);
}
