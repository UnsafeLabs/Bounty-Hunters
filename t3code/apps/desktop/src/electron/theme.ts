import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import Store from 'electron-store';

/**
 * Theme options supported by the application.
 * - 'light'  : Force light mode.
 * - 'dark'   : Force dark mode.
 * - 'system' : Follow the OS preference in real-time.
 */
export type ThemeOption = 'light' | 'dark' | 'system';

const THEME_STORE_KEY = 'theme';
const store = new Store();

/**
 * Apply the given theme option to Electron's nativeTheme.
 */
function applyTheme(option: ThemeOption) {
  nativeTheme.themeSource = option;
}

/**
 * Broadcast the effective theme (light/dark) to all renderer windows.
 * When the user selects "system" we broadcast the OS-derived theme.
 */
function broadcastTheme() {
  const saved = store.get(THEME_STORE_KEY, 'system') as ThemeOption;
  const effective = saved === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : saved;

  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('theme-updated', { theme: effective });
  });
}

/**
 * Initialise theme handling:
 *   1. Load persisted preference (default: 'system').
 *   2. Apply it to nativeTheme.
 *   3. Listen for OS theme changes when in "system" mode.
 *   4. Expose IPC channels for getting/setting the theme.
 */
export function initTheme() {
  const saved = store.get(THEME_STORE_KEY, 'system') as ThemeOption;

  applyTheme(saved);

  nativeTheme.on('updated', () => {
    if (store.get(THEME_STORE_KEY, 'system') === 'system') {
      broadcastTheme();
    }
  });

  ipcMain.handle('get-theme', () => {
    const current = store.get(THEME_STORE_KEY, 'system') as ThemeOption;
    if (current === 'system') {
      return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    }
    return current;
  });

  ipcMain.handle('set-theme', (_event, option: ThemeOption) => {
    store.set(THEME_STORE_KEY, option);
    applyTheme(option);
    broadcastTheme();
    return true;
  });

  app.once('browser-window-created', () => {
    setTimeout(broadcastTheme, 0);
  });
}

export { applyTheme, broadcastTheme, store as themeStore };
