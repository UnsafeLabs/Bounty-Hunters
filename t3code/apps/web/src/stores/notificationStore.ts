import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  timestamp: number;
  read: boolean;
}

const MAX_HISTORY = 50;
const DEFAULT_DURATION = 5000;

interface NotificationState {
  notifications: Notification[];
  addNotification: (
    notification: Omit<Notification, "id" | "timestamp" | "read"> & {
      duration?: number;
    },
  ) => string;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

let notificationCounter = 0;
function generateId(): string {
  notificationCounter += 1;
  return `notif_${Date.now()}_${notificationCounter}`;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addNotification: ({ duration = DEFAULT_DURATION, ...data }) => {
    const id = generateId();
    const notification: Notification = {
      ...data,
      id,
      timestamp: Date.now(),
      read: false,
    };

    set((state) => ({
      notifications: [
        notification,
        ...state.notifications.slice(0, MAX_HISTORY - 1),
      ],
    }));

    if (duration > 0) {
      setTimeout(() => {
        const current = get().notifications.find((n) => n.id === id);
        if (current) {
          get().dismissNotification(id);
        }
      }, duration);
    }

    return id;
  },

  dismissNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearHistory: () => {
    set({ notifications: [] });
  },

  markAsRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }));
  },
}));
