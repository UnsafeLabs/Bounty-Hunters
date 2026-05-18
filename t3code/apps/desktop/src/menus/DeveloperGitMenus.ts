import { Menu, shell, BrowserWindow } from "electron";

/**
 * Fix: Add Developer and Git menus to Electron application (#831)
 */

export function buildDeveloperMenu(): Electron.MenuItemConstructorOptions {
  return {
    label: "Developer",
    submenu: [
      {
        label: "Toggle Developer Tools",
        accelerator: "CmdOrCtrl+Shift+I",
        click: (_, browserWindow) => {
          browserWindow?.webContents.toggleDevTools();
        },
      },
      { type: "separator" },
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: (_, browserWindow) => {
          browserWindow?.reload();
        },
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: (_, browserWindow) => {
          browserWindow?.webContents.reloadIgnoringCache();
        },
      },
      { type: "separator" },
      {
        label: "Open Extension Folder",
        click: () => {
          const path = require("path");
          const extPath = path.join(process.env.HOME || "~", ".t3code", "extensions");
          shell.openPath(extPath);
        },
      },
      {
        label: "Open Logs Folder",
        click: () => {
          const path = require("path");
          const logPath = path.join(process.env.HOME || "~", ".t3code", "logs");
          shell.openPath(logPath);
        },
      },
      { type: "separator" },
      {
        label: "Toggle FPS Counter",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("toggle-fps-counter");
        },
      },
      {
        label: "Toggle Paint Flashing",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("toggle-paint-flashing");
        },
      },
    ],
  };
}

export function buildGitMenu(): Electron.MenuItemConstructorOptions {
  return {
    label: "Git",
    submenu: [
      {
        label: "Clone Repository...",
        accelerator: "CmdOrCtrl+Shift+N",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-clone");
        },
      },
      {
        label: "Open Repository...",
        accelerator: "CmdOrCtrl+O",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-open");
        },
      },
      { type: "separator" },
      {
        label: "Commit...",
        accelerator: "CmdOrCtrl+Shift+G",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-commit");
        },
      },
      {
        label: "Push",
        accelerator: "CmdOrCtrl+Shift+P",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-push");
        },
      },
      {
        label: "Pull",
        accelerator: "CmdOrCtrl+Shift+L",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-pull");
        },
      },
      { type: "separator" },
      {
        label: "Branch Manager...",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-branch-manager");
        },
      },
      {
        label: "View History...",
        accelerator: "CmdOrCtrl+Shift+H",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-history");
        },
      },
      { type: "separator" },
      {
        label: "Resolve Conflicts...",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-resolve-conflicts");
        },
      },
      {
        label: "Stash Changes",
        click: (_, browserWindow) => {
          browserWindow?.webContents.send("git-stash");
        },
      },
    ],
  };
}

export function buildApplicationMenu(mainWindow: BrowserWindow): Electron.Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    buildDeveloperMenu(),
    buildGitMenu(),
    { role: "windowMenu" },
    { role: "help" },
  ];

  return Menu.buildFromTemplate(template as any);
}
