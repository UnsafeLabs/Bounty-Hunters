import React, { useEffect, useState } from 'react';
import { useNotificationStore, Notification } from '../stores/notificationStore';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle className="w-5 h-5 text-green-500" />,
  error: <AlertCircle className="w-5 h-5 text-red-500" />,
  warning: <AlertTriangle className="w-5 h-5 text-yellow-500" />,
  info: <Info className="w-5 h-5 text-blue-500" />,
};

const BORDERS = {
  success: 'border-green-500',
  error: 'border-red-500',
  warning: 'border-yellow-500',
  info: 'border-blue-500',
};

function Toast({ notification }: { notification: Notification }) {
  const removeNotification = useNotificationStore((state) => state.removeNotification);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    const duration = notification.duration || 5000;
    const timer = setTimeout(() => {
      setIsLeaving(true);
      setTimeout(() => removeNotification(notification.id), 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [notification, removeNotification]);

  const handleDismiss = () => {
    setIsLeaving(true);
    setTimeout(() => removeNotification(notification.id), 300);
  };

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-card border ${
        BORDERS[notification.type]
      } shadow-lg ring-1 ring-black ring-opacity-5 transition-all duration-300 ease-in-out cursor-pointer ${
        isLeaving ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
      } animate-in slide-in-from-right`}
      onClick={handleDismiss}
      role="button"
      tabIndex={0}
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">{ICONS[notification.type]}</div>
          <div className="ml-3 w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">{notification.message}</p>
          </div>
          <div className="ml-4 flex flex-shrink-0">
            <button
              type="button"
              className="inline-flex rounded-md bg-transparent text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
            >
              <span className="sr-only">Close</span>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationToastContainer() {
  const notifications = useNotificationStore((state) => state.notifications);

  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-0 z-[100] flex items-end px-4 py-6 sm:items-start sm:p-6"
    >
      <div className="flex w-full flex-col items-center space-y-4 sm:items-end">
        {notifications.map((notification) => (
          <Toast key={notification.id} notification={notification} />
        ))}
      </div>
    </div>
  );
}
