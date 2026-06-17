import React from 'react';
import { useToastStore } from '@/lib/toasts';

export const ToastHistory: React.FC = () => {
  const { toasts, clearAll } = useToastStore();

  if (toasts.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm italic">
        No notifications yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold">Notification History</h3>
        <button 
          onClick={clearAll}
          className="text-xs text-red-500 hover:underline"
        >
          Clear All
        </button>
      </div>
      <div className="overflow-y-auto flex-1 space-y-2">
        {toasts.map((toast) => (
          <div key={toast.id} className="p-2 text-sm border-b border-gray-200 dark:border-gray-700 flex justify-between">
            <span>
              <span className="font-semibold">[{toast.type.toUpperCase()}]</span> {toast.message}
            </span>
            <span className="text-gray-400 text-xs">
              {new Date(toast.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
