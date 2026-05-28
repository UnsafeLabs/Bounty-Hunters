import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useNotificationStore,
  type Notification,
  type NotificationType,
} from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    // Reset the store before each test by clearing state
    useNotificationStore.setState({
      toasts: [],
      history: [],
    });
  });

  describe("addNotification", () => {
    it("adds a visible toast", () => {
      const id = useNotificationStore.getState().addNotification("Hello", "info");

      const state = useNotificationStore.getState();
      expect(state.toasts).toHaveLength(1);
      expect(state.toasts[0]!.id).toBe(id);
      expect(state.toasts[0]!.message).toBe("Hello");
      expect(state.toasts[0]!.type).toBe("info");
      expect(state.toasts[0]!.read).toBe(false);
      expect(state.toasts[0]!.duration).toBe(5_000);
    });

    it("defaults duration to 5000ms", () => {
      useNotificationStore.getState().addNotification("Test", "success");

      const toast = useNotificationStore.getState().toasts[0]!;
      expect(toast.duration).toBe(5_000);
    });

    it("accepts a custom duration", () => {
      useNotificationStore.getState().addNotification("Test", "error", 10_000);

      const toast = useNotificationStore.getState().toasts[0]!;
      expect(toast.duration).toBe(10_000);
    });

    it("sets a zero duration when auto-dismiss is disabled", () => {
      useNotificationStore.getState().addNotification("Sticky", "warning", 0);

      const toast = useNotificationStore.getState().toasts[0]!;
      expect(toast.duration).toBe(0);
    });

    it("generates a unique id per notification", () => {
      const id1 = useNotificationStore.getState().addNotification("First", "info");
      const id2 = useNotificationStore.getState().addNotification("Second", "info");

      expect(id1).not.toBe(id2);
    });

    it("creates a toast with an ISO-8601 timestamp", () => {
      useNotificationStore.getState().addNotification("Timestamped", "info");

      const toast = useNotificationStore.getState().toasts[0]!;
      expect(() => new Date(toast.createdAt)).not.toThrow();
      expect(new Date(toast.createdAt).toISOString()).toBe(toast.createdAt);
    });

    it("supports all four notification types", () => {
      const types: NotificationType[] = ["info", "success", "warning", "error"];

      for (const type of types) {
        useNotificationStore.getState().addNotification(`Type: ${type}`, type);
      }

      const { toasts } = useNotificationStore.getState();
      expect(toasts).toHaveLength(4);
      expect(toasts.map((t) => t.type).sort()).toEqual([...types].sort());
    });
  });

  describe("dismissNotification", () => {
    it("removes the toast from visible toasts", () => {
      const id = useNotificationStore.getState().addNotification("Dismiss me", "info");

      useNotificationStore.getState().dismissNotification(id);

      const state = useNotificationStore.getState();
      expect(state.toasts).toHaveLength(0);
    });

    it("moves the dismissed toast to history", () => {
      const id = useNotificationStore.getState().addNotification("To history", "success");

      useNotificationStore.getState().dismissNotification(id);

      const { history } = useNotificationStore.getState();
      expect(history).toHaveLength(1);
      expect(history[0]!.id).toBe(id);
      expect(history[0]!.message).toBe("To history");
      expect(history[0]!.type).toBe("success");
    });

    it("preserves the read state when moving to history", () => {
      const id = useNotificationStore.getState().addNotification("Unread", "warning");

      const { history: histBefore } = useNotificationStore.getState();
      expect(histBefore).toHaveLength(0);

      useNotificationStore.getState().dismissNotification(id);

      const { history } = useNotificationStore.getState();
      expect(history[0]!.read).toBe(false);
    });

    it("is a no-op for a non-existent id", () => {
      const stateBefore = useNotificationStore.getState();

      useNotificationStore.getState().dismissNotification("non-existent");

      const stateAfter = useNotificationStore.getState();
      expect(stateAfter.toasts).toEqual(stateBefore.toasts);
      expect(stateAfter.history).toEqual(stateBefore.history);
    });

    it("caps history at 50 entries, keeping the most recent", () => {
      // Add 55 notifications and dismiss them all
      const ids: string[] = [];
      for (let i = 0; i < 55; i++) {
        const id = useNotificationStore.getState().addNotification(`Item ${i}`, "info");
        ids.push(id);
      }

      for (const id of ids) {
        useNotificationStore.getState().dismissNotification(id);
      }

      const { history } = useNotificationStore.getState();
      expect(history).toHaveLength(50);
      // The most recent items should be preserved
      expect(history[0]!.message).toBe("Item 54");
      expect(history[49]!.message).toBe("Item 5");
    });
  });

  describe("clearHistory", () => {
    it("empties the history array", () => {
      const id1 = useNotificationStore.getState().addNotification("A", "info");
      const id2 = useNotificationStore.getState().addNotification("B", "error");
      useNotificationStore.getState().dismissNotification(id1);
      useNotificationStore.getState().dismissNotification(id2);

      expect(useNotificationStore.getState().history).toHaveLength(2);

      useNotificationStore.getState().clearHistory();

      expect(useNotificationStore.getState().history).toHaveLength(0);
    });

    it("does not affect current toasts", () => {
      useNotificationStore.getState().addNotification("Active", "info");

      useNotificationStore.getState().clearHistory();

      expect(useNotificationStore.getState().toasts).toHaveLength(1);
    });
  });

  describe("markAsRead", () => {
    it("marks a visible toast as read", () => {
      const id = useNotificationStore.getState().addNotification("Mark me", "info");

      useNotificationStore.getState().markAsRead(id);

      const toast = useNotificationStore.getState().toasts[0]!;
      expect(toast.read).toBe(true);
    });

    it("marks a history notification as read", () => {
      const id = useNotificationStore.getState().addNotification("In history", "warning");
      useNotificationStore.getState().dismissNotification(id);

      useNotificationStore.getState().markAsRead(id);

      const notification = useNotificationStore.getState().history[0]!;
      expect(notification.read).toBe(true);
    });

    it("is a no-op for a non-existent id", () => {
      const stateBefore = useNotificationStore.getState();

      useNotificationStore.getState().markAsRead("non-existent");

      const stateAfter = useNotificationStore.getState();
      expect(stateAfter).toBe(stateBefore);
    });

    it("is idempotent — marking an already-read notification does not change state", () => {
      const id = useNotificationStore.getState().addNotification("Read already", "info");

      useNotificationStore.getState().markAsRead(id);
      const stateAfterFirst = useNotificationStore.getState();
      expect(stateAfterFirst.toasts[0]!.read).toBe(true);

      useNotificationStore.getState().markAsRead(id);
      const stateAfterSecond = useNotificationStore.getState();
      expect(stateAfterSecond.toasts[0]!.read).toBe(true);
    });
  });

  describe("auto-dismiss timer", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("auto-dismisses a toast after the default duration", () => {
      const id = useNotificationStore.getState().addNotification("Auto", "info");

      expect(useNotificationStore.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(5_000);

      // After 5s the timeout fires and dismisses the notification
      expect(useNotificationStore.getState().toasts).toHaveLength(0);
      expect(useNotificationStore.getState().history).toHaveLength(1);
      expect(useNotificationStore.getState().history[0]!.id).toBe(id);
    });

    it("auto-dismisses after a custom duration", () => {
      useNotificationStore.getState().addNotification("Custom", "error", 2_000);

      vi.advanceTimersByTime(1_999);
      expect(useNotificationStore.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(useNotificationStore.getState().toasts).toHaveLength(0);
    });

    it("does not auto-dismiss when duration is 0", () => {
      useNotificationStore.getState().addNotification("Sticky", "warning", 0);

      vi.advanceTimersByTime(60_000);

      expect(useNotificationStore.getState().toasts).toHaveLength(1);
    });

    it("each notification has its own independent timer", () => {
      const id1 = useNotificationStore.getState().addNotification("Short", "info", 1_000);
      useNotificationStore.getState().addNotification("Long", "info", 10_000);

      vi.advanceTimersByTime(1_000);

      // Only the short one should be dismissed
      expect(useNotificationStore.getState().toasts).toHaveLength(1);
      expect(useNotificationStore.getState().toasts[0]!.id).not.toBe(id1);
    });
  });
});
