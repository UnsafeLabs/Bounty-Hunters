"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
  ClockIcon,
  HistoryIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastData {
  readonly id: string;
  readonly type: ToastType;
  readonly title: string;
  readonly message: string;
  readonly duration: number; // ms; <= 0 means no auto-dismiss
  readonly createdAt: number;
}

export interface ToastNotificationsOptions {
  readonly maxVisible?: number;
  readonly defaultDuration?: number;
}

// ── Store (singleton, module-level state) ───────────────────────────────────────

let toastIdCounter = 0;
let visibleToasts: ToastData[] = [];
let historyToasts: ToastData[] = [];
let listeners: Array<() => void> = [];
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function generateId(): string {
  toastIdCounter += 1;
  return `toast-${toastIdCounter}-${Date.now()}`;
}

function scheduleAutoDismiss(toast: ToastData): void {
  if (toast.duration <= 0) return;
  const timer = setTimeout(() => {
    dismissToast(toast.id);
  }, toast.duration);
  dismissTimers.set(toast.id, timer);
}

function clearAutoDismiss(id: string): void {
  const timer = dismissTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    dismissTimers.delete(id);
  }
}

export function addToast(
  type: ToastType,
  title: string,
  message: string,
  duration: number = 5000,
): string {
  const id = generateId();
  const toast: ToastData = {
    id,
    type,
    title,
    message,
    duration,
    createdAt: Date.now(),
  };
  historyToasts = [...historyToasts, toast];
  visibleToasts = [...visibleToasts, toast];
  scheduleAutoDismiss(toast);
  notifyListeners();
  return id;
}

export function dismissToast(id: string): void {
  clearAutoDismiss(id);
  visibleToasts = visibleToasts.filter((t) => t.id !== id);
  notifyListeners();
}

export function clearHistory(): void {
  // Clear any pending timers for visible toasts
  for (const t of visibleToasts) {
    clearAutoDismiss(t.id);
  }
  historyToasts = [];
  visibleToasts = [];
  notifyListeners();
}

export function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getSnapshot(): {
  visible: readonly ToastData[];
  history: readonly ToastData[];
} {
  return { visible: visibleToasts, history: historyToasts };
}

// ── Icons map ───────────────────────────────────────────────────────────────────

const TOAST_ICONS: Record<ToastType, ReactNode> = {
  success: <CheckCircleIcon className="size-5 text-success" />,
  error: <XCircleIcon className="size-5 text-destructive" />,
  info: <InfoIcon className="size-5 text-info" />,
  warning: <TriangleAlertIcon className="size-5 text-warning" />,
};

const TOAST_BORDER: Record<ToastType, string> = {
  success: "border-l-success",
  error: "border-l-destructive",
  info: "border-l-info",
  warning: "border-l-warning",
};

// ── Individual Toast Item ───────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
  entering,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
  entering: boolean;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-slot="toast-notification"
      data-toast-type={toast.type}
      className={cn(
        "relative flex w-80 items-start gap-3 rounded-lg border bg-popover p-4 text-card-foreground shadow-lg transition-all duration-300 ease-in-out",
        "border-l-4",
        TOAST_BORDER[toast.type],
        entering
          ? "translate-x-0 opacity-100"
          : "translate-x-full opacity-0",
      )}
    >
      <div className="mt-0.5 shrink-0">{TOAST_ICONS[toast.type]}</div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{toast.title}</p>
        <p className="mt-0.5 text-muted-foreground text-xs">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

// ── History Panel ───────────────────────────────────────────────────────────────

function HistoryPanel({
  history,
  onClose,
}: {
  history: readonly ToastData[];
  onClose: () => void;
}) {
  return (
    <div
      data-slot="toast-history-panel"
      className="fixed bottom-4 right-4 z-[9999] flex max-h-96 w-80 flex-col rounded-xl border bg-popover shadow-xl"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="flex items-center gap-2 font-semibold text-sm">
          <HistoryIcon className="size-4" />
          Toast History
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Close history"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {history.length === 0 ? (
          <p className="px-4 py-8 text-center text-muted-foreground text-xs">
            No toasts yet this session.
          </p>
        ) : (
          <ul className="divide-y">
            {history.map((toast) => (
              <li key={toast.id} className="flex items-start gap-2 px-4 py-2.5">
                <div className="mt-0.5 shrink-0">
                  {TOAST_ICONS[toast.type]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-xs">{toast.title}</p>
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    {toast.message}
                  </p>
                </div>
                <span className="shrink-0 text-muted-foreground/50 text-[10px]">
                  <ClockIcon className="inline size-3 align-text-bottom" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

export interface ToastNotificationsProps {
  readonly maxVisible?: number;
  readonly defaultDuration?: number;
}

export function ToastNotifications({
  maxVisible = 5,
  defaultDuration = 5000,
}: ToastNotificationsProps) {
  const [snapshot, setSnapshot] = useState(() => getSnapshot());
  const [historyOpen, setHistoryOpen] = useState(false);
  const enteringRef = useRef<Set<string>>(new Set());

  // Keep track of entering animation state
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsub = subscribe(() => {
      const snap = getSnapshot();
      setSnapshot(snap);

      // Mark new toasts as entering
      const newIds = new Set(enteringRef.current);
      for (const toast of snap.visible) {
        if (!enteringRef.current.has(toast.id)) {
          newIds.add(toast.id);
          // Remove entering state after animation completes
          setTimeout(() => {
            setEnteringIds((prev) => {
              const next = new Set(prev);
              next.delete(toast.id);
              return next;
            });
          }, 300);
        }
      }
      enteringRef.current = newIds;
      setEnteringIds(newIds);
    });
    return unsub;
  }, []);

  const handleDismiss = useCallback((id: string) => {
    dismissToast(id);
  }, []);

  const visible = snapshot.visible.slice(0, maxVisible);

  return (
    <>
      {/* Toast stack — bottom-right */}
      <div
        data-slot="toast-container"
        className="fixed bottom-4 right-4 z-[9998] flex flex-col-reverse gap-2"
      >
        {visible.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={handleDismiss}
            entering={enteringIds.has(toast.id)}
          />
        ))}
      </div>

      {/* History toggle button */}
      <button
        type="button"
        data-slot="toast-history-toggle"
        onClick={() => setHistoryOpen((prev) => !prev)}
        className={cn(
          "fixed bottom-4 right-4 z-[9997] flex items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-xs shadow-md transition-all duration-200 hover:bg-accent",
          visible.length > 0 && "mb-0",
        )}
        style={{
          // Position above toast stack only when toasts are visible
          ...(visible.length > 0
            ? { transform: `translateY(calc(-${Math.min(visible.length, maxVisible)} * 80px - 8px))` }
            : {}),
        }}
        aria-label={historyOpen ? "Close toast history" : "Open toast history"}
      >
        <HistoryIcon className="size-3.5" />
        History
        {snapshot.history.length > 0 && (
          <span className="inline-flex size-4 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-medium">
            {snapshot.history.length}
          </span>
        )}
      </button>

      {/* History panel */}
      {historyOpen && (
        <HistoryPanel
          history={snapshot.history}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </>
  );
}

// ── Convenience helpers for imperative use ──────────────────────────────────────

export const toast = {
  success(title: string, message: string, duration?: number): string {
    return addToast("success", title, message, duration);
  },
  error(title: string, message: string, duration?: number): string {
    return addToast("error", title, message, duration);
  },
  info(title: string, message: string, duration?: number): string {
    return addToast("info", title, message, duration);
  },
  warning(title: string, message: string, duration?: number): string {
    return addToast("warning", title, message, duration);
  },
};
