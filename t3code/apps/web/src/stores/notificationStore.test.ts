import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_NOTIFICATION_DURATION_MS,
  NOTIFICATION_HISTORY_LIMIT,
  useNotificationStore,
} from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T20:30:00.000Z"));
    useNotificationStore.setState({ notifications: [], history: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds notifications with the default duration", () => {
    const id = useNotificationStore.getState().addNotification({
      type: "success",
      title: "Push completed",
      message: "Changes were pushed to origin.",
    });

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      id,
      type: "success",
      title: "Push completed",
      message: "Changes were pushed to origin.",
      duration: DEFAULT_NOTIFICATION_DURATION_MS,
      createdAt: "2026-05-24T20:30:00.000Z",
    });
  });

  it("keeps configurable durations", () => {
    useNotificationStore.getState().addNotification({
      type: "error",
      title: "Build failed",
      duration: 12_000,
    });

    expect(useNotificationStore.getState().notifications[0]?.duration).toBe(12_000);
  });

  it("dismisses active notifications without clearing history", () => {
    const id = useNotificationStore.getState().addNotification({
      type: "warning",
      title: "Session expiring",
    });

    useNotificationStore.getState().dismissNotification(id);

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(useNotificationStore.getState().history).toHaveLength(1);
  });

  it("keeps the newest 50 notifications in history", () => {
    for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 1; index += 1) {
      useNotificationStore.getState().addNotification({
        type: "info",
        title: `Notification ${index}`,
      });
    }

    const history = useNotificationStore.getState().history;
    expect(history).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
    expect(history[0]?.title).toBe("Notification 50");
    expect(history.at(-1)?.title).toBe("Notification 1");
  });

  it("clears history", () => {
    useNotificationStore.getState().addNotification({
      type: "info",
      title: "Session restored",
    });

    useNotificationStore.getState().clearHistory();

    expect(useNotificationStore.getState().history).toHaveLength(0);
  });
});
