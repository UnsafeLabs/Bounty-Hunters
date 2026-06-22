import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  createdAt: string;
  dismissed: boolean;
}

const MAX_HISTORY = 50;

function generateId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface NotificationStore {
  toasts: Notification[];
  history: Notification[];
  addNotification: (opts: Omit<Notification, "id" | "createdAt" | "dismissed">) => void;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
  getRecentNotifications: () => Notification[];
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  toasts: [],
  history: [],

  addNotification: (opts) => {
    const now = new Date().toISOString();
    const notification: Notification = {
      ...opts,
      id: generateId(),
      createdAt: now,
      dismissed: false,
    };

    set((state) => {
      const newToast = [notification, ...state.toasts].slice(0, 10); // max 10 visible toasts

      // Move to history after auto-dismiss or keep in toasts
      const duration = opts.duration ?? 5000;
      setTimeout(() => {
        set((s) => {
          const updatedHistory = [notification, ...s.history].slice(0, MAX_HISTORY);
          return {
            history: updatedHistory,
            toasts: s.toasts.filter((t) => t.id !== notification.id),
          };
        });
      }, duration);

      return { toasts: newToast };
    });
  },

  dismissNotification: (id) => {
    set((state) => {
      const notif = state.toasts.find((t) => t.id === id);
      if (!notif) return state;

      const updatedHistory = [notif, ...state.history].slice(0, MAX_HISTORY);
      return {
        history: updatedHistory,
        toasts: state.toasts.filter((t) => t.id !== id),
      };
    });
  },

  clearHistory: () => {
    set({ history: [] });
  },

  getRecentNotifications: () => {
    return get().history.slice(0, 50);
  },
}));
