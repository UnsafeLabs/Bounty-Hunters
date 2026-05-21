import { ClockIcon, TrashIcon } from "lucide-react";
import { useNotificationStore, type NotificationType } from "../stores/notificationStore";
import { autoAnimate } from "@formkit/auto-animate";
import { useRef, useEffect } from "react";

const TYPE_COLORS: Record<NotificationType, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-info",
};

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotificationHistoryPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      autoAnimate(ref.current);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClockIcon className="w-4 h-4" />
          Notification History
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clearHistory}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            title="Clear history"
          >
            <TrashIcon className="w-3 h-3" />
            Clear
          </button>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div ref={ref} className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
            No notifications yet
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((n) => (
              <li key={n.id} className="px-4 py-2.5 flex items-start gap-3">
                <span className={`mt-0.5 text-xs font-medium uppercase ${TYPE_COLORS[n.type]}`}>
                  {n.type}
                </span>
                <span className="flex-1 text-sm text-foreground">{n.message}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatTime(n.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}