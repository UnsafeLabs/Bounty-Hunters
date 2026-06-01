/**
 * In-app toast notification system with history panel.
 */

export interface Toast {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  timestamp: number;
}

export class ToastManager {
  private toasts: Toast[] = [];
  private history: Toast[] = [];
  private maxHistory = 100;
  private listeners: Set<(toasts: Toast[]) => void> = new Set();

  show(toast: Omit<Toast, "id" | "timestamp">): string {
    const id = crypto.randomUUID();
    const entry: Toast = { ...toast, id, timestamp: Date.now() };
    this.toasts.push(entry);
    this.history.push(entry);
    if (this.history.length > this.maxHistory) this.history.shift();
    this.notify();
    if (toast.duration !== 0) setTimeout(() => this.dismiss(id), toast.duration || 5000);
    return id;
  }

  dismiss(id: string): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  }

  getToasts(): Toast[] { return [...this.toasts]; }
  getHistory(): Toast[] { return [...this.history]; }
  clearHistory(): void { this.history = []; }
  subscribe(fn: (toasts: Toast[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void { this.listeners.forEach((fn) => fn(this.toasts)); }
}

export const toast = new ToastManager();
