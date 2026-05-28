"use client";

import { useMemo } from "react";
import {
  CircleCheckIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
  InfoIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationStore } from "~/stores/notificationStore";
import type { Notification } from "~/stores/notificationStore";

const ICON_MAP = {
  success: CircleCheckIcon,
  error: CircleAlertIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
} as const;

const ICON_COLOR_CLASSES: Record<Notification["type"], string> = {
  success: "text-green-500 dark:text-green-400",
  error: "text-red-500 dark:text-red-400",
  warning: "text-amber-500 dark:text-amber-400",
  info: "text-blue-500 dark:text-blue-400",
};

interface GroupedNotifications {
  label: string;
  items: Notification[];
}

function groupByDate(notifications: Notification[]): GroupedNotifications[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: Map<string, Notification[]> = new Map();

  for (const notif of notifications) {
    const date = new Date(notif.timestamp);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    let label: string;
    if (dayStart.getTime() === today.getTime()) {
      label = "Today";
    } else if (dayStart.getTime() === yesterday.getTime()) {
      label = "Yesterday";
    } else {
      label = date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      });
    }

    const existing = groups.get(label);
    if (existing) {
      existing.push(notif);
    } else {
      groups.set(label, [notif]);
    }
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NotificationItem({
  notification,
}: {
  notification: Notification;
}) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const { type, title, message, timestamp, read, id } = notification;
  const Icon = ICON_MAP[type];

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-muted/50",
        !read && "bg-muted/30",
      )}
      onClick={() => markAsRead(id)}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", ICON_COLOR_CLASSES[type])}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              "text-sm font-medium",
              !read && "font-semibold",
            )}
          >
            {title}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatTime(timestamp)}
          </span>
        </div>
        {message && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
            {message}
          </p>
        )}
      </div>
      {!read && (
        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

export function NotificationHistoryPanel() {
  const notifications = useNotificationStore((s) => s.notifications);
  const clearHistory = useNotificationStore((s) => s.clearHistory);

  const grouped = useMemo(() => groupByDate(notifications), [notifications]);

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
        <InfoIcon className="size-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No notifications yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">Notifications</h3>
        <button
          type="button"
          onClick={clearHistory}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2Icon className="size-3" />
          Clear all
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-1">
        {grouped.map((group) => (
          <div key={group.label}>
            <p className="sticky top-0 z-10 bg-background/95 px-2 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
