import { XIcon } from "lucide-react";
import { useNotificationStore, type NotificationType } from "../stores/notificationStore";
import { cn } from "../lib/utils";

const BG_CLASSES: Record<NotificationType, string> = {
  success: "border-green-500/50 bg-green-500/10",
  error: "border-red-500/50 bg-red-500/10",
  info: "border-blue-500/50 bg-blue-500/10",
  warning: "border-yellow-500/50 bg-yellow-500/10",
};

const ICON_CLASSES: Record<NotificationType, string> = {
  success: "text-green-500",
  error: "text-red-500",
  info: "text-blue-500",
  warning: "text-yellow-500",
};

const ICON_LABELS: Record<NotificationType, string> = {
  success: "\u2713",
  error: "\u2717",
  info: "\u2139",
  warning: "\u26A0",
};

export function ToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const removeNotification = useNotificationStore((s) => s.removeNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" data-testid="toast-container">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={cn(
            "flex min-w-72 max-w-96 items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur-sm",
            BG_CLASSES[n.type],
          )}
          role="alert"
        >
          <span className={cn("mt-0.5 text-base leading-none", ICON_CLASSES[n.type])}>
            {ICON_LABELS[n.type]}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{n.title}</p>
            {n.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{n.description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground/60 hover:text-foreground"
            onClick={() => removeNotification(n.id)}
            aria-label="Dismiss"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
