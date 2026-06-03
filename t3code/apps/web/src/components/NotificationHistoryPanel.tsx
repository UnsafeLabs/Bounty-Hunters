import React from "react";
import {
  BellIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useNotificationStore } from "../stores/notificationStore";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetHeader, SheetPanel, SheetTitle } from "./ui/sheet";

interface NotificationHistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationHistoryPanel({ open, onOpenChange }: NotificationHistoryPanelProps) {
  const history = useNotificationStore((s) => s.history);
  const clearHistory = useNotificationStore((s) => s.clearHistory);

  const getIcon = (type: string) => {
    switch (type) {
      case "success":
        return <CircleCheckIcon className="size-5 text-emerald-500 shrink-0" />;
      case "error":
        return <CircleAlertIcon className="size-5 text-rose-500 shrink-0" />;
      case "warning":
        return <TriangleAlertIcon className="size-5 text-amber-500 shrink-0" />;
      case "info":
      default:
        return <InfoIcon className="size-5 text-sky-500 shrink-0" />;
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return (
        date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
        " " +
        date.toLocaleDateString([], { month: "short", day: "numeric" })
      );
    } catch {
      return isoString;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col h-full bg-card border-l border-border text-foreground w-[400px]"
      >
        <SheetHeader className="border-b border-border pb-4 px-6 pt-6">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-semibold">Notification History</SheetTitle>
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1.5 cursor-pointer"
                onClick={clearHistory}
              >
                <Trash2Icon className="size-4" />
                Clear All
              </Button>
            )}
          </div>
        </SheetHeader>

        <SheetPanel className="flex-1 overflow-y-auto p-6">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <BellIcon className="size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground font-medium">No notification history</p>
              <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
                In-app alerts and notifications will appear here once they occur.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 hover:bg-muted/40 transition-colors"
                >
                  {getIcon(item.type)}
                  <div className="flex-1 min-w-0">
                    <h5 className="text-sm font-medium text-foreground leading-tight">
                      {item.title}
                    </h5>
                    {item.description && (
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed break-words">
                        {item.description}
                      </p>
                    )}
                    <span className="mt-2 block text-[10px] text-muted-foreground/60 font-mono">
                      {formatTime(item.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetPanel>
      </SheetContent>
    </Sheet>
  );
}
