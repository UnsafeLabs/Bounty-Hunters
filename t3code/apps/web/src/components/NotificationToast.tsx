import {
  BellIcon,
  CheckCircleIcon,
  CircleAlertIcon,
  InfoIcon,
  type LucideIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Sheet,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { SidebarMenuButton, SidebarMenuItem } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import {
  type AppNotification,
  NOTIFICATION_HISTORY_LIMIT,
  type NotificationType,
  useNotificationStore,
} from "~/stores/notificationStore";

type NotificationPhase = "entering" | "visible" | "exiting";

const notificationStyles: Record<
  NotificationType,
  {
    Icon: LucideIcon;
    toastClassName: string;
    iconClassName: string;
    historyDotClassName: string;
    label: string;
  }
> = {
  success: {
    Icon: CheckCircleIcon,
    toastClassName: "border-success/35 bg-success/10 text-success-foreground",
    iconClassName: "text-success",
    historyDotClassName: "bg-success",
    label: "Success",
  },
  error: {
    Icon: CircleAlertIcon,
    toastClassName: "border-destructive/35 bg-destructive/10 text-destructive-foreground",
    iconClassName: "text-destructive",
    historyDotClassName: "bg-destructive",
    label: "Error",
  },
  warning: {
    Icon: TriangleAlertIcon,
    toastClassName: "border-warning/35 bg-warning/10 text-warning-foreground",
    iconClassName: "text-warning",
    historyDotClassName: "bg-warning",
    label: "Warning",
  },
  info: {
    Icon: InfoIcon,
    toastClassName: "border-info/35 bg-info/10 text-info-foreground",
    iconClassName: "text-info",
    historyDotClassName: "bg-info",
    label: "Info",
  },
};

function formatNotificationTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function NotificationToastItem({ notification }: { notification: AppNotification }) {
  const [phase, setPhase] = useState<NotificationPhase>("entering");
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const exitTimerRef = useRef<number | null>(null);
  const dismissedRef = useRef(false);
  const { Icon, toastClassName, iconClassName } = notificationStyles[notification.type];

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setPhase("exiting");
    exitTimerRef.current = window.setTimeout(() => {
      dismissNotification(notification.id);
    }, 180);
  }, [dismissNotification, notification.id]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPhase("visible"));
    return () => {
      window.cancelAnimationFrame(frame);
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (notification.duration === null || notification.duration <= 0) {
      return;
    }

    const timer = window.setTimeout(dismiss, notification.duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, notification.duration]);

  return (
    <button
      aria-label={`Dismiss ${notification.type} notification: ${notification.title}`}
      className={cn(
        "pointer-events-auto flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-left shadow-lg/5 outline-none backdrop-blur-sm",
        "transition-[transform,opacity,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        "hover:shadow-xl/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        toastClassName,
        phase === "entering" && "translate-x-full opacity-0",
        phase === "visible" && "translate-x-0 opacity-100",
        phase === "exiting" && "translate-x-0 opacity-0",
      )}
      onClick={dismiss}
      type="button"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClassName)} strokeWidth={2.25} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="min-w-0 wrap-break-word text-sm font-medium">{notification.title}</span>
        {notification.message ? (
          <span className="min-w-0 wrap-break-word text-xs leading-5 text-foreground/72">
            {notification.message}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function NotificationToast() {
  const notifications = useNotificationStore((state) => state.notifications);

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed right-4 top-[calc(52px+1rem)] z-[120] flex w-[calc(100vw-2rem)] max-w-90 flex-col gap-2 sm:right-8 sm:top-[calc(52px+2rem)]"
    >
      {notifications.map((notification) => (
        <NotificationToastItem key={notification.id} notification={notification} />
      ))}
    </div>
  );
}

export function NotificationHistoryPanel() {
  const history = useNotificationStore((state) => state.history);
  const clearHistory = useNotificationStore((state) => state.clearHistory);
  const [open, setOpen] = useState(false);
  const newestTimestamp = history[0]?.createdAt ?? null;
  const summaryLabel = useMemo(() => {
    if (history.length === 0) {
      return "No notifications";
    }
    const latest = newestTimestamp ? formatNotificationTimestamp(newestTimestamp) : "";
    return latest ? `${history.length} notifications, latest ${latest}` : `${history.length} notifications`;
  }, [history.length, newestTimestamp]);

  return (
    <SidebarMenuItem>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <SidebarMenuButton
              size="sm"
              className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            />
          }
        >
          <BellIcon className="size-3.5" />
          <span className="flex-1 text-xs">Notifications</span>
          {history.length > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {Math.min(history.length, NOTIFICATION_HISTORY_LIMIT)}
            </span>
          ) : null}
        </SheetTrigger>
        <SheetPopup side="right">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
            <p className="text-sm text-muted-foreground">{summaryLabel}</p>
          </SheetHeader>
          <SheetPanel className="space-y-3">
            {history.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              <ScrollArea className="max-h-[min(32rem,calc(100svh-12rem))]" scrollFade>
                <ol className="space-y-2 pr-2">
                  {history.map((notification) => {
                    const styles = notificationStyles[notification.type];
                    const Icon = styles.Icon;
                    return (
                      <li
                        className="rounded-lg border border-border/70 bg-background/55 px-3 py-2.5"
                        key={notification.id}
                      >
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span
                            aria-hidden="true"
                            className={cn(
                              "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted",
                              styles.historyDotClassName,
                            )}
                          >
                            <Icon className="size-3 text-white" strokeWidth={2.4} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                                {notification.title}
                              </p>
                              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {styles.label}
                              </span>
                            </div>
                            {notification.message ? (
                              <p className="mt-0.5 wrap-break-word text-xs leading-5 text-muted-foreground">
                                {notification.message}
                              </p>
                            ) : null}
                            <time
                              className="mt-1 block text-[11px] text-muted-foreground/72"
                              dateTime={notification.createdAt}
                            >
                              {formatNotificationTimestamp(notification.createdAt)}
                            </time>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </ScrollArea>
            )}
          </SheetPanel>
          <SheetFooter>
            <Button
              disabled={history.length === 0}
              onClick={clearHistory}
              size="sm"
              variant="outline"
            >
              Clear history
            </Button>
          </SheetFooter>
        </SheetPopup>
      </Sheet>
    </SidebarMenuItem>
  );
}
