import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "~/lib/utils";
import { useNotificationStore, type Notification } from "../stores/notificationStore";

const typeStyles: Record<Notification["type"], string> = {
  success: "border-l-4 border-l-success bg-success/10 text-success-foreground",
  error: "border-l-4 border-l-destructive bg-destructive/10 text-destructive-foreground",
  warning: "border-l-4 border-l-warning bg-warning/10 text-warning-foreground",
  info: "border-l-4 border-l-info bg-info/10 text-info-foreground",
};

const typeIcons: Record<Notification["type"], string> = {
  success: "\u2713",
  error: "\u2715",
  warning: "!",
  info: "\u2139",
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function ToastItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  const [exiting, setExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  return (
    <div
      data-slot="toast-item"
      data-notification-id={notification.id}
      className={cn(
        "flex items-start gap-3 rounded-lg px-4 py-3 shadow-lg text-sm",
        "transition-all duration-200 ease-in-out cursor-pointer",
        exiting
          ? "opacity-0 translate-x-4"
          : "opacity-100 translate-x-0",
        typeStyles[notification.type],
      )}
      role="alert"
      onClick={handleDismiss}
    >
      <span className="mt-0.5 flex-shrink-0 text-base font-bold leading-none">
        {typeIcons[notification.type]}
      </span>
      <div className="flex-1 min-w-0">
        <p data-slot="toast-title" className="font-medium truncate">
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-xs mt-0.5 opacity-80 line-clamp-2">
            {notification.message}
          </p>
        )}
      </div>
      <button
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity -mr-1 -mt-1 p-1"
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        aria-label="Dismiss"
      >
        \u2715
      </button>
    </div>
  );
}

export function NotificationToast() {
  const notifications = useNotificationStore((s) => s.notifications);
  const removeNotification = useNotificationStore((s) => s.removeNotification);

  if (notifications.length === 0) return null;

  return (
    <div
      data-slot="toast-viewport"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto w-full animate-in slide-in-from-right-4 fade-in duration-200"
        >
          <ToastItem
            notification={n}
            onDismiss={() => removeNotification(n.id)}
          />
        </div>
      ))}
    </div>
  );
}

export function NotificationHistoryPanel() {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={panelRef} className="relative">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent/50"
        onClick={() => setOpen(!open)}
        aria-label="Notification history"
      >
        <span>{'\u{1F514}'}</span>
        {history.length > 0 && (
          <span className="tabular-nums">{history.length}</span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border bg-popover p-2 shadow-xl z-50">
          <div className="flex items-center justify-between px-2 py-1 border-b mb-1">
            <span className="text-xs font-medium text-muted-foreground">
              Notifications ({history.length})
            </span>
            {history.length > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={clearHistory}
              >
                Clear all
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No notifications
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {[...history].reverse().map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
                    typeStyles[n.type],
                  )}
                >
                  <span className="mt-0.5 flex-shrink-0">{typeIcons[n.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{n.title}</p>
                    {n.message && (
                      <p className="opacity-70 truncate">{n.message}</p>
                    )}
                  </div>
                  <span className="flex-shrink-0 opacity-50 tabular-nums">
                    {formatRelativeTime(n.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}