Looking at the issue, I need to add Developer and Git menus to the Electron application menu bar in the `t3code/apps/desktop/src/electron/menu.ts` file. However, I notice that the file shown in the context is `t3code/apps/desktop/src/electron/ElectronMenu.ts`, not `menu.ts`. 

Let me analyze what needs to be done:

1. Add Developer menu with items: Toggle Terminal, Clear Terminal, Restart Backend, Open DevTools
2. Add Git menu with items: Stage All Changes, Commit, Push, Pull, Create Branch
3. Each menu item should trigger corresponding RPC calls via IPC
4. Add keyboard accelerators matching VS Code conventions
5. Menu items should be disabled when actions are unavailable

Since the exact file structure isn't fully visible, I'll create the menu implementation based on the ElectronMenu service pattern shown.

```diff
--- a/t3code/apps/desktop/src/electron/ElectronMenu.ts
+++ b/t3code/apps/desktop/src/electron/ElectronMenu.ts
@@ -1,4 +1,5 @@
 import type { ContextMenuItem } from "@t3tools/contracts";
+import type { MenuItemConstructorOptions } from "electron";
 import * as Context from "effect/Context";
 import * as Effect from "effect/Effect";
 import * as Layer from "effect/Layer";
@@ -8,6 +9,8 @@ import * as Option from "effect/Option";
 
 import * as Electron from "electron";
 
+import { ipcMain } from "electron";
+
 export interface ElectronMenuPosition {
   readonly x: number;
   readonly y: number;
@@ -20,6 +23,12 @@ export interface ElectronMenuTemplateInput {
 export interface ElectronMenuShape {
   readonly setApplicationMenu: (
     template: readonly Electron.MenuItemConstructorOptions[],
+  ) => Effect.Effect<void>;
+  readonly setApplicationMenuWithDeveloperAndGit: (
+    template: readonly Electron.MenuItemConstructorOptions[],
+    window: Electron.BrowserWindow,
+    backendConnected: boolean,
+    gitAvailable: boolean,
   ) => Effect.Effect<void>;
   readonly showContextMenu: (
     input: ElectronMenuContextInput,
@@ -100,6 +109,102 @@ export const layer = Layer.sync(ElectronMenu, () => {
     return destructiveMenuIconCache;
   };
 
+  const buildDeveloperAndGitMenus = (
+    window: Electron.BrowserWindow,
+    backendConnected: boolean,
+    gitAvailable: boolean,
+  ): Electron.MenuItemConstructorOptions[] => {
+    const developerMenu: MenuItemConstructorOptions = {
+      label: "Developer",
+      submenu: [
+        {
+          label: "Toggle Terminal",
+          accelerator: process.platform === "darwin" ? "Cmd+J" : "Ctrl+J",
+          enabled: backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "toggleTerminal",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Clear Terminal",
+          accelerator: process.platform === "darwin" ? "Cmd+K" : "Ctrl+K",
+          enabled: backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "clearTerminal",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Restart Backend",
+          accelerator: process.platform === "darwin" ? "Cmd+Alt+R" : "Ctrl+Alt+R",
+          enabled: backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "restartBackend",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Open DevTools",
+          accelerator: process.platform === "darwin" ? "Cmd+Alt+I" : "Ctrl+Alt+I",
+          click: () => {
+            window.webContents.openDevTools();
+          }
+        }
+      ]
+    };
+
+    const gitMenu: MenuItemConstructorOptions = {
+      label: "Git",
+      submenu: [
+        {
+          label: "Stage All Changes",
+          accelerator: process.platform === "darwin" ? "Cmd+Shift+A" : "Ctrl+Shift+A",
+          enabled: gitAvailable && backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "stageAllChanges",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Commit",
+          accelerator: process.platform === "darwin" ? "Cmd+Enter" : "Ctrl+Enter",
+          enabled: gitAvailable && backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "commit",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Push",
+          accelerator: process.platform === "darwin" ? "Cmd+Shift+P" : "Ctrl+Shift+P",
+          enabled: gitAvailable && backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "push",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Pull",
+          accelerator: process.platform === "darwin" ? "Cmd+Shift+L" : "Ctrl+Shift+L",
+          enabled: gitAvailable && backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "pull",
+              params: []
+            });
+          }
+        },
+        {
+          label: "Create Branch",
+          accelerator: process.platform === "darwin" ? "Cmd+Shift+B" : "Ctrl+Shift+B",
+          enabled: gitAvailable && backendConnected,
+          click: () => {
+            window.webContents.send("rpc-call", {
+              method: "createBranch",
+              params: []
+            });
+          }
+        }
+      ]
+    };
+
+    return [developerMenu, gitMenu];
+  };
+
   const buildTemplate = (
     entries: readonly ContextMenuItem[],
     complete: (selectedItemId: Option.Option<string>) => void,
@@ -175,6 +280,26 @@ export const layer = Layer.sync(ElectronMenu, () => {
     return {
       setApplicationMenu: (template) =>
         Effect.sync(() => {
+          // Insert our custom menus at the beginning
+          const menu = Electron.Menu.buildFromTemplate(template);
+          Electron.Menu.setApplicationMenu(menu);
+        }),
+      setApplicationMenuWithDeveloperAndGit: (
+        template,
+        window,
+        backendConnected,
+        gitAvailable,
+      ) =>
+        Effect.sync(() => {
+          // Build the additional menus
+          const additionalMenus =