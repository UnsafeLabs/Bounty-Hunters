import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_NOTIFICATION_DURATION_MS,
  NOTIFICATION_HISTORY_LIMIT,
  useNotificationStore,
} from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], history: [] });
  });

  it("adds active notifications and records them in history", () => {
    const id = useNotificationStore.getState().addNotification({
      type: "success",
      title: "Build completed",
      description: "The latest build finished successfully.",
    });

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      id,
      type: "success",
      title: "Build completed",
      description: "The latest build finished successfully.",
      duration: DEFAULT_NOTIFICATION_DURATION_MS,
    });
    expect(Date.parse(state.notifications[0]?.createdAt ?? "")).not.toBeNaN();
  });

  it("supports configurable duration and immediate dismissal", () => {
    const id = useNotificationStore.getState().addNotification({
      type: "warning",
      title: "Session expiring",
      duration: 1_500,
    });

    expect(useNotificationStore.getState().notifications[0]?.duration).toBe(1_500);

    useNotificationStore.getState().dismissNotification(id);

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(0);
    expect(state.history).toHaveLength(1);
  });

  it("keeps only the latest 50 history items and clears history on demand", () => {
    for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 5; index += 1) {
      useNotificationStore.getState().addNotification({
        type: "info",
        title: `Notification ${index}`,
      });
    }

    const history = useNotificationStore.getState().history;
    expect(history).toHaveLength(NOTIFICATION_HISTORY_LIMIT);
    expect(history[0]?.title).toBe("Notification 54");
    expect(history.at(-1)?.title).toBe("Notification 5");

    useNotificationStore.getState().clearHistory();

    expect(useNotificationStore.getState().history).toHaveLength(0);
  });
});
