"use client";

import { useEffect, useRef, useState } from "react";
import { XIcon, InfoIcon, CheckCircleIcon, AlertTriangleIcon, AlertCircleIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { useNotificationStore, type NotificationType } from "~/notificationStore";

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const iconByType: Record<NotificationType, React.ReactNode> = {
  info: <InfoIcon className="size-4" />,
  success: <CheckCircleIcon className="size-4" />,
  warning: <AlertTriangleIcon className="size-4" />,
  error: <AlertCircleIcon className="size-4" />,
};

// ---------------------------------------------------------------------------
// Style map
// ---------------------------------------------------------------------------

const styleByType: Record<
  NotificationType,
  { border: string; bg: string; icon: string; bar: string }
> = {
  info: {
    border: "border-info/24",
    bg: "bg-info/8",
    icon: "text-info-foreground",
    bar: "bg-info",
  },
  success: {
    border: "border-success/24",
    bg: "bg-success/8",
    icon: "text-success-foreground",
    bar: "bg-success",
  },
  warning: {
    border: "border-warning/24",
    bg: "bg-warning/8",
    icon: "text-warning-foreground",
    bar: "bg-warning",
  },
  error: {
    border: "border-destructive/24",
    bg: "bg-destructive/8",
    icon: "text-destructive-foreground",
    bar: "bg-destructive",
  },
};

// ---------------------------------------------------------------------------
// Single toast item
// ---------------------------------------------------------------------------

interface ToastItemProps {
  id: string;
  message: string;
  type: NotificationType;
  duration: number;
}

function ToastItem({ id, message, type, duration }: ToastItemProps) {
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);
  const styles = styleByType[type];
  const [progress, setProgress] = useState(100);
  const startRef = useRef(Date.now());
  const frameRef = useRef(0);

  // Animate progress bar when auto-dismiss is active
  useEffect(() => {
    if (duration <= 0) return;

    startRef.current = Date.now();

    function tick() {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [duration]);

  return (
    <div
      role="alert"
      className={cn(
        "relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-lg border p-4 shadow-lg",
        styles.border,
        styles.bg,
      )}
      data-slot="notification-toast"
    >
      {/* Progress bar */}
      {duration > 0 && (
        <div
          className={cn("absolute bottom-0 left-0 h-0.5 transition-none", styles.bar)}
          style={{ width: `${progress}%` }}
        />
      )}

      {/* Icon */}
      <span className={cn("mt-0.5 shrink-0", styles.icon)}>{iconByType[type]}</span>

      {/* Message */}
      <p className="flex-1 text-sm text-foreground">{message}</p>

      {/* Close button */}
      <Button
        size="icon-xs"
        variant="ghost"
        className="shrink-0"
        onClick={() => dismissNotification(id)}
        aria-label="Dismiss"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast container
// ---------------------------------------------------------------------------

export function NotificationToastContainer() {
  const toasts = useNotificationStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed right-4 top-4 z-[100] flex flex-col gap-2"
      data-slot="notification-toast-container"
    >
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
        />
      ))}
    </div>
  );
}
