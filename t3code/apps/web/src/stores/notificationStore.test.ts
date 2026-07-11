import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNotificationStore } from "./notificationStore.ts";

describe("notificationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.setState({
      active: [],
      history: [],
      historyOpen: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("addNotification appends active + history", () => {
    const id = useNotificationStore.getState().addNotification({
      type: "success",
      title: "Push complete",
      message: "origin/main",
    });
    const state = useNotificationStore.getState();
    expect(id).toMatch(/^notif-/);
    expect(state.active).toHaveLength(1);
    expect(state.active[0]?.type).toBe("success");
    expect(state.history).toHaveLength(1);
    expect(state.history[0]?.title).toBe("Push complete");
  });

  it("auto-dismisses after default 5s", () => {
    useNotificationStore.getState().addNotification({
      type: "info",
      title: "hello",
    });
    expect(useNotificationStore.getState().active).toHaveLength(1);
    vi.advanceTimersByTime(4999);
    expect(useNotificationStore.getState().active).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(useNotificationStore.getState().active).toHaveLength(0);
    // history retained
    expect(useNotificationStore.getState().history).toHaveLength(1);
  });

  it("click dismiss removes only active toast", () => {
    const id = useNotificationStore.getState().addNotification({
      type: "error",
      title: "fail",
      durationMs: 0,
    });
    useNotificationStore.getState().dismissNotification(id);
    expect(useNotificationStore.getState().active).toHaveLength(0);
    expect(useNotificationStore.getState().history).toHaveLength(1);
  });

  it("keeps only last 50 history entries", () => {
    for (let i = 0; i < 55; i += 1) {
      useNotificationStore.getState().addNotification({
        type: "info",
        title: `n-${i}`,
        durationMs: 0,
      });
    }
    const history = useNotificationStore.getState().history;
    expect(history).toHaveLength(50);
    expect(history[0]?.title).toBe("n-54");
    expect(history[49]?.title).toBe("n-5");
  });

  it("clearHistory empties history", () => {
    useNotificationStore.getState().addNotification({
      type: "warning",
      title: "w",
      durationMs: 0,
    });
    useNotificationStore.getState().clearHistory();
    expect(useNotificationStore.getState().history).toHaveLength(0);
  });

  it("exposes addNotification and clearHistory methods", () => {
    const store = useNotificationStore.getState();
    expect(typeof store.addNotification).toBe("function");
    expect(typeof store.clearHistory).toBe("function");
  });
});
