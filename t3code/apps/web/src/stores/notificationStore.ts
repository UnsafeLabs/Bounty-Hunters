/**
 * Toast notification store with history (issue 862).
 */

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  createdAt: number;
  durationMs: number;
  dismissed: boolean;
}

export const TYPE_STYLE: Record<NotificationType, { color: string; icon: string }> = {
  success: { color: "#16a34a", icon: "check" },
  error: { color: "#dc2626", icon: "x" },
  warning: { color: "#ca8a04", icon: "alert" },
  info: { color: "#2563eb", icon: "info" },
};

const DEFAULT_DURATION = 5000;
const HISTORY_MAX = 50;

export class NotificationStore {
  private active: Notification[] = [];
  private history: Notification[] = [];
  private seq = 0;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  addNotification(
    type: NotificationType,
    message: string,
    durationMs = DEFAULT_DURATION,
  ): Notification {
    const n: Notification = {
      id: `n${++this.seq}`,
      type,
      message,
      createdAt: this.now(),
      durationMs,
      dismissed: false,
    };
    this.active.push(n);
    this.history.unshift({ ...n });
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    return { ...n };
  }

  dismiss(id: string): void {
    this.active = this.active.filter((n) => n.id !== id);
  }

  /** Auto-dismiss expired active toasts. */
  tick(now = this.now()): void {
    this.active = this.active.filter((n) => now - n.createdAt < n.durationMs);
  }

  getActive(): Notification[] {
    return this.active.map((n) => ({ ...n }));
  }

  getHistory(): Notification[] {
    return this.history.map((n) => ({ ...n }));
  }

  clearHistory(): void {
    this.history = [];
  }
}
