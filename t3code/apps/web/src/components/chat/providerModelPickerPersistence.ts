/**
 * localStorage persistence for the provider/model picker selection
 * (UnsafeLabs/Bounty-Hunters#834).
 *
 * The picker itself stays controlled: `ProviderModelPicker` writes the
 * user's pick through these helpers and pushes the restored selection back
 * up via `onInstanceModelChange`, so owners keep owning their state. All
 * resolution logic lives here as pure functions so the restore/fallback
 * rules are unit-testable without a DOM.
 */
import {
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import type { ProviderInstanceEntry } from "../../providerInstances";

/** Namespaced localStorage key for the selected provider instance id. */
export const PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY = "t3code.provider";
/** Namespaced localStorage key for the selected model slug. */
export const PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY = "t3code.model";

/** Minimal storage surface the helpers need — satisfied by `localStorage`. */
export interface ProviderModelPickerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedProviderModelSelection {
  readonly provider: string;
  readonly model: string;
}

export interface ResolvedProviderModelSelection {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
}

/**
 * Resolve `window.localStorage` defensively: access can throw in locked-down
 * embeds (Safari private mode used to, some iframes do) and is unavailable
 * during SSR. Callers treat `null` as "persistence disabled", never as an
 * error.
 */
export function getProviderModelPickerStorage(): ProviderModelPickerStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when a `storage` event key belongs to the picker's persistence. */
export function isProviderModelPickerStorageKey(key: string | null): boolean {
  return (
    key === PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY ||
    key === PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY
  );
}

/**
 * Read the persisted selection. Returns `null` unless both keys hold
 * non-empty strings, so a half-written pair (crash between the two
 * `setItem` calls, or a legacy stray key) is treated as "nothing saved" and
 * the picker's default behavior is left untouched.
 */
export function readPersistedProviderModelSelection(
  storage: ProviderModelPickerStorage,
): PersistedProviderModelSelection | null {
  const provider = storage.getItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY);
  const model = storage.getItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY);
  if (typeof provider !== "string" || provider.length === 0) {
    return null;
  }
  if (typeof model !== "string" || model.length === 0) {
    return null;
  }
  return { provider, model };
}

export function writePersistedProviderModelSelection(
  storage: ProviderModelPickerStorage,
  provider: string,
  model: string,
): void {
  try {
    storage.setItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY, provider);
    storage.setItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY, model);
  } catch {
    // Quota exhaustion / locked-down storage must never break the pick
    // itself — persistence is best-effort by design.
  }
}

/** Clear both persisted keys; the picker returns to its default selection. */
export function clearPersistedProviderModelSelection(
  storage: ProviderModelPickerStorage,
): void {
  try {
    storage.removeItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY);
    storage.removeItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY);
  } catch {
    // See writePersistedProviderModelSelection: best-effort only.
  }
}

/** What a `storage` event observer can conclude about the persisted pair. */
export type ProviderModelPickerStorageChange =
  | { readonly kind: "selection"; readonly persisted: PersistedProviderModelSelection }
  | { readonly kind: "cleared" };

/**
 * Interpret the current key state after a `storage` event fired for one of
 * the picker's keys. Both keys present → a selection to apply; both absent
 * → another tab reset to default; exactly one present → the transient
 * half-state between the two `setItem`/`removeItem` calls, which the second
 * event resolves — ignore it. Note that "both present" can also be a
 * transient mixed pair (new provider + still-old model) between the two
 * `setItem` calls of a selection write; it self-corrects when the second
 * event lands, so callers apply it as-is rather than waiting.
 */
export function readProviderModelPickerStorageChange(
  storage: ProviderModelPickerStorage,
): ProviderModelPickerStorageChange | null {
  const provider = storage.getItem(PROVIDER_MODEL_PICKER_PROVIDER_STORAGE_KEY);
  const model = storage.getItem(PROVIDER_MODEL_PICKER_MODEL_STORAGE_KEY);
  if (provider === null && model === null) {
    return { kind: "cleared" };
  }
  if (
    typeof provider === "string" &&
    provider.length > 0 &&
    typeof model === "string" &&
    model.length > 0
  ) {
    return { kind: "selection", persisted: { provider, model } };
  }
  return null;
}

/**
 * Whether an instance entry can be selected right now: it must be enabled,
 * ready and available (mirrors the sidebar's disabled-row rules and the
 * composer's routing guard), and it must satisfy the picker's lock when one
 * is active.
 */
export function isSelectableProviderModelEntry(
  entry: ProviderInstanceEntry,
  options: {
    lockedProvider: ProviderDriverKind | null;
    lockedContinuationGroupKey?: string | null | undefined;
  },
): boolean {
  if (!entry.enabled || entry.status !== "ready" || !entry.isAvailable) {
    return false;
  }
  if (options.lockedProvider !== null) {
    if (entry.driverKind !== options.lockedProvider) {
      return false;
    }
    if (
      options.lockedContinuationGroupKey &&
      entry.continuationGroupKey !== options.lockedContinuationGroupKey
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Turn a persisted selection (or `null`, for "reset to default") into a
 * concrete pickable `{instanceId, model}`:
 *
 * - persisted provider still selectable → keep it; the persisted model is
 *   resolved through `resolveSelectableModel` (slug/name matching) and
 *   falls back to that instance's first option when the slug went stale;
 * - persisted provider gone/disabled (or `persisted` is `null`) → the first
 *   selectable instance with at least one model option, and its first
 *   option;
 * - nothing selectable at all → `null` (caller leaves props untouched).
 */
export function resolveRestoredProviderModelSelection(input: {
  persisted: PersistedProviderModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<{ slug: string; name: string }>>;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null | undefined;
}): ResolvedProviderModelSelection | null {
  const selectableEntries = input.instanceEntries.filter((entry) =>
    isSelectableProviderModelEntry(entry, {
      lockedProvider: input.lockedProvider,
      lockedContinuationGroupKey: input.lockedContinuationGroupKey,
    }),
  );

  if (input.persisted) {
    const entry = selectableEntries.find(
      (candidate) => candidate.instanceId === input.persisted!.provider,
    );
    const options = entry ? (input.modelOptionsByInstance.get(entry.instanceId) ?? []) : [];
    if (entry && options.length > 0) {
      const model =
        resolveSelectableModel(entry.driverKind, input.persisted.model, options) ??
        options[0]!.slug;
      return { instanceId: entry.instanceId, model };
    }
  }

  for (const entry of selectableEntries) {
    const options = input.modelOptionsByInstance.get(entry.instanceId) ?? [];
    if (options.length > 0) {
      return { instanceId: entry.instanceId, model: options[0]!.slug };
    }
  }
  return null;
}
