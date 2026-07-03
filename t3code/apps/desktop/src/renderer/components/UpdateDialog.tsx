import React, { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  total: number;
  transferred: number;
}

export const UpdateDialog: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const unsubAvailable = ipcRenderer.on('update:available', (_, info) => {
      setUpdateInfo(info);
    });

    const unsubProgress = ipcRenderer.on('update:download-progress', (_, prog) => {
      setProgress(prog);
    });

    const unsubDownloaded = ipcRenderer.on('update:downloaded', () => {
      setDownloaded(true);
      setIsDownloading(false);
    });

    const unsubError = ipcRenderer.on('update:error', (_, error) => {
      console.error('Update error:', error);
      setIsDownloading(false);
    });

    return () => {
      unsubAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  const handleDownload = async () => {
    setIsDownloading(true);
    await ipcRenderer.invoke('update:download');
  };

  const handleInstall = () => {
    ipcRenderer.invoke('update:install');
  };

  const handleDefer = async () => {
    await ipcRenderer.invoke('update:defer', 24);
    setUpdateInfo(null);
  };

  const handleSkip = async () => {
    if (updateInfo) {
      await ipcRenderer.invoke('update:skip-version', updateInfo.version);
      setUpdateInfo(null);
    }
  };

  if (!updateInfo) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Update Available</h2>
        <p className="text-gray-700 mb-4">Version {updateInfo.version} is available.</p>

        {isDownloading && progress && (
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {progress.percent.toFixed(1)}% ({(progress.transferred / 1024 / 1024).toFixed(1)} MB / {(progress.total / 1024 / 1024).toFixed(1)} MB)
            </p>
          </div>
        )}

        {updateInfo.releaseNotes && (
          <div className="mb-4 max-h-32 overflow-y-auto text-sm text-gray-600">
            <p className="font-semibold mb-2">Release Notes:</p>
            <p>{updateInfo.releaseNotes}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={handleSkip}
            disabled={isDownloading}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Skip Version
          </button>
          <button
            onClick={handleDefer}
            disabled={isDownloading}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Remind Later
          </button>
          {!downloaded ? (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {isDownloading ? 'Downloading...' : 'Download'}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Install & Restart
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
