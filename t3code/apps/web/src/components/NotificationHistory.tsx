"use client";

import { useCallback } from "react";
import {
  InfoIcon,
  CircleCheckBigIcon,
  TriangleAlertIcon,
  CircleAlertIcon,
  Trash2Icon,
  CheckCheckIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Sheet,
  SheetTrigger,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetPanel,
  SheetFooter,
} from "~/components/ui/sheet";
import {
  useNotificationStore,
  type Notification,
  type NotificationType,
} from "~/notificationStore";

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const iconByType: Record<NotificationType, React.ReactNode> = {
  info: <InfoIcon className="size-4" />,
  success: <CircleCheckBigIcon className="size-4" />,
  warning: <TriangleAlertIcon className="size-4" />,
  error: <CircleAlertIcon className="size-4" />,
};

const labelByType: Record<NotificationType, string> = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  error: "Error",
};

const colorByType: Record<NotificationType, string> = {
  info: "text-info-foreground",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
};

// ---------------------------------------------------------------------------
// Single notification row
// ---------------------------------------------------------------------------

function NotificationRow({ notification }: { notification: Notification }) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
        !notification.read && "bg-accent/40",
      )}
      data-slot="notification-history-row"
      data-read={notification.read}
    >
      <span className={cn("mt-0.5 shrink-0", colorByType[notification.type])}>
        {iconByType[notification.type]}
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-foreground break-words">{notification.message}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatTimestamp(notification.createdAt)}
        </p>
      </div>

      {!notification.read && (
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0"
          onClick={() => markAsRead(notification.id)}
          aria-label="Mark as read"
        >
          <CheckCheckIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Grouped section
// ---------------------------------------------------------------------------

function GroupedNotifications({
  type,
  notifications,
}: {
  type: NotificationType;
  notifications: Notification[];
}) {
  if (notifications.length === 0) return null;

  return (
    <div data-slot="notification-history-group">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn("shrink-0", colorByType[type])}>{iconByType[type]}</span>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {labelByType[type]}
        </span>
        <span className="text-xs text-muted-foreground/60">{notifications.length}</span>
      </div>
      {notifications.map((n) => (
        <NotificationRow key={n.id} notification={n} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History panel content (used inside the sheet)
// ---------------------------------------------------------------------------

function HistoryPanelContent() {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const markAsRead = useNotificationStore((s) => s.markAsRead);

  const hasUnread = history.some((n) => !n.read);

  const handleMarkAllRead = useCallback(() => {
    for (const n of history) {
      if (!n.read) markAsRead(n.id);
    }
  }, [history, markAsRead]);

  // Group by type preserving insertion order within each group
  const grouped = {
    error: history.filter((n) => n.type === "error"),
    warning: history.filter((n) => n.type === "warning"),
    success: history.filter((n) => n.type === "success"),
    info: history.filter((n) => n.type === "info"),
  };

  const hasAny = history.length > 0;

  return (
    <>
      <SheetHeader>
        <SheetTitle>Notifications</SheetTitle>
        <SheetDescription>
          {hasAny
            ? `${history.length} notification${history.length !== 1 ? "s" : ""} in history`
            : "No notifications yet"}
        </SheetDescription>
      </SheetHeader>

      {hasAny && (
        <SheetFooter variant="bare">
          <div className="flex gap-2">
            {hasUnread && (
              <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
                <CheckCheckIcon className="size-3.5" />
                Mark all read
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={clearHistory}>
              <Trash2Icon className="size-3.5" />
              Clear all
            </Button>
          </div>
        </SheetFooter>
      )}

      <SheetPanel>
        {!hasAny && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Notifications you&apos;ve received will appear here.
          </p>
        )}

        {hasAny && (
          <div className="flex flex-col gap-1">
            <GroupedNotifications type="error" notifications={grouped.error} />
            {grouped.error.length > 0 && grouped.warning.length > 0 && <Separator />}
            <GroupedNotifications type="warning" notifications={grouped.warning} />
            {grouped.warning.length > 0 && grouped.success.length > 0 && <Separator />}
            <GroupedNotifications type="success" notifications={grouped.success} />
            {grouped.success.length > 0 && grouped.info.length > 0 && <Separator />}
            <GroupedNotifications type="info" notifications={grouped.info} />
          </div>
        )}
      </SheetPanel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Notification history trigger button + sheet
// ---------------------------------------------------------------------------

export function NotificationHistory() {
  const history = useNotificationStore((s) => s.history);
  const unreadCount = history.filter((n) => !n.read).length;

  return (
    <Sheet>
      <SheetTrigger
        aria-label="Notification history"
        data-slot="notification-history-trigger"
        className="relative"
      >
        <span className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <InfoIcon className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </span>
      </SheetTrigger>
      <SheetPopup side="right" showCloseButton>
        <HistoryPanelContent />
      </SheetPopup>
    </Sheet>
  );
}
