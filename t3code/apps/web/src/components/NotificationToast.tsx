import React, { useEffect, useState } from "react";
import {
  useNotificationStore,
  type Notification,
  type NotificationType,
} from "../notificationStore";

const TYPE_STYLES: Record<NotificationType, string> = {
  success: "bg-green-500/90 text-white",
  error: "bg-red-500/90 text-white",
  warning: "bg-yellow-500/90 text-black",
  info: "bg-blue-500/90 text-white",
};

const TYPE_ICONS: Record<NotificationType, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
};

function ToastItem({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(notification.id), 200);
  };

  return (
    <div
      className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg transition-all duration-200 cursor-pointer ${
        TYPE_STYLES[notification.type]
      } ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full"}`}
      onClick={handleDismiss}
      role="alert"
    >
      <span className="text-lg font-bold">{TYPE_ICONS[notification.type]}</span>
      <span className="flex-1 text-sm">{notification.message}</span>
      <button
        className="ml-2 opacity-70 hover:opacity-100 text-lg"
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
      >
        ×
      </button>
    </div>
  );
}

export function NotificationToast() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => (
        <ToastItem
          key={n.id}
          notification={n}
          onDismiss={dismissNotification}
        />
      ))}
    </div>
  );
}

export function NotificationHistory() {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="p-2 rounded hover:bg-accent"
        onClick={() => setOpen(!open)}
      >
        🔔
        {history.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
            {history.length > 99 ? "99+" : history.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="font-medium text-sm">Notification History</span>
            <div className="flex gap-2">
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={clearHistory}
              >
                Clear
              </button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {history.map((n) => (
                <div key={n.id} className="px-3 py-2 flex items-start gap-2">
                  <span className="text-sm mt-0.5">{TYPE_ICONS[n.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(n.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
