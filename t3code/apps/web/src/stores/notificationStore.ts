import { create } from "zustand";

export interface Notification {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
  duration: number; // ms, 0 = sticky
  createdAt: number;
}

interface NotificationStore {
  notifications: Notification[];
  history: Notification[];
  addNotification: (n: Omit<Notification, "id" | "createdAt">) => string;
  removeNotification: (id: string) => void;
  clearHistory: () => void;
}

let _nextId = 0;
function generateId(): string {
  _nextId += 1;
  return `notif-${_nextId}-${Date.now()}`;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  history: [],

  addNotification: (n) => {
    const id = generateId();
    const notification: Notification = {
      ...n,
      id,
      createdAt: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
      history: [...state.history.slice(-49), notification],
    }));

    if (n.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, n.duration);
    }

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