import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  createdAt: number;
}

interface NotificationStore {
  notifications: Notification[];
  history: Notification[];
  addNotification: (type: NotificationType, title: string, message?: string, duration?: number) => void;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
  clearHistory: () => void;
}

let counter = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],

  addNotification: (type, title, message, duration = 5000) => {
    const id = `notif_${++counter}_${Date.now()}`;
    const notification: Notification = { id, type, title, message, duration, createdAt: Date.now() };
    set((s) => ({
      notifications: [...s.notifications, notification],
      history: [notification, ...s.history].slice(0, 100),
    }));
    if (duration > 0) {
      setTimeout(() => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })), duration);
    }
  },

  dismissNotification: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  clearAll: () => set({ notifications: [] }),
  clearHistory: () => set({ history: [] }),
}));
