import React from "react";
import { useNotificationStore, NotificationType } from "../stores/notificationStore";

const typeStyles: Record<NotificationType, { bg: string; icon: string; border: string }> = {
  success: { bg: "bg-green-50", icon: "✓", border: "border-green-400" },
  error: { bg: "bg-red-50", icon: "✕", border: "border-red-400" },
  warning: { bg: "bg-yellow-50", icon: "⚠", border: "border-yellow-400" },
  info: { bg: "bg-blue-50", icon: "ℹ", border: "border-blue-400" },
};

export const NotificationToast: React.FC = () => {
  const { notifications, dismissNotification } = useNotificationStore();

  const active = notifications.filter((n) => !n.dismissed);

  if (active.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {active.map((notif) => {
        const style = typeStyles[notif.type];
        return (
          <div
            key={notif.id}
            className={`\${style.bg} \${style.border} border-l-4 rounded-lg p-4 shadow-lg notification-enter`}
            role="alert"
          >
            <div className="flex items-start gap-3">
              <span className="text-lg">{style.icon}</span>
              <div className="flex-1">
                <p className="font-medium text-sm">{notif.title}</p>
                {notif.message && (
                  <p className="text-xs text-gray-600 mt-1">{notif.message}</p>
                )}
              </div>
              <button
                onClick={() => dismissNotification(notif.id)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const NotificationHistory: React.FC = () => {
  const { history, clearHistory } = useNotificationStore();

  return (
    <div className="notification-history">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Notification History</h3>
        <button
          onClick={clearHistory}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Clear
        </button>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-gray-400">No notifications yet</p>
      ) : (
        <ul className="space-y-2">
          {history.map((notif) => {
            const style = typeStyles[notif.type];
            return (
              <li key={notif.id} className={`\${style.bg} rounded p-3 text-sm`}>
                <span className="mr-2">{style.icon}</span>
                <span className="font-medium">{notif.title}</span>
                {notif.message && (
                  <p className="text-gray-600 mt-1 ml-6">{notif.message}</p>
                )}
                <span className="text-xs text-gray-400 ml-6">
                  {new Date(notif.createdAt).toLocaleTimeString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default NotificationToast;
