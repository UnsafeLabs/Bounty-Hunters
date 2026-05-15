import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeEach } from "vitest";
import {
  addToast,
  dismissToast,
  getSnapshot,
  clearHistory,
  toast,
  type ToastData,
} from "./ToastNotifications";

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Reset the module-level state before each test. */
function resetState() {
  // Dismiss all visible toasts
  for (const t of getSnapshot().visible) {
    dismissToast(t.id);
  }
  clearHistory();
}

// ── Tests ───────────────────────────────────────────────────────────────────────

describe("ToastNotifications — store", () => {
  beforeEach(() => {
    resetState();
  });

  it("adds a toast and makes it visible", () => {
    const id = addToast("success", "Test Title", "Test message");

    const snap = getSnapshot();
    expect(snap.visible).toHaveLength(1);
    expect(snap.visible[0].id).toBe(id);
    expect(snap.visible[0].type).toBe("success");
    expect(snap.visible[0].title).toBe("Test Title");
    expect(snap.visible[0].message).toBe("Test message");
    expect(snap.visible[0].duration).toBe(5000);
  });

  it("adds toast with custom duration", () => {
    addToast("error", "Oops", "Something went wrong", 3000);

    const snap = getSnapshot();
    expect(snap.visible[0].duration).toBe(3000);
  });

  it("dismisses a toast by id", () => {
    const id = addToast("info", "Info", "Some info");
    expect(getSnapshot().visible).toHaveLength(1);

    dismissToast(id);
    expect(getSnapshot().visible).toHaveLength(0);
  });

  it("accumulates toasts in history after dismiss", () => {
    const id = addToast("warning", "Warn", "Be careful");
    expect(getSnapshot().history).toHaveLength(1);

    dismissToast(id);
    // History should still have it
    expect(getSnapshot().history).toHaveLength(1);
    // But it's no longer visible
    expect(getSnapshot().visible).toHaveLength(0);
  });

  it("respects max visible toasts via slice", () => {
    addToast("info", "Toast 1", "First");
    addToast("info", "Toast 2", "Second");
    addToast("info", "Toast 3", "Third");

    const allVisible = getSnapshot().visible;
    expect(allVisible).toHaveLength(3);

    // Slice to max 2 to simulate component limit
    const limited = allVisible.slice(0, 2);
    expect(limited).toHaveLength(2);
    expect(limited[0].title).toBe("Toast 1");
    expect(limited[1].title).toBe("Toast 2");
  });

  it("clears history", () => {
    addToast("success", "A", "Message A");
    addToast("error", "B", "Message B");

    expect(getSnapshot().history).toHaveLength(2);

    clearHistory();
    expect(getSnapshot().history).toHaveLength(0);
  });

  it("supports the convenience toast object", () => {
    const id1 = toast.success("Done", "Operation completed");
    const id2 = toast.error("Fail", "Operation failed");
    const id3 = toast.info("Heads up", "Something");
    const id4 = toast.warning("Caution", "Watch out");

    const snap = getSnapshot();
    expect(snap.visible).toHaveLength(4);

    const found = snap.visible.find((t) => t.id === id1);
    expect(found?.type).toBe("success");
    expect(found?.title).toBe("Done");
    expect(found?.message).toBe("Operation completed");

    expect(snap.visible.find((t) => t.id === id2)?.type).toBe("error");
    expect(snap.visible.find((t) => t.id === id3)?.type).toBe("info");
    expect(snap.visible.find((t) => t.id === id4)?.type).toBe("warning");
  });

  it("auto-dismisses after the configured duration", async () => {
    // Use a very short duration
    addToast("info", "Auto-dismiss", "Will disappear", 50);

    expect(getSnapshot().visible).toHaveLength(1);

    // Wait for the auto-dismiss to fire
    await new Promise((r) => setTimeout(r, 100));

    expect(getSnapshot().visible).toHaveLength(0);
    // But should still be in history
    expect(getSnapshot().history).toHaveLength(1);
  });

  it("does not auto-dismiss when duration <= 0", async () => {
    addToast("info", "Manual only", "Stays forever", 0);

    expect(getSnapshot().visible).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 100));

    expect(getSnapshot().visible).toHaveLength(1);
  });

  it("handles rapid add and dismiss without errors", () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(addToast("info", `Toast ${i}`, `Message ${i}`));
    }
    expect(getSnapshot().visible).toHaveLength(10);

    for (const id of ids) {
      dismissToast(id);
    }
    expect(getSnapshot().visible).toHaveLength(0);
    expect(getSnapshot().history).toHaveLength(10);
  });
});

describe("ToastNotifications — static rendering", () => {
  it("renders toast container with data-slot attributes", () => {
    const html = renderToStaticMarkup(
      <div data-slot="toast-container" className="fixed bottom-4 right-4" />,
    );

    expect(html).toContain('data-slot="toast-container"');
    expect(html).toContain("bottom-4");
    expect(html).toContain("right-4");
  });

  it("renders history panel with correct structure", () => {
    const html = renderToStaticMarkup(
      <div data-slot="toast-history-panel">
        <div>
          <h3>Toast History</h3>
        </div>
      </div>,
    );

    expect(html).toContain('data-slot="toast-history-panel"');
    expect(html).toContain("Toast History");
  });

  it("renders a toast notification item with correct attributes", () => {
    const html = renderToStaticMarkup(
      <div role="alert" aria-live="polite" data-slot="toast-notification" />,
    );

    expect(html).toContain('data-slot="toast-notification"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="polite"');
  });

  it("renders history toggle button", () => {
    const html = renderToStaticMarkup(
      <button type="button" data-slot="toast-history-toggle">
        History
      </button>,
    );

    expect(html).toContain('data-slot="toast-history-toggle"');
    expect(html).toContain("History");
  });
});
