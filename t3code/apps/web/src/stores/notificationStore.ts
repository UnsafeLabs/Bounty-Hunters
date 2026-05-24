import { create } from "zustand";

import { randomUUID } from "~/lib/utils";

export type NotificationType = "success" | "error" | "warning" | "info";

export const DEFAULT_NOTIFICATION_DURATION_MS = 5_000;
export const NOTIFICATION_HISTORY_LIMIT = 50;

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number | null;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  duration: number | null;
  createdAt: string;
}

interface NotificationStore {
  notifications: AppNotification[];
  history: AppNotification[];
  addNotification: (notification: NotificationInput) => string;
  dismissNotification: (notificationId: string) => void;
  clearHistory: () => void;
}

function normalizeDuration(duration: NotificationInput["duration"]): number | null {
  if (duration === null) {
    return null;
  }

  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return DEFAULT_NOTIFICATION_DURATION_MS;
  }

  return Math.max(0, duration);
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],
  addNotification: (input) => {
    const notification: AppNotification = {
      id: randomUUID(),
      type: input.type,
      title: input.title,
      message: input.message?.trim() ? input.message : null,
      duration: normalizeDuration(input.duration),
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
      history: [notification, ...state.history].slice(0, NOTIFICATION_HISTORY_LIMIT),
    }));

    return notification.id;
  },
  dismissNotification: (notificationId) =>
    set((state) => ({
      notifications: state.notifications.filter(
        (notification) => notification.id !== notificationId,
      ),
    })),
  clearHistory: () => set({ history: [] }),
}));
