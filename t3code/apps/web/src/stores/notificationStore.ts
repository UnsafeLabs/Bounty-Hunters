import { create } from "zustand";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface AppNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly message?: string;
  readonly createdAt: number;
  /** Auto-dismiss duration in ms; 0 means sticky until dismissed. */
  readonly durationMs: number;
}

export interface AddNotificationInput {
  readonly type: NotificationType;
  readonly title: string;
  readonly message?: string;
  /** Defaults to 5000ms. Pass 0 to keep until user dismisses. */
  readonly durationMs?: number;
}

const HISTORY_LIMIT = 50;
const DEFAULT_DURATION_MS = 5000;

export interface NotificationState {
  readonly active: ReadonlyArray<AppNotification>;
  readonly history: ReadonlyArray<AppNotification>;
  readonly historyOpen: boolean;
  readonly addNotification: (input: AddNotificationInput) => string;
  readonly dismissNotification: (id: string) => void;
  readonly clearHistory: () => void;
  readonly setHistoryOpen: (open: boolean) => void;
  readonly toggleHistoryOpen: () => void;
}

let seq = 0;
const makeId = () => {
  seq += 1;
  return `notif-${Date.now()}-${seq}`;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  active: [],
  history: [],
  historyOpen: false,

  addNotification: (input) => {
    const id = makeId();
    const notification: AppNotification = {
      id,
      type: input.type,
      title: input.title,
      message: input.message,
      createdAt: Date.now(),
      durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
    };

    set((state) => ({
      active: [...state.active, notification],
      history: [notification, ...state.history].slice(0, HISTORY_LIMIT),
    }));

    if (notification.durationMs > 0) {
      const timeoutId = globalThis.setTimeout(() => {
        get().dismissNotification(id);
      }, notification.durationMs);
      // Best-effort cleanup if Node timers vs browser differ — no unref needed in browser.
      void timeoutId;
    }

    return id;
  },

  dismissNotification: (id) => {
    set((state) => ({
      active: state.active.filter((n) => n.id !== id),
    }));
  },

  clearHistory: () => {
    set({ history: [] });
  },

  setHistoryOpen: (open) => {
    set({ historyOpen: open });
  },

  toggleHistoryOpen: () => {
    set((state) => ({ historyOpen: !state.historyOpen }));
  },
}));

/** Non-hook helpers for non-React call sites. */
export const addNotification = (input: AddNotificationInput) =>
  useNotificationStore.getState().addNotification(input);

export const clearHistory = () => useNotificationStore.getState().clearHistory();
