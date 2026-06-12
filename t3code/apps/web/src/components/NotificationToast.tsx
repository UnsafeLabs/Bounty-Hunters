import { useState } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
  BellIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { useNotificationStore } from "~/stores/notificationStore";
import type { NotificationType } from "~/stores/notificationStore";

const ICON_MAP: Record<NotificationType, typeof CircleCheckIcon> = {
  success: CircleCheckIcon,
  error: CircleAlertIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
};

const COLOR_MAP: Record<NotificationType, string> = {
  success: "text-success",
  error: "text-destructive",
  warning: "text-warning",
  info: "text-info",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  const s = d.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function NotificationHistoryPanel() {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="relative inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-label="Notification history"
      >
        <BellIcon className="size-3.5" />
        {history.length > 0 ? (
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            {history.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed right-4 top-14 z-50 w-80 rounded-lg border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="text-sm font-medium">Notifications</h3>
            <div className="flex items-center gap-1">
              {history.length > 0 ? (
                <button
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={clearHistory}
                  type="button"
                >
                  Clear all
                </button>
              ) : null}
              <button
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setOpen(false)}
                type="button"
                aria-label="Close"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              history.map((n) => {
                const Icon = ICON_MAP[n.type];
                return (
                  <div
                    key={n.id}
                    className="flex items-start gap-2.5 border-b border-border/50 px-4 py-2.5 last:border-b-0"
                  >
                    <Icon className={cn("mt-0.5 size-3.5 shrink-0", COLOR_MAP[n.type])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{n.title}</p>
                      {n.description ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {n.description}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        {formatTimestamp(n.timestamp)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export { useNotificationStore } from "~/stores/notificationStore";
export type { NotificationType, Notification } from "~/stores/notificationStore";
