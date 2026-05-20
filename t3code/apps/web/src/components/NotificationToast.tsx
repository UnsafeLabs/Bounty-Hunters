import React, { useEffect, useState } from "react";
import { notificationStore, type NotificationType } from "../notificationStore";

const typeStyles: Record<NotificationType, { bg: string; icon: string; border: string }> = {
  success: { bg: "bg-green-50 dark:bg-green-950", icon: "✓", border: "border-green-400" },
  error: { bg: "bg-red-50 dark:bg-red-950", icon: "✗", border: "border-red-400" },
  warning: { bg: "bg-yellow-50 dark:bg-yellow-950", icon: "⚠", border: "border-yellow-400" },
  info: { bg: "bg-blue-50 dark:bg-blue-950", icon: "ℹ", border: "border-blue-400" },
};

export function NotificationToast() {
  const [notifications, setNotifications] = useState(notificationStore.getNotifications());

  useEffect(() => {
    const unsub = notificationStore.subscribe(() => {
      setNotifications([...notificationStore.getNotifications()]);
    });
    return unsub;
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 max-w-sm">
      {notifications.map((n) => {
        const style = typeStyles[n.type];
        return (
          <div
            key={n.id}
            className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg ${style.bg} ${style.border} animate-in slide-in-from-right`}
            role="alert"
          >
            <span className="text-lg mt-0.5">{style.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-foreground">{n.title}</p>
              {n.message && (
                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
              )}
            </div>
            <button
              onClick={() => notificationStore.removeNotification(n.id)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
