"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  CircleCheckIcon,
  CircleAlertIcon,
  TriangleAlertIcon,
  InfoIcon,
  XIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  type Notification,
  useNotificationStore,
} from "~/stores/notificationStore";

const ICON_MAP = {
  success: CircleCheckIcon,
  error: CircleAlertIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
} as const;

const COLOR_CLASSES: Record<Notification["type"], string> = {
  success: "border-green-500/50 bg-green-50 text-green-800 dark:border-green-600/40 dark:bg-green-950/60 dark:text-green-300",
  error: "border-red-500/50 bg-red-50 text-red-800 dark:border-red-600/40 dark:bg-red-950/60 dark:text-red-300",
  warning: "border-amber-500/50 bg-amber-50 text-amber-800 dark:border-amber-600/40 dark:bg-amber-950/60 dark:text-amber-300",
  info: "border-blue-500/50 bg-blue-50 text-blue-800 dark:border-blue-600/40 dark:bg-blue-950/60 dark:text-blue-300",
};

const ICON_COLOR_CLASSES: Record<Notification["type"], string> = {
  success: "text-green-500 dark:text-green-400",
  error: "text-red-500 dark:text-red-400",
  warning: "text-amber-500 dark:text-amber-400",
  info: "text-blue-500 dark:text-blue-400",
};

interface ToastItemProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

function ToastProgressBar({ durationMs = 5000 }: { durationMs?: number }) {
  const [progress, setProgress] = useState(100);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    startRef.current = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / durationMs) * 100);
      setProgress(remaining);

      if (remaining > 0) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [durationMs]);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-lg">
      <div
        className="h-full bg-current opacity-30 transition-[width] duration-75 ease-linear"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function ToastItem({ notification, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const { type, title, message, id } = notification;
  const Icon = ICON_MAP[type];

  useEffect(() => {
    // Trigger enter animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(id), 200);
  }, [id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "relative flex w-full max-w-sm cursor-pointer items-start gap-3 rounded-lg border p-3 shadow-lg transition-all duration-200 ease-out",
        COLOR_CLASSES[type],
        // Enter: slide in from right
        visible && !exiting
          ? "translate-x-0 opacity-100"
          : "translate-x-4 opacity-0",
        // Exit: fade out
        exiting && "opacity-0",
      )}
      onClick={handleDismiss}
    >
      <Icon
        className={cn("mt-0.5 size-5 shrink-0", ICON_COLOR_CLASSES[type])}
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{title}</p>
        {message && (
          <p className="mt-0.5 text-xs opacity-85">{message}</p>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        className="shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss notification"
      >
        <XIcon className="size-4" />
      </button>

      <ToastProgressBar />
    </div>
  );
}

export function NotificationToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2"
    >
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <ToastItem
            notification={notification}
            onDismiss={dismissNotification}
          />
        </div>
      ))}
    </div>
  );
}
