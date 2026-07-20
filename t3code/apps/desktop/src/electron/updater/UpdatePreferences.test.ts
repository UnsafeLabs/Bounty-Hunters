import {
  computeProgress,
  deferUpdate,
  formatUpdateDialog,
  isDeferred,
  isVersionSkipped,
  shouldShowUpdateNotification,
  skipVersion,
  DEFER_MS,
} from "./UpdatePreferences.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const mem = new Map<string, unknown>();
const store = {
  get: (k: string) => mem.get(k),
  set: (k: string, v: unknown) => void mem.set(k, v),
};

assert(computeProgress(50, 200).percent === 25, "pct");
assert(computeProgress(0, 0).percent === 0, "zero");

const now = 1_000_000;
const until = deferUpdate(store, now);
assert(until === now + DEFER_MS, "defer");
assert(isDeferred(store, now + 1000) === true, "still deferred");
assert(isDeferred(store, now + DEFER_MS + 1) === false, "expired");

skipVersion(store, "1.2.3");
assert(isVersionSkipped(store, "1.2.3") === true, "skipped");
assert(shouldShowUpdateNotification(store, "1.2.3", now + DEFER_MS + 10) === false, "hide skipped");
assert(shouldShowUpdateNotification(store, "1.2.4", now + DEFER_MS + 10) === true, "other version");

const dlg = formatUpdateDialog({ version: "2.0.0", releaseNotes: "fixes" }, computeProgress(10, 100));
assert(dlg.releaseNotes === "fixes" && dlg.progressPercent === 10, "dialog");

console.log("UpdatePreferences tests: all passed");
