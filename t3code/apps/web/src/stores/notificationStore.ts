import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  timestamp: string; // ISO string
  duration?: number; // duration in ms, optional. Default to 5000.
}

interface NotificationStore {
  notifications: Notification[];
  history: Notification[];
  addNotification: (notification: Omit<Notification, "id" | "timestamp">) => void;
  removeNotification: (id: string) => void;
  clearHistory: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],
  addNotification: (notification) => {
    const id = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toISOString();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp,
    };
    set((state) => ({
      notifications: [...state.notifications, newNotification],
      history: [newNotification, ...state.history].slice(0, 50),
    }));
  },
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
  clearHistory: () => set({ history: [] }),
}));
