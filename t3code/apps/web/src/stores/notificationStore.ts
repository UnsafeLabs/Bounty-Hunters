import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
  duration?: number;
}

interface NotificationStore {
  notifications: Notification[];
  history: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearHistory: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  history: [],
  addNotification: (notification) => {
    const id = crypto.randomUUID();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: Date.now(),
    };

    set((state) => {
      const newHistory = [newNotification, ...state.history].slice(0, 50);
      return {
        notifications: [...state.notifications, newNotification],
        history: newHistory,
      };
    });
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
