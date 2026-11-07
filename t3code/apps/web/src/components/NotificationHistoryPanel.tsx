import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, Trash2 } from 'lucide-react';
import { useNotificationStore, type NotificationType } from '../stores/notificationStore';

const typeIcons: Record<NotificationType, React.ComponentType<any>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const typeColors: Record<NotificationType, string> = {
  success: 'text-green-600 dark:text-green-400',
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-yellow-600 dark:text-yellow-400',
  info: 'text-blue-600 dark:text-blue-400',
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

interface NotificationHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationHistoryPanel({ isOpen, onClose }: NotificationHistoryPanelProps) {
  const history = useNotificationStore((state) => state.history);
  const clearHistory = useNotificationStore((state) => state.clearHistory);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 dark:bg-black/40 z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Notification History
              </h2>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    aria-label="Clear history"
                    title="Clear all history"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  aria-label="Close panel"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400 p-8">
                  <Info size={48} className="mb-4 opacity-50" />
                  <p className="text-center">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {history.map((notification) => {
                    const Icon = typeIcons[notification.type];
                    return (
                      <div
                        key={notification.id}
                        className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <Icon
                            className={`${typeColors[notification.type]} flex-shrink-0 mt-0.5 ${
                              notification.dismissed ? 'opacity-50' : ''
                            }`}
                            size={20}
                          />
                          <div className="flex-1 min-w-0">
                            {notification.title && (
                              <h4
                                className={`text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1 ${
                                  notification.dismissed ? 'opacity-60' : ''
                                }`}
                              >
                                {notification.title}
                              </h4>
                            )}
                            <p
                              className={`text-sm text-gray-700 dark:text-gray-300 break-words ${
                                notification.dismissed ? 'opacity-60' : ''
                              }`}
                            >
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {formatTimestamp(notification.createdAt)}
                              {notification.dismissed && ' • Dismissed'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default NotificationHistoryPanel;
