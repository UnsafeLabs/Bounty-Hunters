import * as Electron from "electron";

export interface MenuState {
  readonly isBackendConnected: boolean;
  readonly hasGitChanges: boolean;
  readonly currentBranch: string | null;
}

export const defaultMenuState: MenuState = {
  isBackendConnected: false,
  hasGitChanges: false,
  currentBranch: null,
};

let currentMenuState: MenuState = defaultMenuState;
let menuUpdateCallback: (() => void) | null = null;

export function setMenuState(state: Partial<MenuState>): void {
  currentMenuState = { ...currentMenuState, ...state };
  if (menuUpdateCallback) {
    menuUpdateCallback();
  }
}

export function getMenuState(): MenuState {
  return currentMenuState;
}

export function onMenuUpdate(callback: () => void): void {
  menuUpdateCallback = callback;
}

function sendIpc(channel: string, ...args: unknown[]): void {
  const focusedWindow = Electron.BrowserWindow.getFocusedWindow();
  if (focusedWindow) {
    focusedWindow.webContents.send(channel, ...args);
  }
}

export function buildApplicationMenu(): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";

  const developerMenu: Electron.MenuItemConstructorOptions = {
    label: "Developer",
    submenu: [
      {
        label: "Toggle Terminal",
        accelerator: isMac ? "Ctrl+`" : "Ctrl+`",
        click: () => sendIpc("rpc:developer:toggleTerminal"),
        enabled: currentMenuState.isBackendConnected,
      },
      {
        label: "Clear Terminal",
        accelerator: isMac ? "Ctrl+K" : "Ctrl+K",
        click: () => sendIpc("rpc:developer:clearTerminal"),
        enabled: currentMenuState.isBackendConnected,
      },
      {
        label: "Restart Backend",
        accelerator: isMac ? "Cmd+Shift+R" : "Ctrl+Shift+R",
        click: () => sendIpc("rpc:developer:restartBackend"),
        enabled: currentMenuState.isBackendConnected,
      },
      {
        label: "Open DevTools",
        accelerator: isMac ? "Cmd+Option+I" : "Ctrl+Shift+I",
        click: () => {
          const focusedWindow = Electron.BrowserWindow.getFocusedWindow();
          if (focusedWindow) {
            focusedWindow.webContents.toggleDevTools();
          }
        },
        enabled: true,
      },
    ],
  };

  const gitMenu: Electron.MenuItemConstructorOptions = {
    label: "Git",
    submenu: [
      {
        label: "Stage All Changes",
        accelerator: isMac ? "Cmd+Shift+A" : "Ctrl+Shift+A",
        click: () => sendIpc("rpc:git:stageAll"),
        enabled: currentMenuState.isBackendConnected && currentMenuState.hasGitChanges,
      },
      {
        label: "Commit",
        accelerator: isMac ? "Cmd+Enter" : "Ctrl+Enter",
        click: () => sendIpc("rpc:git:commit"),
        enabled: currentMenuState.isBackendConnected && currentMenuState.hasGitChanges,
      },
      {
        label: "Push",
        accelerator: isMac ? "Cmd+Shift+P" : "Ctrl+Shift+P",
        click: () => sendIpc("rpc:git:push"),
        enabled: currentMenuState.isBackendConnected && currentMenuState.currentBranch !== null,
      },
      {
        label: "Pull",
        accelerator: isMac ? "Cmd+Shift+L" : "Ctrl+Shift+L",
        click: () => sendIpc("rpc:git:pull"),
        enabled: currentMenuState.isBackendConnected && currentMenuState.currentBranch !== null,
      },
      {
        label: "Create Branch",
        accelerator: isMac ? "Cmd+Shift+B" : "Ctrl+Shift+B",
        click: () => sendIpc("rpc:git:createBranch"),
        enabled: currentMenuState.isBackendConnected,
      },
    ],
  };

  return [developerMenu, gitMenu];
}

export function createApplicationMenu(
  existingTemplate: Electron.MenuItemConstructorOptions[] = [],
): Electron.Menu {
  const customMenus = buildApplicationMenu();
  const template: Electron.MenuItemConstructorOptions[] = [...existingTemplate];

  // Insert Developer and Git menus before the last menu (typically Help) or append
  if (template.length > 0) {
    template.splice(Math.max(0, template.length - 1), 0, ...customMenus);
  } else {
    template.push(...customMenus);
  }

  return Electron.Menu.buildFromTemplate(template);
}

export function updateApplicationMenu(
  window: Electron.BrowserWindow,
  existingTemplate?: Electron.MenuItemConstructorOptions[],
): void {
  const menu = createApplicationMenu(existingTemplate);
  Electron.Menu.setApplicationMenu(menu);
}

export function initializeMenu(window: Electron.BrowserWindow): void {
  onMenuUpdate(() => {
    updateApplicationMenu(window);
  });

  updateApplicationMenu(window);
}

export default {
  buildApplicationMenu,
  createApplicationMenu,
  updateApplicationMenu,
  initializeMenu,
  setMenuState,
  getMenuState,
  onMenuUpdate,
};