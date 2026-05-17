import { Menu, BrowserWindow, app } from "electron";
import { shell } from "electron";

export function buildMenu(mainWindow: BrowserWindow) {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Developer",
      submenu: [
        { label: "Toggle DevTools", accelerator: isMac ? "Cmd+Shift+I" : "Ctrl+Shift+I",
          click: () => mainWindow.webContents.toggleDevTools() },
        { label: "Reload", accelerator: "CmdOrCtrl+R",
          click: () => { mainWindow.reload(); } },
        { label: "Force Reload", accelerator: "CmdOrCtrl+Shift+R",
          click: () => { mainWindow.webContents.reloadIgnoringCache(); } },
        { label: "Open Logs Folder",
          click: () => shell.openPath(app.getPath("logs")) },
      ],
    },
    {
      label: "Git",
      submenu: [
        { label: "View History",
          click: () => mainWindow.webContents.send("git:history") },
        { label: "Stage All Changes",
          click: () => mainWindow.webContents.send("git:stage-all") },
        { label: "Commit",
          click: () => mainWindow.webContents.send("git:commit") },
        { label: "Push",
          click: () => mainWindow.webContents.send("git:push") },
        { label: "Pull",
          click: () => mainWindow.webContents.send("git:pull") },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}