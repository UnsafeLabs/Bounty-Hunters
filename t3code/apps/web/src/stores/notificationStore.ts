import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // milliseconds, default 5000
  createdAt: number;
}

interface NotificationState {
  notifications: Notification[];
  history: Notification[];
  addNotification: (notification: Omit<Notification, "id" | "createdAt">) => void;
  removeNotification: (id: string) => void;
  clearHistory: () => void;
}

const MAX_HISTORY_SIZE = 50;

let notificationCounter = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  history: [],

  addNotification: (notification) => {
    const id = `notification-${++notificationCounter}-${Date.now()}`;
    const newNotification: Notification = {
      ...notification,
      id,
      createdAt: Date.now(),
      duration: notification.duration ?? 5000,
    };

    set((state) => ({
      notifications: [...state.notifications, newNotification],
      history: [newNotification, ...state.history].slice(0, MAX_HISTORY_SIZE),
    }));

    // Auto-dismiss after duration
    if (newNotification.duration && newNotification.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, newNotification.duration);
    }
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearHistory: () => {
    set({ history: [] });
  },
}));
