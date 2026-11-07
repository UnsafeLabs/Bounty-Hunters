import { memo, useEffect, useState } from "react";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationStore, type Notification, type NotificationType } from "../stores/notificationStore";

const typeConfig: Record<NotificationType, { icon: typeof CheckCircle; color: string; bgColor: string }> = {
  success: {
    icon: CheckCircle,
    color: "text-green-600",
    bgColor: "bg-green-50 border-green-200",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-600",
    bgColor: "bg-yellow-50 border-yellow-200",
  },
  info: {
    icon: Info,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200",
  },
};

const NotificationToastItem = memo(function NotificationToastItem({
  notification,
}: {
  notification: Notification;
}) {
  const [isExiting, setIsExiting] = useState(false);
  const removeNotification = useNotificationStore((state) => state.removeNotification);
  const config = typeConfig[notification.type];
  const Icon = config.icon;

  useEffect(() => {
    // Trigger enter animation
    const timer = setTimeout(() => {
      setIsExiting(false);
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      removeNotification(notification.id);
    }, 200); // Wait for exit animation
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all duration-200",
        config.bgColor,
        isExiting ? "opacity-0 translate-x-full" : "opacity-100 translate-x-0 animate-slide-in-right",
      )}
      onClick={handleDismiss}
      role="alert"
    >
      <Icon className={cn("size-5 shrink-0 mt-0.5", config.color)} />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{notification.title}</p>
        {notification.message && (
          <p className="text-sm text-muted-foreground mt-1">{notification.message}</p>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        className="shrink-0 rounded-md p-1 hover:bg-black/5 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="size-4 text-muted-foreground" />
      </button>
    </div>
  );
});

export const NotificationToast = memo(function NotificationToast() {
  const notifications = useNotificationStore((state) => state.notifications);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {notifications.map((notification) => (
        <div key={notification.id} className="pointer-events-auto">
          <NotificationToastItem notification={notification} />
        </div>
      ))}
    </div>
  );
});

// Notification history panel
export const NotificationHistoryPanel = memo(function NotificationHistoryPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const history = useNotificationStore((state) => state.history);
  const clearHistory = useNotificationStore((state) => state.clearHistory);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Notification History</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={clearHistory}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear All
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 hover:bg-accent transition-colors"
              aria-label="Close history"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No notifications yet</p>
          ) : (
            <div className="space-y-2">
              {history.map((notification) => {
                const config = typeConfig[notification.type];
                const Icon = config.icon;
                const timestamp = new Date(notification.createdAt).toLocaleString();

                return (
                  <div
                    key={notification.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3",
                      config.bgColor,
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0 mt-0.5", config.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{notification.title}</p>
                      {notification.message && (
                        <p className="text-xs text-muted-foreground mt-1">{notification.message}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">{timestamp}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
