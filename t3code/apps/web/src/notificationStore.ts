import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  duration: number;
}

export interface NotificationStore {
  notifications: Notification[];
  history: Notification[];
  addNotification: (
    type: NotificationType,
    message: string,
    duration?: number
  ) => void;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
}

const DEFAULT_DURATION = 5000;
const MAX_HISTORY = 50;

let idCounter = 0;
function generateId(): string {
  return `notification-${Date.now()}-${++idCounter}`;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  history: [],

  addNotification: (type, message, duration = DEFAULT_DURATION) => {
    const id = generateId();
    const notification: Notification = {
      id,
      type,
      message,
      timestamp: Date.now(),
      duration,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    if (duration > 0) {
      setTimeout(() => {
        get().dismissNotification(id);
      }, duration);
    }
  },

  dismissNotification: (id) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      const newNotifications = state.notifications.filter((n) => n.id !== id);
      const newHistory = notification
        ? [notification, ...state.history].slice(0, MAX_HISTORY)
        : state.history;
      return {
        notifications: newNotifications,
        history: newHistory,
      };
    });
  },

  clearHistory: () => {
    set({ history: [] });
  },
}));
