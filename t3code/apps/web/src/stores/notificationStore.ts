import { create } from "zustand";
import { toastManager } from "~/components/ui/toast";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  description?: string;
  timestamp: string;
  durationMs?: number;
}

export interface NotificationState {
  history: Notification[];
  addNotification: (params: {
    type: NotificationType;
    title: string;
    description?: string;
    durationMs?: number;
  }) => void;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
}

const HISTORY_MAX = 50;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `notif-${Date.now()}-${counter}`;
}

function pushToast(notif: Notification) {
  toastManager.add({
    type: notif.type,
    title: notif.title,
    description: notif.description,
    data: {
      dismissAfterVisibleMs: notif.durationMs ?? 5000,
      onClose: () => {
        useNotificationStore.getState().dismissNotification(notif.id);
      },
    },
  });
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  history: [],

  addNotification: ({ type, title, description, durationMs }) => {
    const notif: Notification = {
      id: nextId(),
      type,
      title,
      description,
      timestamp: new Date().toISOString(),
      durationMs,
    };

    set((state) => ({
      history: [notif, ...state.history].slice(0, HISTORY_MAX),
    }));

    pushToast(notif);
  },

  dismissNotification: (id) => {
    set((state) => ({
      history: state.history.filter((n) => n.id !== id),
    }));
  },

  clearHistory: () => {
    set({ history: [] });
  },
}));
