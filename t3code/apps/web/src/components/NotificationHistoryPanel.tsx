"use client";

import { useMemo } from "react";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  PanelLeftCloseIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationStore, type Notification, type NotificationType } from "~/notificationStore";

const TYPE_ICONS: Record<NotificationType, typeof CheckIcon> = {
  success: CircleCheckIcon,
  error: CircleAlertIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-info",
};

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NotificationHistoryPanel() {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);

  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [history],
  );

  if (sortedHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <InfoIcon className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No notifications yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Notification History</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={clearHistory}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear notification history"
          >
            Clear all
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-border/50">
          {sortedHistory.map((notification) => (
            <li
              key={notification.id}
              className={cn(
                "group flex items-start gap-2 px-4 py-3 transition-colors hover:bg-muted/30",
              )}
            >
              {(() => {
                const Icon = TYPE_ICONS[notification.type];
                return (
                  <Icon
                    className={cn("mt-0.5 size-4 shrink-0", TYPE_COLORS[notification.type])}
                  />
                );
              })()}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {notification.title}
                </p>
                {notification.message && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {notification.message}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  {formatTimeAgo(notification.createdAt)}
                </p>
              </div>
              <button
                onClick={() => dismissNotification(notification.id)}
                className="ml-auto mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
