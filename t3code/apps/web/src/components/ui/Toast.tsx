import React, { useEffect } from 'react';
import { Toast } from '@/lib/toasts';
import { useToastStore } from '@/lib/toasts';

interface ToastProps {
  toast: Toast;
}

export const Toast: React.FC<ToastProps> = ({ toast }) => {
  const removeToast = useToastStore((state) => state.removeToast);

  useEffect(() => {
    const timer = setTimeout(() => {
      removeToast(toast.id);
    }, toast.duration || 5000);
    return () => clearTimeout(timer);
  }, [toast, removeToast]);

  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
  }[toast.type];

  return (
    <div className={`fixed right-4 top-4 z-50 flex items-center p-4 mb-4 text-white rounded-lg shadow-lg transition-all animate-slide-in ${bgColor}`}>
      <div className="mr-3">
        {toast.type === 'success' && <span>✅</span>}
        {toast.type === 'error' && <span>❌</span>}
        {toast.type === 'info' && <span>ℹ️</span>}
        {toast.type === 'warning' && <span>⚠️</span>}
      </div>
      <div className="flex-1 font-medium">{toast.message}</div>
      <button 
        onClick={() => removeToast(toast.id)}
        className="ml-4 hover:text-gray-200"
      >
        ✕
      </button>
    </div>
  );
};
