import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderInstanceId } from "@t3tools/contracts";

const STORAGE_KEY_PROVIDER = "t3:picker:providerId";
const STORAGE_KEY_MODEL = "t3:picker:model";

export interface PersistedSelection {
  providerId: ProviderInstanceId | null;
  model: string | null;
}

function readPersisted(): PersistedSelection {
  try {
    const providerId = localStorage.getItem(STORAGE_KEY_PROVIDER);
    const model = localStorage.getItem(STORAGE_KEY_MODEL);
    return {
      providerId: providerId ?? null,
      model: model ?? null,
    };
  } catch {
    return { providerId: null, model: null };
  }
}

function writePersisted(providerId: ProviderInstanceId | null, model: string | null) {
  try {
    if (providerId !== null) {
      localStorage.setItem(STORAGE_KEY_PROVIDER, providerId);
    } else {
      localStorage.removeItem(STORAGE_KEY_PROVIDER);
    }
    if (model !== null) {
      localStorage.setItem(STORAGE_KEY_MODEL, model);
    } else {
      localStorage.removeItem(STORAGE_KEY_MODEL);
    }
  } catch {
    // localStorage unavailable (SSR, privacy mode, quota)
  }
}

export interface UseProviderModelPersistenceOptions {
  /** Called to apply a restored selection. */
  onRestore: (providerId: ProviderInstanceId, model: string) => void;
  /** All available instance IDs — used to validate persisted values. */
  availableInstanceIds: ReadonlyArray<ProviderInstanceId>;
  /** Models keyed by instance ID — used to validate persisted model. */
  modelsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<{ slug: string }>>;
}

export function useProviderModelPersistence({
  onRestore,
  availableInstanceIds,
  modelsByInstance,
}: UseProviderModelPersistenceOptions) {
  const restoredRef = useRef(false);
  const [externalUpdate, setExternalUpdate] = useState(0);

  // Restore persisted selection once on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const stored = readPersisted();
    if (!stored.providerId || !stored.model) return;

    // Validate provider is still available
    const isValidProvider = availableInstanceIds.includes(stored.providerId);
    if (!isValidProvider) return;

    // Validate model is available for the provider
    const models = modelsByInstance.get(stored.providerId) ?? [];
    const isValidModel = models.some((m) => m.slug === stored.model);
    if (!isValidModel) return;

    onRestore(stored.providerId, stored.model);
  }, [availableInstanceIds, modelsByInstance, onRestore]);

  // Cross-tab sync via storage event
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY_PROVIDER && e.key !== STORAGE_KEY_MODEL) return;
      setExternalUpdate((n) => n + 1);

      const stored = readPersisted();
      if (!stored.providerId || !stored.model) return;

      const isValidProvider = availableInstanceIds.includes(stored.providerId);
      if (!isValidProvider) return;

      const models = modelsByInstance.get(stored.providerId) ?? [];
      const isValidModel = models.some((m) => m.slug === stored.model);
      if (!isValidModel) return;

      onRestore(stored.providerId, stored.model);
    };

    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [availableInstanceIds, modelsByInstance, onRestore]);

  /** Persist the current selection to localStorage. */
  const persist = useCallback(
    (providerId: ProviderInstanceId, model: string) => {
      writePersisted(providerId, model);
    },
    [],
  );

  /** Clear persisted preference and invoke the callback with a fallback. */
  const reset = useCallback(
    (fallbackInstanceId: ProviderInstanceId, fallbackModel: string) => {
      writePersisted(null, null);
      onRestore(fallbackInstanceId, fallbackModel);
    },
    [onRestore],
  );

  return { persist, reset, externalUpdate };
}
