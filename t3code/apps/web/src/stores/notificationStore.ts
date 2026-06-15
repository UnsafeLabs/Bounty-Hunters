import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface ToastNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  duration?: number;
}

interface NotificationStore {
  notifications: ToastNotification[];
  history: ToastNotification[];
  addNotification: (notification: Omit<ToastNotification, "id" | "timestamp">) => string;
  removeNotification: (id: string) => void;
  clearHistory: () => void;
}

let nextId = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],

  addNotification: (notification) => {
    const id = `notification-${++nextId}-${Date.now()}`;
    const toast: ToastNotification = {
      ...notification,
      id,
      timestamp: Date.now(),
      duration: notification.duration ?? 5000,
    };
    set((state) => ({
      notifications: [...state.notifications, toast],
      history: [...state.history.slice(-99), toast],
    }));
    return id;
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
