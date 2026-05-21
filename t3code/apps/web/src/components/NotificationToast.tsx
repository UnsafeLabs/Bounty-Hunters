import React from "react";
import { useShallow } from "zustand/react/shallow";
import { useNotificationStore, type ToastType } from "../stores/notificationStore";

const iconMap: Record<ToastType, string> = {
  success: "✓",
  error: "✗",
  info: "ℹ",
  warning: "⚠",
};

const colorMap: Record<ToastType, string> = {
  success: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-blue-600 text-white",
  warning: "bg-yellow-500 text-black",
};

export function NotificationToast() {
  const { toasts, removeToast } = useNotificationStore(
    useShallow((s) => ({ toasts: s.toasts, removeToast: s.removeToast })),
  );

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 rounded px-4 py-2 shadow-lg transition-all ${colorMap[toast.type]}`}
          role="alert"
        >
          <span>{iconMap[toast.type]}</span>
          <span className="flex-1 text-sm">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-2 text-white/80 hover:text-white"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
