+ // Add these imports at the top
+ import { registerProtocol, handleDeepLink, handleSecondInstanceWindows, setAsDefaultClient, parseDeepLink } from './protocol';
+ import { app, BrowserWindow, protocol, ipcMain } from 'electron'; // if not already imported
+ 
+ // Register privileged scheme before app is ready (must be done before app.whenReady)
+ protocol.registerSchemesAsPrivileged([
+   { scheme: 't3code', privileges: { standard: true, secure: true } }
+ ]);
+ 
  // Your existing main.ts content...
+ 
+ // Inside the main function or after app.whenReady() callback:
+ app.whenReady().then(() => {
+   // ... existing code ...
+ 
+   // Set as default protocol client
+   setAsDefaultClient();
+ 
+   // Handle macOS open-url event
+   app.on('open-url', (event, url) => {
+     event.preventDefault();
+     handleDeepLink(mainWindow, url);
+   });
+ 
+   // Handle second instance (Windows/Linux) - the URL is passed as command line arg
+   const gotTheLock = app.requestSingleInstanceLock();
+   if (!gotTheLock) {
+     app.quit();
+   } else {
+     app.on('second-instance', (event, commandLine) => {
+       // On Windows, the URL is passed as a command line argument.
+       // Find the first argument that starts with 't3code://'
+       const url = commandLine.find(arg => arg.startsWith('t3code://'));
+       if (url) {
+         handleSecondInstanceWindows(url);
+       }
+     });
+   }
+ 
+   // Check if app was launched from a deep link (on Windows, command line args are passed)
+   const launchUrl = process.argv.find(arg => arg.startsWith('t3code://'));
+   if (launchUrl) {
+     handleDeepLink(mainWindow, launchUrl);
+   }
+ 
+   // Apply any pending deep link that was stored before window was ready
+   if ((globalThis as any).__pendingDeepLink) {
+     const pending = (globalThis as any).__pendingDeepLink;
+     if (mainWindow && !mainWindow.isDestroyed()) {
+       navigateTo(mainWindow, pending.route, pending.params);
+     }
+     delete (globalThis as any).__pendingDeepLink;
+   }
+ });
+ 
+ // Add IPC handler for deep-link errors (optional, renderer can listen)
+ ipcMain.on('navigate', (event, route, params) => {
+   // This is used from renderer if needed, but we already send via webContents.send
+ });
+ 
+ // Ensure mainWindow is defined in scope (if not already)
+ let mainWindow: BrowserWindow | null = null;
+ // ... existing code to create mainWindow ...