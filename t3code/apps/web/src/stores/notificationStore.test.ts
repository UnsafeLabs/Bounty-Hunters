import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "./notificationStore";
import { useNotificationStore } from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    // Clear the store before each test
    useNotificationStore.getState().clearHistory();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("addNotification", () => {
    it("adds a notification with correct fields", () => {
      const id = useNotificationStore
        .getState()
        .addNotification({ type: "success", title: "Test" });

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        type: "success",
        title: "Test",
        read: false,
      });
      expect(notifications[0].id).toBe(id);
    });

    it("adds a notification with a message", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "error", title: "Error", message: "Something went wrong" });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].message).toBe("Something went wrong");
    });

    it("returns the generated id", () => {
      const id = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Info" });

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("generates unique ids for each notification", () => {
      const id1 = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "First" });
      const id2 = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Second" });

      expect(id1).not.toBe(id2);
    });

    it("sets a timestamp on the notification", () => {
      const before = Date.now();
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Timed" });
      const after = Date.now();

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(notifications[0].timestamp).toBeLessThanOrEqual(after);
    });

    it("prepends new notifications to the array", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "First" });
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Second" });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].title).toBe("Second");
      expect(notifications[1].title).toBe("First");
    });

    it("auto-dismisses after the default duration", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Auto-dismiss" });

      expect(useNotificationStore.getState().notifications).toHaveLength(1);

      // Advance past the default 5000ms
      vi.advanceTimersByTime(5000);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("auto-dismisses after a custom duration", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Custom", duration: 1000 });

      expect(useNotificationStore.getState().notifications).toHaveLength(1);

      vi.advanceTimersByTime(1000);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("does not auto-dismiss when duration is 0", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Sticky", duration: 0 });

      vi.advanceTimersByTime(10_000);

      expect(useNotificationStore.getState().notifications).toHaveLength(1);
    });

    it("notifications default to read: false", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Unread" });

      const { notifications } = useNotificationStore.getState();
      expect(notifications[0].read).toBe(false);
    });
  });

  describe("dismissNotification", () => {
    it("removes a notification by id", () => {
      const id = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "To dismiss" });

      useNotificationStore.getState().dismissNotification(id);

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("removes only the specified notification", () => {
      const id1 = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Keep" });
      const id2 = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Remove" });

      useNotificationStore.getState().dismissNotification(id2);

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].id).toBe(id1);
    });

    it("is a no-op for an unknown id", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Only" });

      useNotificationStore.getState().dismissNotification("nonexistent");

      expect(useNotificationStore.getState().notifications).toHaveLength(1);
    });
  });

  describe("clearHistory", () => {
    it("empties the notifications array", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "One" });
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Two" });

      useNotificationStore.getState().clearHistory();

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    it("is a no-op on an already empty store", () => {
      useNotificationStore.getState().clearHistory();

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });
  });

  describe("markAsRead", () => {
    it("sets read to true for the specified notification", () => {
      const id = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Mark me" });

      useNotificationStore.getState().markAsRead(id);

      const notification = useNotificationStore
        .getState()
        .notifications.find((n: Notification) => n.id === id);
      expect(notification?.read).toBe(true);
    });

    it("does not affect other notifications", () => {
      const id1 = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "First" });
      const id2 = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Second" });

      useNotificationStore.getState().markAsRead(id2);

      const { notifications } = useNotificationStore.getState();
      expect(notifications.find((n: Notification) => n.id === id1)?.read).toBe(
        false,
      );
      expect(notifications.find((n: Notification) => n.id === id2)?.read).toBe(
        true,
      );
    });

    it("is idempotent (marking already-read is a no-op)", () => {
      const id = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Read me" });

      useNotificationStore.getState().markAsRead(id);
      useNotificationStore.getState().markAsRead(id);

      const notification = useNotificationStore
        .getState()
        .notifications.find((n: Notification) => n.id === id);
      expect(notification?.read).toBe(true);
    });
  });

  describe("markAllAsRead", () => {
    it("marks all notifications as read", () => {
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "One" });
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Two" });
      useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "Three" });

      useNotificationStore.getState().markAllAsRead();

      const { notifications } = useNotificationStore.getState();
      for (const n of notifications) {
        expect(n.read).toBe(true);
      }
    });

    it("is a no-op on an empty store", () => {
      useNotificationStore.getState().markAllAsRead();

      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });
  });

  describe("max history limit", () => {
    it("caps notifications at 50 (MAX_HISTORY)", () => {
      // Add 55 notifications
      for (let i = 0; i < 55; i++) {
        useNotificationStore
          .getState()
          .addNotification({ type: "info", title: `Notification ${i}` });
      }

      const { notifications } = useNotificationStore.getState();
      expect(notifications).toHaveLength(50);
    });

    it("keeps newest notifications when exceeding the cap", () => {
      // Add 51 notifications
      for (let i = 0; i < 51; i++) {
        useNotificationStore
          .getState()
          .addNotification({ type: "info", title: `Notification ${i}` });
      }

      const { notifications } = useNotificationStore.getState();
      // The newest (index 50) should be first
      expect(notifications[0].title).toBe("Notification 50");
      // The oldest kept should be index 1 (index 0 was dropped)
      expect(notifications[49].title).toBe("Notification 1");
    });
  });

  describe("notification id format", () => {
    it("generates an id starting with 'notif_'", () => {
      const id = useNotificationStore
        .getState()
        .addNotification({ type: "info", title: "ID check" });

      expect(id).toMatch(/^notif_\d+_\d+$/);
    });
  });
});
