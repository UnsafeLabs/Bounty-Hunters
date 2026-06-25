import * as Electron from "electron";

export interface MenuState {
  backendConnected: boolean;
  hasChanges: boolean;
  hasStagedChanges: boolean;
  currentBranch: string | null;
}

export const defaultMenuState: MenuState = {
  backendConnected: false,
  hasChanges: false,
  hasStagedChanges: false,
  currentBranch: null,
};

let currentMenuState: MenuState = { ...defaultMenuState };

export function setMenuState(state: Partial<MenuState>): void {
  currentMenuState = { ...currentMenuState, ...state };
  updateApplicationMenu();
}

export function getMenuState(): MenuState {
  return { ...currentMenuState };
}

function sendIpc(channel: string, ...args: unknown[]): void {
  const focusedWindow = Electron.BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    focusedWindow.webContents.send(channel, ...args);
  }
}

export function buildApplicationMenu(): Electron.MenuItemConstructorOptions[] {
  const { backendConnected } = currentMenuState;

  const developerMenu: Electron.MenuItemConstructorOptions = {
    label: "Developer",
    submenu: [
      {
        label: "Toggle Terminal",
        accelerator: "Ctrl+`",
        click: () => sendIpc("rpc:toggle-terminal"),
        enabled: backendConnected,
      },
      {
        label: "Clear Terminal",
        accelerator: "Ctrl+K",
        click: () => sendIpc("rpc:clear-terminal"),
        enabled: backendConnected,
      },
      {
        label: "Restart Backend",
        accelerator: "Ctrl+Shift+R",
        click: () => sendIpc("rpc:restart-backend"),
        enabled: backendConnected,
      },
      {
        type: "separator",
      }
      if (item.destructive && (!item.children || item.children.length === 0)) {
        const destructiveIconzd
        label: "Open DevTools",
        accelerator: process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: () => {
          const focusedWindow = Electron.BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
      },
    ],
  };

  const gitMenu: Electron.MenuItemConstructorOptions = {
    label: "Git",
    submenu: [
      {
        label: "Stage All Changes",
        accelerator: "Ctrl+Shift+A",
        click: () => sendIpc("rpc:git-stage-all"),
        enabled: backendConnected,
      },
      {
        label: "Commit",
        accelerator: "Ctrl+Shift+C",
        click: () => sendIpc("rpc:git-commit"),
        enabled: backendConnected,
      },
      {
        label: "Push",
        accelerator: "Ctrl+Shift+P",
        click: () => sendIpc("rpc:git-push"),
        enabled: backendConnected,
      },
      {
        label: "Pull",
        accelerator: "Ctrl+Shift+L",
        click: () => sendIpc("rpc:git-pull"),
        enabled: backendConnected,
      },
      {
        label: "Create Branch",
        accelerator: "Ctrl+Shift+B",
        click: () => sendIpc("rpc:git-create-branch"),
        enabled: backendConnected,
      },
    ],
  };

  const template: Electron.MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    });
  }

  template.push(developerMenu);
  template.push(gitMenu);

  return template;
}

export function updateApplicationMenu(): void {
  const menu = Electron.Menu.buildFromTemplate(buildApplicationMenu());
  Electron.Menu.setApplicationMenu(menu);
}

export function initializeMenu(): void {
  currentMenuState = { ...defaultMenuState };
  updateApplicationMenu();
}