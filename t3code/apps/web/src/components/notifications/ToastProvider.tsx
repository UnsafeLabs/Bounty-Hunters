import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  timestamp: number;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  history: Toast[];
  showToast: (type: ToastType, message: string, duration?: number) => void;
  dismissToast: (id: string) => void;
  clearHistory: () => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration = 5000) => {
    const id = crypto.randomUUID();
    const toast: Toast = { id, type, message, timestamp: Date.now(), duration };
    setToasts((prev) => [...prev, toast]);
    setHistory((prev) => [toast, ...prev].slice(0, 100));
    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  return (
    <ToastContext.Provider value={{ toasts, history, showToast, dismissToast, clearHistory }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  const colors: Record<ToastType, string> = {
    success: "bg-green-600",
    error: "bg-red-600",
    warning: "bg-yellow-600",
    info: "bg-blue-600",
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${colors[toast.type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px]`}
        >
          <span className="flex-1 text-sm">{toast.message}</span>
          <button onClick={() => onDismiss(toast.id)} className="text-white/80 hover:text-white">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
