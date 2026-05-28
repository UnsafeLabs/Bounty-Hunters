/**
 * Zustand store for the toast notification system.
 *
 * Supports four notification types (info, success, warning, error),
 * configurable auto-dismiss with progress bar, and a scrollable
 * history panel that caps at 50 entries.
 */
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  /** Unique identifier for the notification. */
  id: string;
  /** The user-visible message. */
  message: string;
  /** Visual tone / color variant. */
  type: NotificationType;
  /** ISO-8601 timestamp of creation. */
  createdAt: string;
  /** Whether the user has acknowledged this notification. */
  read: boolean;
  /** Auto-dismiss duration in ms. 0 = no auto-dismiss. */
  duration: number;
}

export interface NotificationState {
  /** Currently visible toasts (these are the "active" notifications). */
  toasts: Notification[];
  /** Historical notifications (capped at MAX_HISTORY). */
  history: Notification[];

  // Actions
  addNotification: (message: string, type: NotificationType, duration?: number) => string;
  dismissNotification: (id: string) => void;
  clearHistory: () => void;
  markAsRead: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;
const DEFAULT_DURATION = 5_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let nextId = 1;
function generateId(): string {
  return `notification-${nextId++}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNotificationStore = create<NotificationState>((set, get) => ({
  toasts: [],
  history: [],

  addNotification: (message, type, duration = DEFAULT_DURATION) => {
    const id = generateId();
    const notification: Notification = {
      id,
      message,
      type,
      createdAt: new Date().toISOString(),
      read: false,
      duration,
    };

    set((state) => ({
      toasts: [...state.toasts, notification],
    }));

    // Auto-dismiss timer
    if (duration > 0) {
      setTimeout(() => {
        get().dismissNotification(id);
      }, duration);
    }

    return id;
  },

  dismissNotification: (id) => {
    set((state) => {
      const toast = state.toasts.find((t) => t.id === id);
      if (!toast) return state;

      const nextToasts = state.toasts.filter((t) => t.id !== id);
      const nextHistory = [{ ...toast, read: toast.read }, ...state.history].slice(0, MAX_HISTORY);

      return {
        toasts: nextToasts,
        history: nextHistory,
      };
    });
  },

  clearHistory: () => {
    set({ history: [] });
  },

  markAsRead: (id) => {
    set((state) => {
      // Check in toasts
      const toastIndex = state.toasts.findIndex((t) => t.id === id);
      if (toastIndex !== -1) {
        const nextToasts = [...state.toasts];
        nextToasts[toastIndex] = { ...nextToasts[toastIndex]!, read: true };
        return { toasts: nextToasts };
      }

      // Check in history
      const historyIndex = state.history.findIndex((t) => t.id === id);
      if (historyIndex !== -1) {
        const nextHistory = [...state.history];
        nextHistory[historyIndex] = { ...nextHistory[historyIndex]!, read: true };
        return { history: nextHistory };
      }

      return state;
    });
  },
}));
