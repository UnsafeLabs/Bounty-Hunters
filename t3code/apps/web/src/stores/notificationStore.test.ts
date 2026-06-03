import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "./notificationStore";

describe("useNotificationStore", () => {
  beforeEach(() => {
    act(() => {
      useNotificationStore.setState({
        notifications: [],
        history: [],
      });
    });
  });

  it("should add a notification and record it in history", () => {
    act(() => {
      useNotificationStore.getState().addNotification({
        type: "success",
        title: "Test Title",
        description: "Test Description",
      });
    });

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.history).toHaveLength(1);

    const n = state.notifications[0]!;
    expect(n.id).toBeDefined();
    expect(n.timestamp).toBeDefined();
    expect(n.type).toBe("success");
    expect(n.title).toBe("Test Title");
    expect(n.description).toBe("Test Description");
  });

  it("should support configurable duration", () => {
    act(() => {
      useNotificationStore.getState().addNotification({
        type: "info",
        title: "Duration test",
        duration: 3000,
      });
    });

    const state = useNotificationStore.getState();
    expect(state.notifications[0]!.duration).toBe(3000);
  });

  it("should remove notification from active list", () => {
    act(() => {
      useNotificationStore.getState().addNotification({
        type: "warning",
        title: "Alert",
      });
    });

    let state = useNotificationStore.getState();
    const id = state.notifications[0]!.id;

    act(() => {
      state.removeNotification(id);
    });

    state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.history).toHaveLength(1); // Should persist in history
  });

  it("should clear notification history", () => {
    act(() => {
      useNotificationStore.getState().addNotification({
        type: "error",
        title: "Error occurred",
      });
    });

    let state = useNotificationStore.getState();
    expect(state.history).toHaveLength(1);

    act(() => {
      state.clearHistory();
    });

    state = useNotificationStore.getState();
    expect(state.history).toHaveLength(0);
    expect(state.notifications).toHaveLength(1); // Active notifications should remain untouched
  });

  it("should cap history at 50 notifications", () => {
    // Add 55 notifications
    act(() => {
      const store = useNotificationStore.getState();
      for (let i = 1; i <= 55; i++) {
        store.addNotification({
          type: "info",
          title: `Notification ${i}`,
        });
      }
    });

    const state = useNotificationStore.getState();
    expect(state.history).toHaveLength(50);
    expect(state.history[0]!.title).toBe("Notification 55"); // Newest first
    expect(state.history[49]!.title).toBe("Notification 6"); // Oldest in history should be 6
  });
});
