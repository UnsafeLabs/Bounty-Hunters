// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  PROVIDER_MODEL_PICKER_STORAGE_KEY,
  readPersistedSelection,
  writePersistedSelection,
  clearPersistedSelection,
  isSelectionValid,
  resolveDefaultSelection,
  resolveEffectiveSelection,
  type KeyValueStorage,
  type SelectionResolverDeps,
} from "./providerModelPickerStorage";

class FakeStorage implements KeyValueStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const deps = {
  instanceEntries: [
    { instanceId: "codex", driverKind: "openai", displayName: "Codex", accentColor: null },
    { instanceId: "claude", driverKind: "anthropic", displayName: "Claude", accentColor: "#abc" },
  ],
  modelOptionsByInstance: new Map<string, ReadonlyArray<{ slug: string }>>([
    ["codex", [{ slug: "gpt-4o" }, { slug: "gpt-4o-mini" }]],
    ["claude", [{ slug: "claude-3-5-sonnet" }]],
  ]),
} as unknown as SelectionResolverDeps;

describe("providerModelPickerStorage", () => {
  it("returns null when storage is empty", () => {
    const s = new FakeStorage();
    expect(readPersistedSelection(s)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const s = new FakeStorage();
    s.setItem(PROVIDER_MODEL_PICKER_STORAGE_KEY, "{not json");
    expect(readPersistedSelection(s)).toBeNull();
  });

  it("returns null for wrong shape (missing model)", () => {
    const s = new FakeStorage();
    s.setItem(
      PROVIDER_MODEL_PICKER_STORAGE_KEY,
      JSON.stringify({ instanceId: "codex" }),
    );
    expect(readPersistedSelection(s)).toBeNull();
  });

  it("returns null for empty-string fields", () => {
    const s = new FakeStorage();
    s.setItem(
      PROVIDER_MODEL_PICKER_STORAGE_KEY,
      JSON.stringify({ instanceId: "", model: "gpt-4o" }),
    );
    expect(readPersistedSelection(s)).toBeNull();
  });

  it("parses a valid selection", () => {
    const s = new FakeStorage();
    s.setItem(
      PROVIDER_MODEL_PICKER_STORAGE_KEY,
      JSON.stringify({ instanceId: "codex", model: "gpt-4o" }),
    );
    expect(readPersistedSelection(s)).toEqual({ instanceId: "codex", model: "gpt-4o" });
  });

  it("round-trips write / read / clear", () => {
    const s = new FakeStorage();
    writePersistedSelection(s, { instanceId: "claude", model: "claude-3-5-sonnet" });
    expect(readPersistedSelection(s)).toEqual({
      instanceId: "claude",
      model: "claude-3-5-sonnet",
    });
    clearPersistedSelection(s);
    expect(readPersistedSelection(s)).toBeNull();
  });

  it("isSelectionValid: true for an existing instance + model", () => {
    expect(isSelectionValid({ instanceId: "codex", model: "gpt-4o" }, deps)).toBe(true);
  });

  it("isSelectionValid: false when instance is missing", () => {
    expect(isSelectionValid({ instanceId: "nope", model: "gpt-4o" }, deps)).toBe(false);
  });

  it("isSelectionValid: false when model is missing for that instance", () => {
    expect(isSelectionValid({ instanceId: "codex", model: "does-not-exist" }, deps)).toBe(false);
  });

  it("isSelectionValid: false for null", () => {
    expect(isSelectionValid(null, deps)).toBe(false);
  });

  it("resolveDefaultSelection returns the first instance's first model", () => {
    expect(resolveDefaultSelection(deps)).toEqual({
      instanceId: "codex",
      model: "gpt-4o",
    });
  });

  it("resolveDefaultSelection returns null when there are no entries", () => {
    const empty = {
      instanceEntries: [],
      modelOptionsByInstance: new Map(),
    } as unknown as SelectionResolverDeps;
    expect(resolveDefaultSelection(empty)).toBeNull();
  });

  it("resolveEffectiveSelection prefers a valid persisted selection", () => {
    expect(
      resolveEffectiveSelection(
        { instanceId: "claude", model: "claude-3-5-sonnet" },
        deps,
      ),
    ).toEqual({ instanceId: "claude", model: "claude-3-5-sonnet" });
  });

  it("resolveEffectiveSelection falls back to default when invalid", () => {
    expect(resolveEffectiveSelection({ instanceId: "ghost", model: "x" }, deps)).toEqual({
      instanceId: "codex",
      model: "gpt-4o",
    });
  });

  it("readPersistedSelection tolerates getItem throwing (private mode)", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readPersistedSelection(throwing)).toBeNull();
  });

  it("writePersistedSelection tolerates setItem throwing (quota)", () => {
    const throwing: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(() =>
      writePersistedSelection(throwing, { instanceId: "codex", model: "gpt-4o" }),
    ).not.toThrow();
  });
});
