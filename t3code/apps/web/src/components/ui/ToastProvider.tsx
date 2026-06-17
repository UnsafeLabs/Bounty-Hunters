import React from 'react';
import { useToastStore } from '@/lib/toasts';
import { Toast } from '@/components/ui/Toast';

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <>
      {children}
      <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} />
        ))}
      </div>
    </>
  );
};
