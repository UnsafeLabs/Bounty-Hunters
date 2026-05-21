import { useEffect, useRef } from "react";
import { CheckCircleIcon, XCircleIcon, AlertTriangleIcon, InfoIcon, XIcon } from "lucide-react";
import { useNotificationStore, type Notification, type NotificationType } from "../stores/notificationStore";
import { autoAnimate } from "@formkit/auto-animate";

const TYPE_STYLES: Record<NotificationType, { bg: string; border: string; icon: typeof CheckCircleIcon; iconColor: string }> = {
  success: {
    bg: "bg-success/10",
    border: "border-success/30",
    icon: CheckCircleIcon,
    iconColor: "text-success",
  },
  error: {
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    icon: XCircleIcon,
    iconColor: "text-destructive",
  },
  warning: {
    bg: "bg-warning/10",
    border: "border-warning/30",
    icon: AlertTriangleIcon,
    iconColor: "text-warning",
  },
  info: {
    bg: "bg-info/10",
    border: "border-info/30",
    icon: InfoIcon,
    iconColor: "text-info",
  },
};

interface ToastProps {
  notification: Notification;
}

function Toast({ notification }: ToastProps) {
  const removeNotification = useNotificationStore((s) => s.removeNotification);
  const { bg, border, icon: Icon, iconColor } = TYPE_STYLES[notification.type];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      autoAnimate(ref.current);
    }
  }, []);

  return (
    <div
      ref={ref}
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-md ${bg} ${border}`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
      <span className="text-sm flex-1 text-foreground">{notification.message}</span>
      <button
        onClick={() => removeNotification(notification.id)}
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <XIcon className="w-3 h-3" />
      </button>
    </div>
  );
}

export function NotificationToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      autoAnimate(ref.current, { duration: 200 });
    }
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm">
      <div ref={ref}>
        {notifications.map((n) => (
          <Toast key={n.id} notification={n} />
        ))}
      </div>
    </div>
  );
}