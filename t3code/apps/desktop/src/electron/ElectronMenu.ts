import { ipcRenderer } from "electron";

import type { ContextMenuItem } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";


import * as Electron from "electron";


export interface ElectronMenuPosition {
  readonly x: number;
  readonly y: number;

export interface ElectronMenuContextInput {
  readonly window: Electron.BrowserWindow;
  readonly items: readonly ContextMenuItem[];
  readonly position: Option.Option<ElectronMenuPosition>;
}


export interface ElectronMenuShape {
  readonly setApplicationMenu: (
    template: readonly Electron.MenuItemConstructorOptions[],
  ) => Effect.Effect<void>;
  readonly showContextMenu: (
    input: ElectronMenuContextInput,
  ) => Effect.Effect<Option.Option<string>>;
  readonly popupTemplate: (input: ElectronMenuTemplateInput) => Effect.Effect<void>;
}

export class ElectronMenu extends Context.Service<ElectronMenu, ElectronMenuShape>()(
  "t3/desktop/electron/Menu",
) {}

// Helper function to create developer menu items
const createDeveloperMenu = (): Electron.MenuItemConstructorOptions => ({
  label: "Developer",
  submenu: [
    {
      label: "Toggle Terminal",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+T" : "Ctrl+Shift+T",
      click: () => {
        ipcRenderer.send("developer:toggle-terminal");
      }
    },
    {
      label: "Clear Terminal",
      accelerator: process.platform === "darwin" ? "Cmd+K" : "Ctrl+L",
      click: () => {
        ipcRenderer.send("developer:clear-terminal");
      }
    },
    {
      label: "Restart Backend",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+R" : "Ctrl+Shift+R",
      click: () => {
        ipcRenderer.send("developer:restart-backend");
      }
    },
    {
      label: "Open DevTools",
      accelerator: process.platform === "darwin" ? "Cmd+Alt+I" : "Ctrl+Shift+I",
      click: () => {
        ipcRenderer.send("developer:open-devtools");
      }
    }
  ]
});

// Helper function to create git menu items
const createGitMenu = (): Electron.MenuItemConstructorOptions => ({
  label: "Git",
  submenu: [
    {
      label: "Stage All Changes",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+A" : "Ctrl+Shift+A",
      click: () => {
        ipcRenderer.send("git:stage-all");
      }
    },
    {
      label: "Commit",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+C" : "Ctrl+Shift+C",
      click: () => {
        ipcRenderer.send("git:commit");
      }
    },
    {
      label: "Push",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+P" : "Ctrl+Shift+P",
      click: () => {
        ipcRenderer.send("git:push");
      }
    },
    {
      label: "Pull",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+L" : "Ctrl+Shift+L",
      click: () => {
        ipcRenderer.send("git:pull");
      }
    },
    {
      label: "Create Branch",
      accelerator: process.platform === "darwin" ? "Cmd+Shift+B" : "Ctrl+Shift+B",
      click: () => {
        ipcRenderer.send("git:create-branch");
      }
    }
  ]
});

export interface ElectronMenuShape {
  readonly setApplicationMenu: (
    template: readonly Electron.MenuItemConstructorOptions[],
  ) => Effect.Effect<void>;
  readonly showContextMenu: (
  readonly setApplicationMenu: (
    template: readonly Electron.MenuItemConstructorOptions[],
  ) => Effect.Effect<void>;
  readonly showContextMenu: (
    input: ElectronMenuContextInput,
  ) => Effect.Effect<Option.Option<string>>;
  readonly popupTemplate: (input: ElectronMenuTemplateInput) => Effect.Effect<void>;

export class ElectronMenu extends Context.Service<ElectronMenu, ElectronMenuShape>()(
  "t3/desktop/electron/Menu",
) {
  static readonly setApplicationMenuWithDeveloperAndGit = (
    template: readonly Electron.MenuItemConstructorOptions[],
  ) => {
    // Create a new template with Developer and Git menus added
    const enhancedTemplate = [
      createDeveloperMenu(),
      createGitMenu(),
      ...template
    ];
    
    return ElectronMenu.setApplicationMenu(enhancedTemplate);
  };
}

// Add the Developer and Git menus to the application menu
const originalSetApplicationMenu = ElectronMenu.setApplicationMenu;

function normalizeContextMenuItems(source: readonly ContextMenuItem[]): ContextMenuItem[] {
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
      }
      if (item.destructive && (!item.children || item.children.length === 0)) {
        const destructiveIcon
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
  });
});
