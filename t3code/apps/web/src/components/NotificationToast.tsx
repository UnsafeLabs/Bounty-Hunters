import { memo, useCallback } from "react";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { useNotificationStore, type Notification, type NotificationType } from "../stores/notificationStore";

const iconMap: Record<NotificationType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colorMap: Record<NotificationType, string> = {
  success: "text-green-500 bg-green-50 border-green-200",
  error: "text-red-500 bg-red-50 border-red-200",
  warning: "text-yellow-500 bg-yellow-50 border-yellow-200",
  info: "text-blue-500 bg-blue-50 border-blue-200",
};

const ToastItem = memo(function ToastItem({ notification, onDismiss }: { notification: Notification; onDismiss: (id: string) => void }) {
  const Icon = iconMap[notification.type];
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border shadow-lg animate-in slide-in-from-right ${colorMap[notification.type]}`}
      role="alert"
      style={{ minWidth: 320, maxWidth: 420 }}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{notification.title}</p>
        {notification.description && (
          <p className="text-xs mt-1 opacity-80">{notification.description}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(notification.id)}
        className="shrink-0 p-1 rounded hover:bg-black/5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

export const NotificationToastContainer = memo(function NotificationToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismissNotification = useNotificationStore((s) => s.dismissNotification);

  const handleDismiss = useCallback(
    (id: string) => dismissNotification(id),
    [dismissNotification]
  );

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {notifications.map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <ToastItem notification={n} onDismiss={handleDismiss} />
        </div>
      ))}
    </div>
  );
});
