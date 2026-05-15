import { BellIcon, CheckIcon, InfoIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { SidebarMenuButton } from "./ui/sidebar";
import { cn } from "~/lib/utils";
import {
  type NotificationRecord,
  type NotificationType,
  useNotificationStore,
} from "../stores/notificationStore";

const DISMISS_ANIMATION_MS = 180;

const notificationStyles: Record<
  NotificationType,
  {
    icon: typeof CheckIcon;
    iconClassName: string;
    itemClassName: string;
  }
> = {
  success: {
    icon: CheckIcon,
    iconClassName: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    itemClassName: "border-emerald-500/28 bg-emerald-500/8",
  },
  error: {
    icon: XIcon,
    iconClassName: "bg-red-500/12 text-red-700 dark:text-red-300",
    itemClassName: "border-red-500/28 bg-red-500/8",
  },
  warning: {
    icon: TriangleAlertIcon,
    iconClassName: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
    itemClassName: "border-amber-500/32 bg-amber-500/10",
  },
  info: {
    icon: InfoIcon,
    iconClassName: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    itemClassName: "border-sky-500/28 bg-sky-500/8",
  },
};

const historyTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationToast() {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(() => new Set());
  const closingTimersRef = useRef(new Map<string, number>());

  const closeNotification = useCallback(
    (id: string) => {
      if (closingTimersRef.current.has(id)) {
        return;
      }

      setClosingIds((previous) => {
        const next = new Set(previous);
        next.add(id);
        return next;
      });

      const timeoutId = window.setTimeout(() => {
        dismissNotification(id);
        closingTimersRef.current.delete(id);
        setClosingIds((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }, DISMISS_ANIMATION_MS);

      closingTimersRef.current.set(id, timeoutId);
    },
    [dismissNotification],
  );

  useEffect(() => {
    return () => {
      closingTimersRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      closingTimersRef.current.clear();
    };
  }, []);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 sm:right-6"
    >
      {notifications.map((notification) => (
        <NotificationToastItem
          closing={closingIds.has(notification.id)}
          key={notification.id}
          notification={notification}
          onDismiss={closeNotification}
        />
      ))}
    </div>
  );
}

function NotificationToastItem({
  closing,
  notification,
  onDismiss,
}: {
  closing: boolean;
  notification: NotificationRecord;
  onDismiss: (id: string) => void;
}) {
  const Icon = notificationStyles[notification.type].icon;

  useEffect(() => {
    if (notification.duration <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => onDismiss(notification.id), notification.duration);
    return () => window.clearTimeout(timeoutId);
  }, [notification.duration, notification.id, onDismiss]);

  return (
    <button
      aria-label={`Dismiss ${notification.type} notification: ${notification.title}`}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 rounded-lg border bg-popover/96 p-3 text-left text-popover-foreground shadow-lg shadow-black/8 backdrop-blur-md transition-all duration-200 ease-out motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4",
        notificationStyles[notification.type].itemClassName,
        closing && "translate-x-3 scale-[0.98] opacity-0",
      )}
      onClick={() => onDismiss(notification.id)}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          notificationStyles[notification.type].iconClassName,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{notification.title}</span>
        {notification.description ? (
          <span className="mt-1 block line-clamp-3 text-muted-foreground text-xs leading-relaxed">
            {notification.description}
          </span>
        ) : null}
      </span>
      <XIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export function NotificationHistoryButton({ className }: { className?: string }) {
  const history = useNotificationStore((state) => state.history);
  const clearHistory = useNotificationStore((state) => state.clearHistory);
  const historyItems = useMemo(() => history, [history]);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <SidebarMenuButton
            className={cn(
              "gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground",
              className,
            )}
            size="sm"
            tooltip="Notifications"
            type="button"
          />
        }
      >
        <BellIcon className="size-3.5" />
        <span className="text-xs">Notifications</span>
      </DialogTrigger>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Notification history</DialogTitle>
          <DialogDescription>Last 50 notifications with timestamps.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          {historyItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 px-4 py-8 text-center text-muted-foreground text-sm">
              No notifications yet.
            </div>
          ) : (
            <ol className="space-y-2">
              {historyItems.map((notification) => (
                <NotificationHistoryItem key={notification.id} notification={notification} />
              ))}
            </ol>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button disabled={historyItems.length === 0} onClick={clearHistory} variant="outline">
            <Trash2Icon />
            Clear history
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function NotificationHistoryItem({ notification }: { notification: NotificationRecord }) {
  const Icon = notificationStyles[notification.type].icon;
  const timestamp = historyTimeFormatter.format(new Date(notification.createdAt));

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card/72 p-3",
        notificationStyles[notification.type].itemClassName,
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          notificationStyles[notification.type].iconClassName,
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium">{notification.title}</span>
          <time
            className="shrink-0 text-muted-foreground text-xs"
            dateTime={notification.createdAt}
          >
            {timestamp}
          </time>
        </span>
        {notification.description ? (
          <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">
            {notification.description}
          </span>
        ) : null}
      </span>
    </li>
  );
}
