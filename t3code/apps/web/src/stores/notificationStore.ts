import { create } from "zustand";

export const DEFAULT_NOTIFICATION_DURATION_MS = 5_000;
export const NOTIFICATION_HISTORY_LIMIT = 50;

export type NotificationType = "success" | "error" | "warning" | "info";

export interface NotificationInput {
  type: NotificationType;
  title: string;
  description?: string;
  duration?: number;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  duration: number;
  createdAt: string;
}

interface NotificationStore {
  notifications: NotificationRecord[];
  history: NotificationRecord[];
  addNotification: (notification: NotificationInput) => string;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
}

let notificationIdCounter = 0;

function createNotificationId() {
  notificationIdCounter += 1;
  return `notification-${Date.now()}-${notificationIdCounter}`;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],
  addNotification: (input) => {
    const notification: NotificationRecord = {
      id: createNotificationId(),
      type: input.type,
      title: input.title,
      duration: input.duration ?? DEFAULT_NOTIFICATION_DURATION_MS,
      createdAt: new Date().toISOString(),
      ...(input.description === undefined ? {} : { description: input.description }),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
      history: [notification, ...state.history].slice(0, NOTIFICATION_HISTORY_LIMIT),
    }));

    return notification.id;
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),
  clearHistory: () => set({ history: [] }),
}));
