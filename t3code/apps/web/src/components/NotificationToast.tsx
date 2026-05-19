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
          <div key={notif.id} className={`${style.bg} ${style.border} border-l-4 rounded-lg p-4 shadow-lg`} role="alert">
            <div className="flex items-start gap-3">
              <span className="text-lg">{style.icon}</span>
              <div className="flex-1">
                <p className="font-medium text-sm">{notif.title}</p>
                {notif.message && <p className="text-xs text-gray-600 mt-1">{notif.message}</p>}
              </div>
              <button onClick={() => dismissNotification(notif.id)} className="text-gray-400 hover:text-gray-600" aria-label="Dismiss">✕</button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NotificationToast;
