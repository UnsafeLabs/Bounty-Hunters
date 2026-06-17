import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotificationStore } from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: [],
      history: [],
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a notification", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification("success", "Test message");

    const { notifications } = useNotificationStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe("success");
    expect(notifications[0].message).toBe("Test message");
  });

  it("auto-dismisses after duration", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification("info", "Auto dismiss", 1000);

    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(useNotificationStore.getState().history).toHaveLength(1);
  });

  it("manually dismisses a notification", () => {
    const { addNotification } = useNotificationStore.getState();
    addNotification("error", "Manual dismiss");

    const { notifications, dismissNotification } = useNotificationStore.getState();
    dismissNotification(notifications[0].id);

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(useNotificationStore.getState().history).toHaveLength(1);
  });

  it("clears history", () => {
    const { addNotification, clearHistory } = useNotificationStore.getState();
    addNotification("warning", "Test");

    vi.advanceTimersByTime(5000);

    clearHistory();

    expect(useNotificationStore.getState().history).toHaveLength(0);
  });

  it("limits history to 50 items", () => {
    const { addNotification } = useNotificationStore.getState();

    for (let i = 0; i < 55; i++) {
      addNotification("info", `Message ${i}`);
      vi.advanceTimersByTime(5000);
    }

    expect(useNotificationStore.getState().history).toHaveLength(50);
  });
});
