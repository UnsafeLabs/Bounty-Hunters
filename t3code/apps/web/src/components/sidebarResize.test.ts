import { beforeEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  clearStoredSidebarWidth,
  readStoredSidebarWidth,
  writeStoredSidebarWidth,
} from "./sidebarResize";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

describe("clampSidebarWidth", () => {
  it("clamps below the minimum to the minimum", () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH);
  });
  it("clamps above the maximum to the maximum", () => {
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_MAX_WIDTH);
  });
  it("keeps values within range unchanged", () => {
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(350)).toBe(350);
  });
  it("rounds fractional widths", () => {
    expect(clampSidebarWidth(280.6)).toBe(281);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("sidebar width persistence", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = new MemoryStorage() as unknown as Storage;
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredSidebarWidth(storage)).toBeNull();
  });

  it("round-trips a stored width", () => {
    writeStoredSidebarWidth(storage, 320);
    expect(readStoredSidebarWidth(storage)).toBe(320);
  });

  it("clamps out-of-range stored widths on read", () => {
    writeStoredSidebarWidth(storage, 9999);
    expect(readStoredSidebarWidth(storage)).toBe(SIDEBAR_MAX_WIDTH);
    writeStoredSidebarWidth(storage, -5);
    expect(readStoredSidebarWidth(storage)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("ignores non-numeric stored values", () => {
    storage.setItem("t3code:sidebar-width:v1", "not-a-number");
    expect(readStoredSidebarWidth(storage)).toBeNull();
  });

  it("clears the stored width", () => {
    writeStoredSidebarWidth(storage, 300);
    clearStoredSidebarWidth(storage);
    expect(readStoredSidebarWidth(storage)).toBeNull();
  });
});
