import { useEffect, useRef, useState } from "react";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useNotificationStore, type ToastNotification } from "../stores/notificationStore";

const ICON_MAP = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
} as const;

const COLOR_MAP = {
  success:
    "border-green-500 bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200",
  error: "border-red-500 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200",
  warning:
    "border-amber-500 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200",
  info: "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-200",
} as const;

function ToastItem({ notification }: { notification: ToastNotification }) {
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    const enterTimer = requestAnimationFrame(() => setVisible(true));

    let dismissTimer: ReturnType<typeof setTimeout>;
    if (notification.duration && notification.duration > 0) {
      dismissTimer = setTimeout(() => setVisible(false), notification.duration);
    }

    return () => {
      cancelAnimationFrame(enterTimer);
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [notification.id, notification.duration]);

  const handleTransitionEnd = () => {
    if (!visible) {
      removeNotification(notification.id);
    }
  };

  const Icon = ICON_MAP[notification.type];

  return (
    <div
      className={`pointer-events-auto flex w-80 items-start gap-3 rounded-lg border-l-4 p-3 shadow-lg transition-all duration-300 ${
        visible
          ? "translate-x-0 opacity-100"
          : "translate-x-full opacity-0"
      } ${COLOR_MAP[notification.type]}`}
      onTransitionEnd={handleTransitionEnd}
      role="alert"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{notification.title}</p>
        {notification.message ? (
          <p className="mt-0.5 text-sm opacity-90">{notification.message}</p>
        ) : null}
      </div>
      <button
        onClick={() => setVisible(false)}
        className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export function NotificationToast() {
  const notifications = useNotificationStore((s) => s.notifications);

  if (notifications.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2"
      aria-live="polite"
      aria-label="Notifications"
    >
      {notifications.map((notification) => (
        <ToastItem key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
