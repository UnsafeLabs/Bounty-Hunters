import {
  clearSelection,
  loadSelection,
  resolveSelection,
  saveSelection,
} from "./ProviderModelPersistence.ts";
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const mem = new Map<string, string>();
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const available = [
  { providerId: "openai", modelIds: ["gpt-4", "gpt-4o"] },
  { providerId: "anthropic", modelIds: ["claude"] },
];
assert(resolveSelection(available, null)?.providerId === "openai", "default first");
saveSelection(storage, { providerId: "anthropic", modelId: "claude" });
assert(loadSelection(storage)?.modelId === "claude", "load");
assert(
  resolveSelection(available, loadSelection(storage))?.providerId === "anthropic",
  "restore",
);
// invalid provider falls back
assert(
  resolveSelection(available, { providerId: "gone", modelId: "x" })?.providerId === "openai",
  "fallback",
);
clearSelection(storage);
assert(loadSelection(storage) === null, "reset");
console.log("ProviderModelPersistence tests: all passed");
