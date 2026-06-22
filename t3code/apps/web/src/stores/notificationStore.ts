import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly description?: string;
  readonly duration: number; // ms, 0 = no auto-dismiss
  readonly timestamp: number;
}

export interface NotificationStore {
  readonly notifications: readonly Notification[];
  readonly history: readonly Notification[];
  addNotification: (n: Omit<Notification, "id" | "timestamp">) => string;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  history: [],

  addNotification: (input) => {
    const id = `notif-${nextId++}`;
    const notification: Notification = {
      ...input,
      id,
      timestamp: Date.now(),
    };
    set((state) => ({
      notifications: [...state.notifications, notification],
      history: [...state.history.slice(-49), notification],
    }));

    // Auto-dismiss unless duration is 0
    if (input.duration > 0) {
      setTimeout(() => {
        get().dismissNotification(id);
      }, input.duration);
    }

    return id;
  },

  dismissNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearHistory: () => {
    set({ history: [] });
  },
}));

// Convenience helpers
export const notify = {
  success: (title: string, description?: string, duration = 5000) =>
    useNotificationStore.getState().addNotification({ type: "success", title, description, duration }),
  error: (title: string, description?: string, duration = 8000) =>
    useNotificationStore.getState().addNotification({ type: "error", title, description, duration }),
  warning: (title: string, description?: string, duration = 6000) =>
    useNotificationStore.getState().addNotification({ type: "warning", title, description, duration }),
  info: (title: string, description?: string, duration = 5000) =>
    useNotificationStore.getState().addNotification({ type: "info", title, description, duration }),
};
