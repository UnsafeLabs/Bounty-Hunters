import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  duration: number; // ms, 0 = persistent
}

const MAX_HISTORY = 50;

interface NotificationStore {
  notifications: Notification[];
  history: Notification[]; // last 50, persisted in-memory only
  addNotification: (type: NotificationType, message: string, duration?: number) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  clearHistory: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],

  addNotification: (type, message, duration = 5000) => {
    const id = crypto.randomUUID();
    const notification: Notification = {
      id,
      type,
      message,
      timestamp: Date.now(),
      duration,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
      history: [notification, ...state.history].slice(0, MAX_HISTORY),
    }));

    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }

    return id;
  },

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clearAll: () => set({ notifications: [] }),

  clearHistory: () => set({ history: [] }),
}));
