/**
 * Auto-update progress, defer, and skip-version (issue #842).
 */

export interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface UpdatePrefsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export const DEFER_MS = 24 * 60 * 60 * 1000;

export function computeProgress(bytesDownloaded: number, totalBytes: number): DownloadProgress {
  const total = Math.max(0, totalBytes);
  const bytes = Math.max(0, bytesDownloaded);
  const percent = total > 0 ? Math.min(100, Math.round((bytes / total) * 1000) / 10) : 0;
  return { percent, bytesDownloaded: bytes, totalBytes: total };
}

export function deferUpdate(store: UpdatePrefsStore, now = Date.now()): number {
  const until = now + DEFER_MS;
  store.set("update.remindLaterUntil", until);
  return until;
}

export function isDeferred(store: UpdatePrefsStore, now = Date.now()): boolean {
  const until = Number(store.get("update.remindLaterUntil") ?? 0);
  return until > now;
}

export function skipVersion(store: UpdatePrefsStore, version: string): void {
  const skipped = new Set<string>(
    Array.isArray(store.get("update.skippedVersions"))
      ? (store.get("update.skippedVersions") as string[])
      : [],
  );
  skipped.add(version);
  store.set("update.skippedVersions", [...skipped]);
}

export function isVersionSkipped(store: UpdatePrefsStore, version: string): boolean {
  const skipped = store.get("update.skippedVersions");
  return Array.isArray(skipped) && skipped.includes(version);
}

export function shouldShowUpdateNotification(
  store: UpdatePrefsStore,
  version: string,
  now = Date.now(),
): boolean {
  if (isVersionSkipped(store, version)) return false;
  if (isDeferred(store, now)) return false;
  return true;
}

export interface UpdateManifest {
  version: string;
  releaseNotes: string;
}

export function formatUpdateDialog(manifest: UpdateManifest, progress?: DownloadProgress): {
  version: string;
  releaseNotes: string;
  progressPercent: number | null;
} {
  return {
    version: manifest.version,
    releaseNotes: manifest.releaseNotes,
    progressPercent: progress ? progress.percent : null,
  };
}
