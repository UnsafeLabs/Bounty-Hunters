import * as Electron from "electron";

export interface MenuState {
  readonly isBackendConnected: boolean;
  readonly hasGitRepo: boolean;
  readonly hasUncommittedChanges: boolean;
}

export function createApplicationMenu(
  state: MenuState,
  sendIpc: (channel: string, ...args: unknown[]) => void,
): Electron.MenuItemConstructorOptions[] {
  const developerMenu: Electron.MenuItemConstructorOptions = {
    label: "Developer",
    submenu: [
      {
        label: "Toggle Terminal",
        accelerator: "Ctrl+`",
        click: () => sendIpc("rpc:toggleTerminal"),
      },
      {
        label: "Clear Terminal",
        accelerator: "Ctrl+K",
        click: () => sendIpc("rpc:clearTerminal"),
      },
      {
        label: "Restart Backend",
        accelerator: "CmdOrCtrl+Shift+R",
        click: () => sendIpc("rpc:restartBackend"),
        enabled: state.isBackendConnected,
      },
      {
        type: "separator",
      },
      {
        label: "Open DevTools",
        accelerator: process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: (_, focusedWindow) => {
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
        accelerator: "CmdOrCtrl+Shift+A",
        click: () => sendIpc("rpc:stageAllChanges"),
        enabled: state.isBackendConnected && state.hasGitRepo,
      },
      {
        label: "Commit",
        accelerator: "CmdOrCtrl+Shift+C",
        click: () => sendIpc("rpc:commit"),
        enabled: state.isBackendConnected && state.hasGitRepo && state.hasUncommittedChanges,
      },
      {
        label: "Push",
        accelerator: "CmdOrCtrl+Shift+P",
        click: () => sendIpc("rpc:push"),
        enabled: state.isBackendConnected && state.hasGitRepo,
      },
      {
        label: "Pull",
        accelerator: "CmdOrCtrl+Shift+L",
        click: () => sendIpc("rpc:pull"),
        enabled: state.isBackendConnected && state.hasGitRepo,
      },
      {
        type: "separator",
      },
      {
        label: "Create Branch",
        accelerator: "CmdOrCtrl+Shift+B",
        click: () => sendIpc("rpc:createBranch"),
        enabled: state.isBackendConnected && state.hasGitRepo,
      },
    ],
  };

  return [developerMenu, gitMenu];
}

export function createMenuTemplate(
  state: MenuState,
  sendIpc: (channel: string, ...args: unknown[]) => void,
  existingMenus: Electron.MenuItemConstructorOptions[] = [],
): Electron.MenuItemConstructorOptions[] {
  const customMenus = createApplicationMenu(state, sendIpc);
  return [...customMenus, ...existingMenus];
}

let currentMenuState: MenuState = {
  isBackendConnected: false,
  hasGitRepo: false,
  hasUncommittedChanges: false,
};

export function updateMenuState(
  newState: Partial<MenuState>,
  sendIpc: (channel: string, ...args: unknown[]) => void,
  existingMenus: Electron.MenuItemConstructorOptions[] = [],
): void {
  currentMenuState = { ...currentMenuState, ...newState };
  const template = createMenuTemplate(currentMenuState, sendIpc, existingMenus);
  const menu = Electron.Menu.buildFromTemplate(template);
  Electron.Menu.setApplicationMenu(menu);
}

export function getMenuState(): MenuState {
  return currentMenuState;
}

export function initializeMenu(
  sendIpc: (channel: string, ...args: unknown[]) => void,
  existingMenus: Electron.MenuItemConstructorOptions[] = [],
): void {
  const template = createMenuTemplate(currentMenuState, sendIpc, existingMenus);
  const menu = Electron.Menu.buildFromTemplate(template);
  Electron.Menu.setApplicationMenu(menu);
}

export function rebuildMenu(
  sendIpc: (channel: string, ...args: unknown[]) => void,
  existingMenus: Electron.MenuItemConstructorOptions[] = [],
): void {
  const template = createMenuTemplate(currentMenuState, sendIpc, existingMenus);
  const menu = Electron.Menu.buildFromTemplate(template);
  Electron.Menu.setApplicationMenu(menu);
}