import type { ContextMenuItem } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

export interface ElectronMenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface ElectronMenuContextInput {
  readonly window: Electron.BrowserWindow;
  readonly items: readonly ContextMenuItem[];
  readonly position: Option.Option<ElectronMenuPosition>;
}

export interface ElectronMenuTemplateInput {
  readonly window: Electron.BrowserWindow;
  readonly template: readonly Electron.MenuItemConstructorOptions[];
}

export interface DeveloperMenuState {
  readonly backendConnected: boolean;
  readonly terminalOpen: boolean;
}

export interface GitMenuState {
  readonly backendConnected: boolean;
  readonly hasRepository: boolean;
}

export interface ElectronMenuShape {
  readonly setApplicationMenu: (
    template: readonly Electron.MenuItemConstructorOptions[],
  ) => Effect.Effect<void>;
  readonly showContextMenu: (
    input: ElectronMenuContextInput,
  ) => Effect.Effect<Option.Option<string>>;
  readonly popupTemplate: (input: ElectronMenuTemplateInput) => Effect.Effect<void>;
  readonly buildDeveloperMenu: (
    getState: () => DeveloperMenuState,
  ) => Electron.MenuItemConstructorOptions[];
  readonly buildGitMenu: (
    getState: () => GitMenuState,
  ) => Electron.MenuItemConstructorOptions[];
}

export class ElectronMenu extends Context.Service<ElectronMenu, ElectronMenuShape>()(
  "t3/desktop/electron/Menu",
) {}

function buildDeveloperMenu(
  getState: () => DeveloperMenuState,
): Electron.MenuItemConstructorOptions[] {
  const state = getState();
  const enabled = state.backendConnected;

  return [
    {
      label: "Toggle Terminal",
      accelerator: "CmdOrCtrl+`",
      enabled,
      click: () => {
        // Toggle terminal visibility
      },
    },
    {
      label: "Clear Terminal",
      accelerator: "CmdOrCtrl+K",
      enabled,
      click: () => {
        // Clear terminal output
      },
    },
    {
      label: "Restart Backend",
      accelerator: "CmdOrCtrl+Shift+R",
      enabled,
      click: () => {
        // Restart backend service
      },
    },
    { type: "separator" },
    {
      label: "Open DevTools",
      accelerator: process.platform === "darwin" ? "Cmd+Alt+I" : "F12",
      enabled,
      click: () => {
        // Open developer tools
      },
    },
  ];
}

function buildGitMenu(
  getState: () => GitMenuState,
): Electron.MenuItemConstructorOptions[] {
  const state = getState();
  const enabled = state.backendConnected && state.hasRepository;

  return [
    {
      label: "Stage All Changes",
      accelerator: "CmdOrCtrl+Shift+A",
      enabled,
      click: () => {
        // Stage all changes
      },
    },
    {
      label: "Commit",
      accelerator: "CmdOrCtrl+Enter",
      enabled,
      click: () => {
        // Commit staged changes
      },
    },
    { type: "separator" },
    {
      label: "Push",
      accelerator: "CmdOrCtrl+Shift+P",
      enabled,
      click: () => {
        // Push commits
      },
    },
    {
      label: "Pull",
      accelerator: "CmdOrCtrl+Shift+U",
      enabled,
      click: () => {
        // Pull latest changes
      },
    },
    { type: "separator" },
    {
      label: "Create Branch",
      accelerator: "CmdOrCtrl+Shift+N",
      enabled,
      click: () => {
        // Create new branch
      },
    },
  ];
}

function buildFullMenuTemplate(
  getDevState: () => DeveloperMenuState,
  getGitState: () => GitMenuState,
  existingTemplate: readonly Electron.MenuItemConstructorOptions[],
): Electron.MenuItemConstructorOptions[] {
  const developerMenu = buildDeveloperMenu(getDevState);
  const gitMenu = buildGitMenu(getGitState);

  const result: Electron.MenuItemConstructorOptions[] = [];
  let insertedDeveloper = false;
  let insertedGit = false;

  for (const item of existingTemplate) {
    result.push({ ...item });

    if (!insertedDeveloper) {
      const label = (item as { label?: string }).label;
      if (label === "Edit" || label === "&Edit") {
        result.push({
          label: "Developer",
          submenu: developerMenu,
        });
        insertedDeveloper = true;
      }
    }

    if (insertedDeveloper && !insertedGit) {
      const label = (item as { label?: string }).label;
      if (label === "Developer") {
        result.push({
          label: "Git",
          submenu: gitMenu,
        });
        insertedGit = true;
      }
    }
  }

  if (!insertedDeveloper) {
    result.push({
      label: "Developer",
      submenu: developerMenu,
    });
  }

  if (!insertedGit) {
    result.push({
      label: "Git",
      submenu: gitMenu,
    });
  }

  return result;
}

function normalizeContextMenuItems(source: readonly ContextMenuItem[]): ContextMenuItem[] {
  const normalizedItems: ContextMenuItem[] = [];

  for (const sourceItem of source) {
    if (typeof sourceItem.id !== "string" || typeof sourceItem.label !== "string") {
      continue;
    }

    const normalizedItem: ContextMenuItem = {
      id: sourceItem.id,
      label: sourceItem.label,
      destructive: sourceItem.destructive === true,
      disabled: sourceItem.disabled === true,
    };

    if (sourceItem.children) {
      const normalizedChildren = normalizeContextMenuItems(sourceItem.children);
      if (normalizedChildren.length === 0) {
        continue;
      }
      normalizedItem.children = normalizedChildren;
    }

    normalizedItems.push(normalizedItem);
  }

  return normalizedItems;
}

const normalizePosition = (
  position: Option.Option<ElectronMenuPosition>,
): Option.Option<ElectronMenuPosition> =>
  Option.filter(
    position,
    ({ x, y }) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0,
  ).pipe(Option.map(({ x, y }) => ({ x: Math.floor(x), y: Math.floor(y) })));

export const layer = Layer.sync(ElectronMenu, () => {
  let destructiveMenuIconCache: Option.Option<Electron.NativeImage> | undefined;

  const getDestructiveMenuIcon = (): Option.Option<Electron.NativeImage> => {
    if (process.platform !== "darwin") {
      return Option.none();
    }
    if (destructiveMenuIconCache !== undefined) {
      return destructiveMenuIconCache;
    }

    try {
      const icon = Electron.nativeImage.createFromNamedImage("trash").resize({
        width: 12,
        height: 12,
      });
      destructiveMenuIconCache = icon.isEmpty() ? Option.none() : Option.some(icon);
    } catch {
      destructiveMenuIconCache = Option.none();
    }

    return destructiveMenuIconCache;
  };

  const buildTemplate = (
    entries: readonly ContextMenuItem[],
    complete: (selectedItemId: Option.Option<string>) => void,
  ): Electron.MenuItemConstructorOptions[] => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    let hasInsertedDestructiveSeparator = false;

    for (const item of entries) {
      if (item.destructive && !hasInsertedDestructiveSeparator && template.length > 0) {
        template.push({ type: "separator" });
        hasInsertedDestructiveSeparator = true;
      }

      const itemOption: Electron.MenuItemConstructorOptions = {
        label: item.label,
        enabled: !item.disabled,
      };
      if (item.children && item.children.length > 0) {
        itemOption.submenu = buildTemplate(item.children, complete);
      } else {
        itemOption.click = () => complete(Option.some(item.id));
      }
      if (item.destructive && (!item.children || item.children.length === 0)) {
        const destructiveIcon = getDestructiveMenuIcon();
        if (Option.isSome(destructiveIcon)) {
          itemOption.icon = destructiveIcon.value;
        }
      }

      template.push(itemOption);
    }

    return template;
  };

  return ElectronMenu.of({
    setApplicationMenu: (template) =>
      Effect.sync(() => {
        Electron.Menu.setApplicationMenu(Electron.Menu.buildFromTemplate([...template]));
      }),
    popupTemplate: (input) =>
      Effect.sync(() => {
        if (input.template.length === 0) {
          return;
        }
        Electron.Menu.buildFromTemplate([...input.template]).popup({ window: input.window });
      }),
    showContextMenu: (input) =>
      Effect.callback<Option.Option<string>>((resume) => {
        const normalizedItems = normalizeContextMenuItems(input.items);
        if (normalizedItems.length === 0) {
          resume(Effect.succeed(Option.none()));
          return;
        }

        let completed = false;
        const complete = (selectedItemId: Option.Option<string>) => {
          if (completed) {
            return;
          }
          completed = true;
          resume(Effect.succeed(selectedItemId));
        };

        const menu = Electron.Menu.buildFromTemplate(buildTemplate(normalizedItems, complete));
        const popupPosition = normalizePosition(input.position);
        const popupOptions = Option.match(popupPosition, {
          onNone: (): Electron.PopupOptions => ({
            window: input.window,
            callback: () => complete(Option.none()),
          }),
          onSome: (position): Electron.PopupOptions => ({
            window: input.window,
            x: position.x,
            y: position.y,
            callback: () => complete(Option.none()),
          }),
        });
        menu.popup(popupOptions);
      }),
    buildDeveloperMenu: (getState) => buildDeveloperMenu(getState),
    buildGitMenu: (getState) => buildGitMenu(getState),
  });
});
