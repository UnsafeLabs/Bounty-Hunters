"use client";

import { useEffect, useState } from "react";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationStore, type NotificationType } from "~/notificationStore";

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

export function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: Parameters<typeof useNotificationStore.getState>[0];
  onDismiss: () => void;
}) {
  const Icon = TYPE_ICONS[notification.type];
  const colorClass = TYPE_COLORS[notification.type];

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-lg border bg-popover px-3 py-2.5 shadow-sm transition-all hover:bg-muted/40",
        "animate-in slide-in-from-right-full duration-300",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", colorClass)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{notification.title}</p>
        {notification.message && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {notification.message}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="ml-auto mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-80 transition-colors hover:text-foreground"
        aria-label="Dismiss notification"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

export function NotificationToastContainer() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={() => dismissNotification(notification.id)}
        />
      ))}
    </div>
  );
}
