import { app, BrowserWindow } from 'electron';
import path from 'path';
import { URL } from 'url';

// T3Code deep link protocol: t3code://
const T3CODE_PROTOCOL = 't3code';

export interface DeepLinkOptions {
  /**
   * Whether to bring existing window to focus when a deep link is received
   * @default true
   */
  focusExisting?: boolean;

  /**
   * Whether to create a new window if no existing window is found
   * @default true
   */
  createNewWindow?: boolean;
}

/**
 * Validates and parses a t3code:// deep link URL.
 * Prevents path traversal attacks by validating the path parameter.
 */
export function parseDeepLinkUrl(url: string): { type: string; path?: string; id?: string } | null {
  try {
    const parsed = new URL(url);

    // Validate protocol
    if (parsed.protocol !== `${T3CODE_PROTOCOL}:`) {
      return null;
    }

    // Validate hostname (should be empty for protocol handler)
    if (parsed.hostname && parsed.hostname !== 'open' && parsed.hostname !== 'chat' && parsed.hostname !== 'settings') {
      return null;
    }

    // Extract type from hostname
    const type = parsed.hostname || 'unknown';

    // Parse query parameters
    const params = new URLSearchParams(parsed.search);

    // Validate and sanitize path parameter
    if (params.has('path')) {
      const rawPath = params.get('path')!;
      
      // Prevent path traversal
      if (rawPath.includes('..') || rawPath.startsWith('/')) {
        return null;
      }

      // Normalize path
      const normalizedPath = path.normalize(rawPath);
      
      // Ensure path stays within allowed directories
      if (normalizedPath.includes('..')) {
        return null;
      }

      return { type, path: normalizedPath };
    }

    // Parse thread ID for chat links
    if (params.has('id')) {
      const id = params.get('id')!;
      
      // Validate ID is alphanumeric
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return null;
      }

      return { type, id };
    }

    // Default case
    return { type };
  } catch {
    return null;
  }
}

/**
 * Handles deep link activation.
 * Called when the app is launched with a t3code:// URL or when a deep link
 * is received while the app is running.
 */
export function handleDeepLink(url: string, options: DeepLinkOptions = {}): boolean {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) {
    return false;
  }

  const { type, path, id } = parsed;
  const { focusExisting = true, createNewWindow = true } = options;

  // Get existing window
  const existingWindow = BrowserWindow.getAllWindows().find(w => w.isFocused());

  switch (type) {
    case 'open':
      if (path) {
        // Open project at specified path
        if (existingWindow && focusExisting) {
          existingWindow.focus();
          // Send action to renderer to open project
          existingWindow.webContents.send('deep-link-open-project', { path });
        } else if (createNewWindow) {
          createWindowAndOpenProject(path);
        }
      }
      break;

    case 'chat':
      if (id) {
        // Navigate to specific chat thread
        if (existingWindow && focusExisting) {
          existingWindow.focus();
          existingWindow.webContents.send('deep-link-open-chat', { threadId: id });
        } else if (createNewWindow) {
          createWindowAndOpenChat(id);
        }
      }
      break;

    case 'settings':
      // Open settings panel
      if (existingWindow && focusExisting) {
        existingWindow.focus();
        existingWindow.webContents.send('deep-link-open-settings');
      } else if (createNewWindow) {
        createWindowAndOpenSettings();
      }
      break;

    default:
      return false;
  }

  return true;
}

/**
 * Registers the t3code:// protocol handler.
 * Must be called before app is ready.
 */
export function registerDeepLinkProtocol(): void {
  // Check if we're the default handler already
  if (app.isDefaultProtocolClient(T3CODE_PROTOCOL)) {
    return;
  }

  // Set as default protocol handler on Windows
  if (process.platform === 'win32') {
    app.setAsDefaultProtocolClient(T3CODE_PROTOCOL);
  }

  // Register protocol handler
  app.on('second-instance', (event, commandLine) => {
    // Extract URL from command line arguments
    const deepLinkUrl = extractDeepLinkFromArgs(commandLine);
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });
}

/**
 * Extracts t3code:// URL from command line arguments.
 */
function extractDeepLinkFromArgs(args: string[]): string | null {
  for (const arg of args) {
    if (arg.startsWith(`${T3CODE_PROTOCOL}://`)) {
      return arg;
    }
  }
  return null;
}

/**
 * Creates a new window and opens a project.
 */
function createWindowAndOpenProject(projectPath: string): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('deep-link-open-project', { path: projectPath });
  });

  window.loadFile(path.join(__dirname, '../../renderers/index.html'));
}

/**
 * Creates a new window and opens a chat thread.
 */
function createWindowAndOpenChat(threadId: string): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('deep-link-open-chat', { threadId });
  });

  window.loadFile(path.join(__dirname, '../../renderers/index.html'));
}

/**
 * Creates a new window and opens settings.
 */
function createWindowAndOpenSettings(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('deep-link-open-settings');
  });

  window.loadFile(path.join(__dirname, '../../renderers/index.html'));
}

/**
 * Initializes deep link handling.
 * Call this during app initialization.
 */
export function initDeepLink(): void {
  registerDeepLinkProtocol();

  // Handle deep links when app is launched with URL
  if (process.argv.length > 1) {
    const deepLinkUrl = extractDeepLinkFromArgs(process.argv);
    if (deepLinkUrl) {
      // Delay handling until app is ready
      app.once('ready', () => {
        handleDeepLink(deepLinkUrl);
      });
    }
  }

  // Handle deep links received while app is running (macOS)
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}
