/**
 * Developer and Git menus for Electron application menu bar.
 */

import { app, Menu, MenuItemConstructorOptions, shell, dialog } from "electron";

export function createDeveloperMenu(): MenuItemConstructorOptions {
  return {
    label: "Developer",
    submenu: [
      {
        label: "Toggle DevTools",
        accelerator: "CmdOrCtrl+Shift+I",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.toggleDevTools();
        },
      },
      { type: "separator" },
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.reload();
        },
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.reloadIgnoringCache();
        },
      },
      { type: "separator" },
      {
        label: "Open Logs Directory",
        click: () => {
          const logPath = app.getPath("logs");
          shell.openPath(logPath);
        },
      },
      {
        label: "Open Config Directory",
        click: () => {
          shell.openPath(app.getPath("userData"));
        },
      },
      { type: "separator" },
      {
        label: "Reset Application State",
        click: async (menuItem, browserWindow) => {
          const result = await dialog.showMessageBox(browserWindow!, {
            type: "warning",
            buttons: ["Cancel", "Reset"],
            defaultId: 0,
            message: "Reset all application state?",
            detail: "This will clear all settings and cached data.",
          });
          if (result.response === 1) {
            browserWindow?.webContents.session.clearStorageData();
            app.relaunch();
            app.exit(0);
          }
        },
      },
    ],
  };
}

export function createGitMenu(): MenuItemConstructorOptions {
  return {
    label: "Git",
    submenu: [
      {
        label: "Status",
        accelerator: "CmdOrCtrl+Shift+G",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.send("git:status");
        },
      },
      { type: "separator" },
      {
        label: "Commit",
        accelerator: "CmdOrCtrl+Enter",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.send("git:commit");
        },
      },
      {
        label: "Push",
        accelerator: "CmdOrCtrl+Shift+P",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.send("git:push");
        },
      },
      {
        label: "Pull",
        accelerator: "CmdOrCtrl+Shift+L",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.send("git:pull");
        },
      },
      { type: "separator" },
      {
        label: "Branches",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.send("git:branches");
        },
      },
      {
        label: "History",
        click: (menuItem, browserWindow) => {
          browserWindow?.webContents.send("git:history");
        },
      },
    ],
  };
}
