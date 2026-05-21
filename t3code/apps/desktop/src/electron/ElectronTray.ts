import * as Electron from "electron";
export function createTray(mainWindow: Electron.BrowserWindow): Electron.Tray | null {
  try {
    const iconPath = require("path").join(__dirname, "../../assets/icon.png");
    const tray = new Electron.Tray(iconPath);
    const contextMenu = Electron.Menu.buildFromTemplate([
      { label: "Show Window", click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: "separator" as const },
      { label: "Quit", click: () => Electron.app.quit() },
    ]);
    tray.setToolTip("T3 Code");
    tray.setContextMenu(contextMenu);
    tray.on("double-click", () => { mainWindow.show(); mainWindow.focus(); });
    return tray;
  } catch (e) { ; return null; }
}