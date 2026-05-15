import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemTheme } from "./useSystemTheme";

type ChangeListener = (event: { matches: boolean }) => void;

interface MockMediaQueryList {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function createMatchMediaMock(initialMatches = false): MockMediaQueryList {
  const listeners = new Set<ChangeListener>();

  const mql: MockMediaQueryList = {
    matches: initialMatches,
    addEventListener: vi.fn((_event: string, listener: ChangeListener) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: ChangeListener) => {
      listeners.delete(listener);
    }),
  };

  // Store listeners for programmatic triggering
  (mql as unknown as Record<string, unknown>).__listeners = listeners;

  return mql;
}

describe("useSystemTheme", () => {
  let mql: MockMediaQueryList;

  beforeEach(() => {
    mql = createMatchMediaMock(false); // default: light mode
    vi.stubGlobal(
      "window",
      {
        matchMedia: vi.fn((query: string) => {
          if (query === "(prefers-color-scheme: dark)") {
            return mql;
          }
          return { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
        }),
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns light theme when system prefers light", () => {
    mql.matches = false;

    const { result } = renderHook(() => useSystemTheme());

    expect(result.current.theme).toBe("light");
    expect(result.current.isSystem).toBe(true);
  });

  it("returns dark theme when system prefers dark", () => {
    mql.matches = true;

    const { result } = renderHook(() => useSystemTheme());

    expect(result.current.theme).toBe("dark");
    expect(result.current.isSystem).toBe(true);
  });

  it("subscribes to matchMedia change events", () => {
    renderHook(() => useSystemTheme());

    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("updates theme in real-time when system preference changes", () => {
    mql.matches = false;

    const { result } = renderHook(() => useSystemTheme());

    expect(result.current.theme).toBe("light");

    // Simulate system preference change to dark
    act(() => {
      // Trigger the change listener
      const listeners = (mql as unknown as Record<string, Set<ChangeListener>>).__listeners;
      listeners.forEach((listener) => {
        listener({ matches: true });
      });
    });

    expect(result.current.theme).toBe("dark");
  });

  it("updates theme in real-time when system preference changes back to light", () => {
    mql.matches = true;

    const { result } = renderHook(() => useSystemTheme());

    expect(result.current.theme).toBe("dark");

    // Simulate system preference change to light
    act(() => {
      const listeners = (mql as unknown as Record<string, Set<ChangeListener>>).__listeners;
      listeners.forEach((listener) => {
        listener({ matches: false });
      });
    });

    expect(result.current.theme).toBe("light");
  });

  it("cleans up matchMedia listener on unmount", () => {
    const { unmount } = renderHook(() => useSystemTheme());

    unmount();

    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("handles server-side rendering gracefully", () => {
    // Temporarily remove window to simulate SSR
    const originalWindow = globalThis.window;
    // @ts-expect-error - intentionally removing window for SSR test
    delete globalThis.window;

    const { result } = renderHook(() => useSystemTheme());

    expect(result.current.theme).toBe("light");
    expect(result.current.isSystem).toBe(true);

    // Restore window
    globalThis.window = originalWindow as Window & typeof globalThis;
  });
});
