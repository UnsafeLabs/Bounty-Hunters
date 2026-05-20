import { create } from "zustand";

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  createdAt: number;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (type: NotificationType, title: string, description?: string) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

let nextId = 1;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  addNotification: (type, title, description) => {
    const id = `notification-${nextId++}`;
    set((state) => ({
      notifications: [
        ...state.notifications,
        { id, type, title, description, createdAt: Date.now() },
      ],
    }));
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 5000);
  },
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
  clearNotifications: () => set({ notifications: [] }),
}));
