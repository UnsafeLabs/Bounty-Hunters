import React, { useState } from 'react';
import { useNotificationStore } from '../stores/notificationStore';
import { Bell, Trash2, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import {
  Sheet,
  SheetTrigger,
  SheetPopup,
  SheetHeader,
  SheetTitle,
  SheetPanel,
  SheetFooter,
} from './ui/sheet';
import { Button } from './ui/button';

const ICONS = {
  success: <CheckCircle className="w-4 h-4 text-green-500" />,
  error: <AlertCircle className="w-4 h-4 text-red-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  info: <Info className="w-4 h-4 text-blue-500" />,
};

export function NotificationHistoryPanel() {
  const [open, setOpen] = useState(false);
  const history = useNotificationStore((state) => state.history);
  const clearHistory = useNotificationStore((state) => state.clearHistory);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground/70 hover:bg-accent hover:text-foreground rounded-md transition-colors"
          >
            <Bell className="size-3.5" />
            <span className="text-xs">Notifications</span>
          </button>
        }
      />
      <SheetPopup side="right" variant="inset">
        <SheetHeader>
          <SheetTitle>Notification History</SheetTitle>
        </SheetHeader>
        <SheetPanel>
          {history.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-muted-foreground">
              <Bell className="mb-2 h-8 w-8 opacity-20" />
              <p className="text-sm">No recent notifications</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((notification) => (
                <div
                  key={notification.id}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <div className="mt-0.5 shrink-0">{ICONS[notification.type]}</div>
                  <div className="flex-1 space-y-1">
                    <p className="leading-snug text-foreground">{notification.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(notification.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SheetPanel>
        {history.length > 0 && (
          <SheetFooter variant="bare">
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearHistory()}
              className="w-full gap-2"
            >
              <Trash2 className="size-4" />
              Clear History
            </Button>
          </SheetFooter>
        )}
      </SheetPopup>
    </Sheet>
  );
}
