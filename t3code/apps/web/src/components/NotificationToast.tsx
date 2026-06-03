import React, { useEffect, useState } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Notification, useNotificationStore } from "../stores/notificationStore";

function ToastItem({ notification }: { notification: Notification }) {
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const [isMounted, setIsMounted] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Slide in from right on mount
    const frame = requestAnimationFrame(() => setIsMounted(true));

    const duration = notification.duration ?? 5000;
    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [notification.duration]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      removeNotification(notification.id);
    }, 300); // Wait for exit transition to complete
  };

  const Icon = (() => {
    switch (notification.type) {
      case "success":
        return <CircleCheckIcon className="size-5 text-emerald-500 shrink-0" />;
      case "error":
        return <CircleAlertIcon className="size-5 text-rose-500 shrink-0" />;
      case "warning":
        return <TriangleAlertIcon className="size-5 text-amber-500 shrink-0" />;
      case "info":
      default:
        return <InfoIcon className="size-5 text-sky-500 shrink-0" />;
    }
  })();

  const bgBorderClass = (() => {
    switch (notification.type) {
      case "success":
        return "bg-emerald-50/95 dark:bg-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/30";
      case "error":
        return "bg-rose-50/95 dark:bg-rose-950/20 border-rose-200/50 dark:border-rose-800/30";
      case "warning":
        return "bg-amber-50/95 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30";
      case "info":
      default:
        return "bg-sky-50/95 dark:bg-sky-950/20 border-sky-200/50 dark:border-sky-800/30";
    }
  })();

  return (
    <div
      onClick={handleDismiss}
      className={`
        flex w-80 items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-xs
        cursor-pointer pointer-events-auto select-none transition-all duration-300 ease-out
        ${bgBorderClass}
        ${isMounted && !isExiting ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}
      `}
    >
      {Icon}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-foreground leading-tight">{notification.title}</h4>
        {notification.description && (
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed break-words">
            {notification.description}
          </p>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        className="text-muted-foreground/60 hover:text-foreground transition-colors p-0.5 rounded-md hover:bg-muted/50"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

export function NotificationToast() {
  const notifications = useNotificationStore((s) => s.notifications);

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} />
      ))}
    </div>
  );
}
