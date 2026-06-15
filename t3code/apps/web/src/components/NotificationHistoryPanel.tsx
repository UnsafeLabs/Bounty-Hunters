import { useNotificationStore, type ToastNotification } from "../stores/notificationStore";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

const ICON_MAP = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
} as const;

const ICON_COLOR_MAP = {
  success: "text-green-500",
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-blue-500",
} as const;

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;

  return date.toLocaleDateString();
}

function HistoryItem({ notification }: { notification: ToastNotification }) {
  const Icon = ICON_MAP[notification.type];

  return (
    <div className="flex items-start gap-2 rounded-md p-2 hover:bg-muted/50 transition-colors">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOR_MAP[notification.type]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{notification.title}</p>
        {notification.message ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{notification.message}</p>
        ) : null}
        <p className="mt-0.5 text-[10px] text-muted-foreground/60">
          {formatTimestamp(notification.timestamp)}
        </p>
      </div>
    </div>
  );
}

export function NotificationHistoryPanel() {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {history.length > 0 ? (
          <button
            onClick={clearHistory}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Clear history"
            title="Clear all"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <InformationCircleIcon className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No notifications yet</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {[...history].reverse().map((notification) => (
              <HistoryItem key={notification.id} notification={notification} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
