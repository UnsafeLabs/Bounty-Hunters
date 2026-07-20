/**
 * Persist ProviderModelPicker selection across reloads (issue 834).
 */

const NS = "t3code.providerModelPicker";
export const STORAGE_KEYS = {
  providerId: `${NS}.providerId`,
  modelId: `${NS}.modelId`,
} as const;

export interface Selection {
  providerId: string;
  modelId: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveSelection(storage: StorageLike, sel: Selection): void {
  storage.setItem(STORAGE_KEYS.providerId, sel.providerId);
  storage.setItem(STORAGE_KEYS.modelId, sel.modelId);
}

export function loadSelection(storage: StorageLike): Selection | null {
  const providerId = storage.getItem(STORAGE_KEYS.providerId);
  const modelId = storage.getItem(STORAGE_KEYS.modelId);
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

export function clearSelection(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEYS.providerId);
  storage.removeItem(STORAGE_KEYS.modelId);
}

export function resolveSelection(
  available: Array<{ providerId: string; modelIds: string[] }>,
  persisted: Selection | null,
): Selection | null {
  if (available.length === 0) return null;
  if (persisted) {
    const p = available.find((a) => a.providerId === persisted.providerId);
    if (p && p.modelIds.includes(persisted.modelId)) return persisted;
    if (p && p.modelIds[0]) return { providerId: p.providerId, modelId: p.modelIds[0] };
  }
  const first = available[0]!;
  return { providerId: first.providerId, modelId: first.modelIds[0] ?? "" };
}
