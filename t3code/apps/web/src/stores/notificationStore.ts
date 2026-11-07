import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  readonly message: string;
  readonly title?: string;
  readonly duration: number;
  readonly createdAt: number;
  readonly dismissed: boolean;
}

export interface NotificationInput {
  readonly type: NotificationType;
  readonly message: string;
  readonly title?: string;
  readonly duration?: number;
}

interface NotificationState {
  readonly notifications: ReadonlyArray<Notification>;
  readonly history: ReadonlyArray<Notification>;
  readonly addNotification: (input: NotificationInput) => string;
  readonly dismissNotification: (id: string) => void;
  readonly clearHistory: () => void;
  readonly getNotification: (id: string) => Notification | undefined;
}

const DEFAULT_DURATION = 5000; // 5 seconds
const MAX_HISTORY_SIZE = 50;

let notificationCounter = 0;

function generateNotificationId(): string {
  notificationCounter += 1;
  return `notification-${Date.now()}-${notificationCounter}`;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  history: [],

  addNotification: (input: NotificationInput) => {
    const id = generateNotificationId();
    const notification: Notification = {
      id,
      type: input.type,
      message: input.message,
      title: input.title,
      duration: input.duration ?? DEFAULT_DURATION,
      createdAt: Date.now(),
      dismissed: false,
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
      history: [notification, ...state.history].slice(0, MAX_HISTORY_SIZE),
    }));

    return id;
  },

  dismissNotification: (id: string) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      if (!notification) {
        return state;
      }

      const dismissedNotification: Notification = {
        ...notification,
        dismissed: true,
      };

      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        history: state.history.map((n) => (n.id === id ? dismissedNotification : n)),
      };
    });
  },

  clearHistory: () => {
    set({ history: [] });
  },

  getNotification: (id: string) => {
    const state = get();
    return state.notifications.find((n) => n.id === id) ??
           state.history.find((n) => n.id === id);
  },
}));

// Convenience methods for common notification types
export const notify = {
  success: (message: string, title?: string, duration?: number) =>
    useNotificationStore.getState().addNotification({
      type: 'success',
      message,
      title,
      duration,
    }),

  error: (message: string, title?: string, duration?: number) =>
    useNotificationStore.getState().addNotification({
      type: 'error',
      message,
      title,
      duration,
    }),

  warning: (message: string, title?: string, duration?: number) =>
    useNotificationStore.getState().addNotification({
      type: 'warning',
      message,
      title,
      duration,
    }),

  info: (message: string, title?: string, duration?: number) =>
    useNotificationStore.getState().addNotification({
      type: 'info',
      message,
      title,
      duration,
    }),
};
