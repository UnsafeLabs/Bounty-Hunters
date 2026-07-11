"use client";

import {
  CheckCircle2Icon,
  CircleAlertIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
  BellIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo } from "react";

import { cn } from "~/lib/utils";
import {
  type AppNotification,
  type NotificationType,
  useNotificationStore,
} from "~/stores/notificationStore";
import { Button } from "./ui/button";

const TYPE_STYLES: Record<
  NotificationType,
  { border: string; icon: typeof InfoIcon; iconClass: string }
> = {
  success: {
    border: "border-emerald-500/40",
    icon: CheckCircle2Icon,
    iconClass: "text-emerald-500",
  },
  error: {
    border: "border-red-500/40",
    icon: CircleAlertIcon,
    iconClass: "text-red-500",
  },
  warning: {
    border: "border-amber-500/40",
    icon: TriangleAlertIcon,
    iconClass: "text-amber-500",
  },
  info: {
    border: "border-sky-500/40",
    icon: InfoIcon,
    iconClass: "text-sky-500",
  },
};

function ToastCard({
  notification,
  onDismiss,
  exiting,
}: {
  notification: AppNotification;
  onDismiss: () => void;
  exiting?: boolean;
}) {
  const style = TYPE_STYLES[notification.type];
  const Icon = style.icon;

  return (
    <div
      role="status"
      data-notification-id={notification.id}
      data-notification-type={notification.type}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm gap-3 rounded-lg border bg-popover/95 p-3 shadow-lg backdrop-blur-sm transition-all duration-300 ease-out",
        style.border,
        exiting
          ? "translate-x-4 opacity-0"
          : "animate-in slide-in-from-right fade-in duration-300",
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", style.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{notification.title}</p>
        {notification.message ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{notification.message}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onDismiss}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

/**
 * Active toasts (top-right stack) + optional history panel.
 */
export function NotificationToast() {
  const active = useNotificationStore((s) => s.active);
  const history = useNotificationStore((s) => s.history);
  const historyOpen = useNotificationStore((s) => s.historyOpen);
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const setHistoryOpen = useNotificationStore((s) => s.setHistoryOpen);

  const stacked = useMemo(() => active.slice().reverse(), [active]);

  return (
    <>
      <div
        className="pointer-events-none fixed top-3 right-3 z-100 flex w-full max-w-sm flex-col gap-2"
        data-slot="notification-toast-stack"
        aria-live="polite"
      >
        {stacked.map((n) => (
          <ToastCard
            key={n.id}
            notification={n}
            onDismiss={() => dismissNotification(n.id)}
          />
        ))}
      </div>

      {historyOpen ? (
        <div
          className="fixed inset-y-0 right-0 z-100 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
          data-slot="notification-history-panel"
          role="dialog"
          aria-label="Notification history"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BellIcon className="size-4" />
              Notification history
              <span className="text-muted-foreground">({history.length}/50)</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => clearHistory()}
                aria-label="Clear notification history"
              >
                <Trash2Icon className="size-4" />
                Clear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.map((n) => {
                  const style = TYPE_STYLES[n.type];
                  const Icon = style.icon;
                  return (
                    <li
                      key={`${n.id}-hist`}
                      className={cn(
                        "rounded-md border bg-card p-3 text-sm",
                        style.border,
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Icon className={cn("mt-0.5 size-4", style.iconClass)} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{n.title}</p>
                          {n.message ? (
                            <p className="text-xs text-muted-foreground">{n.message}</p>
                          ) : null}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {formatTimestamp(n.createdAt)}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Sidebar control to open the history panel. */
export function NotificationHistoryButton({ className }: { className?: string }) {
  const toggleHistoryOpen = useNotificationStore((s) => s.toggleHistoryOpen);
  const historyCount = useNotificationStore((s) => s.history.length);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={() => toggleHistoryOpen()}
      aria-label="Open notification history"
      data-slot="notification-history-button"
    >
      <BellIcon className="size-4" />
      <span className="text-xs">Alerts</span>
      {historyCount > 0 ? (
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
          {Math.min(historyCount, 50)}
        </span>
      ) : null}
    </Button>
  );
}
