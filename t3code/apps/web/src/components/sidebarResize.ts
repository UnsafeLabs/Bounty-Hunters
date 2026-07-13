export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 500;
export const SIDEBAR_DEFAULT_WIDTH = 280;
export const SIDEBAR_WIDTH_STORAGE_KEY = "t3code:sidebar-width:v1";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }
  const rounded = Math.round(width);
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, rounded));
}

export function readStoredSidebarWidth(
  storage: Storage | null | undefined,
): number | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return clampSidebarWidth(parsed);
  } catch {
    return null;
  }
}

export function writeStoredSidebarWidth(
  storage: Storage | null | undefined,
  width: number,
): void {
  try {
    storage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  } catch {
    // Ignore write failures (private mode, quota, etc.)
  }
}

export function clearStoredSidebarWidth(storage: Storage | null | undefined): void {
  try {
    storage?.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
  } catch {
    // Ignore removal failures.
  }
}
