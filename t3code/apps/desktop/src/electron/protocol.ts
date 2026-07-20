+ import { app, protocol, BrowserWindow, ipcMain, shell } from 'electron';
+ import { URL } from 'url';
+ import * as path from 'path';
+ 
+ const PROTOCOL = 't3code';
+ 
+ // Validates a project path parameter to prevent traversal attacks
+ function validateProjectPath(rawPath: string): string | null {
+   // Reject if path contains '..' components
+   if (rawPath.includes('..')) return null;
+ 
+   // Reject absolute paths (Unix: starts with '/', Windows: starts with drive letter)
+   if (/^[/\\]/.test(rawPath) || /^[a-zA-Z]:[/\\]/.test(rawPath)) return null;
+ 
+   // Normalize and ensure it hasn't escaped somewhere (belt and suspenders)
+   const normalized = path.normalize(rawPath);
+   if (normalized.includes('..')) return null;
+ 
+   return normalized;
+ }
+ 
+ // Parse a t3code:// URL and return the route to navigate to, or null if invalid
+ export function parseDeepLink(urlString: string): { route: string; params?: Record<string, string> } | null {
+   try {
+     const parsed = new URL(urlString);
+     if (parsed.protocol !== `${PROTOCOL}:`) return null;
+ 
+     const host = parsed.hostname; // after t3code://
+     const pathname = parsed.pathname.replace(/^\/+/, ''); // remove leading slash
+     const searchParams = parsed.searchParams;
+ 
+     switch (host) {
+       case 'open': {
+         const rawPath = searchParams.get('path');
+         if (!rawPath) return null;
+         const validPath = validateProjectPath(rawPath);
+         if (!validPath) return null;
+         return { route: '/open', params: { path: validPath } };
+       }
+       case 'chat': {
+         const id = searchParams.get('id');
+         if (!id) return null;
+         return { route: '/chat', params: { threadId: id } };
+       }
+       case 'settings': {
+         // No extra parameters needed
+         return { route: '/settings' };
+       }
+       default:
+         return null; // unknown host
+     }
+   } catch {
+     return null;
+   }
+ }
+ 
+ // Send navigation command to the renderer via IPC
+ function navigateTo(window: BrowserWindow, route: string, params?: Record<string, string>) {
+   window.webContents.send('navigate', { route, params });
+ }
+ 
+ // Handle incoming deep link event on macOS (open-url)
+ export function handleDeepLink(mainWindow: BrowserWindow | null, url: string): void {
+   const result = parseDeepLink(url);
+   if (!result) {
+     // Show error notification (we'll send a generic error message)
+     if (mainWindow && !mainWindow.isDestroyed()) {
+       mainWindow.webContents.send('deep-link-error', `Invalid T3 Code URL: ${url}`);
+     }
+     return;
+   }
+ 
+   // Focus window if it exists
+   if (mainWindow && !mainWindow.isDestroyed()) {
+     if (mainWindow.isMinimized()) mainWindow.restore();
+     mainWindow.focus();
+     navigateTo(mainWindow, result.route, result.params);
+   } else {
+     // Store the pending action so it can be applied after window is created
+     globalThis.__pendingDeepLink = result;
+   }
+ }
+ 
+ // Register the custom protocol handler on the OS level
+ export function registerProtocol(): void {
+   // In Electron, protocol.registerSchemesAsPrivileged must be called before app ready
+   // This is typically done in main.ts before app.whenReady(). We'll export a function.
+   // But registration also involves app.setAsDefaultProtocolClient, done after ready.
+ }
+ 
+ // Call this after app is ready to set as default protocol client
+ export function setAsDefaultClient(): void {
+   app.setAsDefaultProtocolClient(PROTOCOL);
+ }
+ 
+ // For Windows/Linux: handle second instance launch with the URL
+ export function handleSecondInstanceWindows(url: string): void {
+   // On Windows, URL is passed as command line argument, on Linux as second-instance event
+   handleDeepLink(BrowserWindow.getAllWindows()[0] || null, url);
+ }