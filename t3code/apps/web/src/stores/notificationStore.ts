import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration: number;
  createdAt: number;
  dismissed: boolean;
}

interface NotificationState {
  notifications: Notification[];
  history: Notification[];
  addNotification: (notif: Omit<Notification, "id" | "createdAt" | "dismissed">) => string;
  dismissNotification: (id: string) => void;
  clearAll: () => void;
  clearHistory: () => void;
}

let nextId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  history: [],

  addNotification: (notif) => {
    const id = `notif-${++nextId}`;
    const notification: Notification = {
      ...notif,
      id,
      createdAt: Date.now(),
      dismissed: false,
      duration: notif.duration ?? 5000,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
      // Keep last 50 notifications in history as specified
      history: [notification, ...state.history].slice(0, 50),
    }));

    // Auto-dismiss after configurable duration
    if (notification.duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, dismissed: true } : n
          ),
        }));
        // Remove from active after exit animation
        setTimeout(() => {
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
          }));
        }, 300);
      }, notification.duration);
    }

    return id;
  },

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, dismissed: true } : n
      ),
    })),

  clearAll: () => set({ notifications: [] }),

  clearHistory: () => set({ history: [] }),
}));
