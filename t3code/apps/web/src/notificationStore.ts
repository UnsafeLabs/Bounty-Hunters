import React from "react";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number; // ms, default 5000
  timestamp: number;
}

interface NotificationStore {
  notifications: Notification[];
  addNotification: (notif: Omit<Notification, "id" | "timestamp">) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

// Simple store using React state (following codebase patterns)
let listeners: Array<() => void> = [];
let state: NotificationStore["notifications"] = [];

const emit = () => listeners.forEach((l) => l());

export const notificationStore = {
  getNotifications: () => state,

  addNotification: (notif: Omit<Notification, "id" | "timestamp">) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification: Notification = {
      ...notif,
      id,
      timestamp: Date.now(),
    };
    state = [...state, notification];
    emit();

    const duration = notif.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        notificationStore.removeNotification(id);
      }, duration);
    }
  },

  removeNotification: (id: string) => {
    state = state.filter((n) => n.id !== id);
    emit();
  },

  clearAll: () => {
    state = [];
    emit();
  },

  subscribe: (listener: () => void) => {
    listeners = [...listeners, listener];
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },
};
