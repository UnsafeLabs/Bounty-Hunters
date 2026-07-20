/**
 * Developer and Git application menu templates (issue #831).
 */

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export interface MenuItemSpec {
  id: string;
  label: string;
  accelerator?: string;
  role?: string;
  enabled: boolean;
  action: string;
}

export interface MenuSpec {
  id: string;
  label: string;
  submenu: MenuItemSpec[];
}

export interface MenuAvailability {
  backendConnected: boolean;
  hasGitRepo: boolean;
  canCommit: boolean;
  canPush: boolean;
  canPull: boolean;
}

const isMac = (platform: string) => platform === "darwin";

/** VS Code-style accelerators; Command on macOS, Control elsewhere. */
export function accel(key: string, platform: string = process.platform): string {
  const mod = isMac(platform) ? "Command" : "Control";
  const shift = isMac(platform) ? "Command+Shift" : "Control+Shift";
  const map: Record<string, string> = {
    "toggle-terminal": `${mod}+\``,
    "clear-terminal": `${mod}+K`,
    "restart-backend": `${shift}+R`,
    "open-devtools": isMac(platform) ? "Alt+Command+I" : "Control+Shift+I",
    "git-stage-all": `${mod}+Shift+G`,
    "git-commit": `${mod}+Enter`,
    "git-push": `${mod}+Shift+P`,
    "git-pull": `${mod}+Shift+U`,
    "git-create-branch": `${mod}+Shift+B`,
  };
  return map[key] ?? "";
}

export function buildDeveloperMenu(
  availability: MenuAvailability,
  platform: string = process.platform,
): MenuSpec {
  const connected = availability.backendConnected;
  return {
    id: "developer",
    label: "Developer",
    submenu: [
      {
        id: "dev.toggleTerminal",
        label: "Toggle Terminal",
        accelerator: accel("toggle-terminal", platform),
        enabled: true,
        action: "terminal.toggle",
      },
      {
        id: "dev.clearTerminal",
        label: "Clear Terminal",
        accelerator: accel("clear-terminal", platform),
        enabled: true,
        action: "terminal.clear",
      },
      {
        id: "dev.restartBackend",
        label: "Restart Backend",
        accelerator: accel("restart-backend", platform),
        enabled: true,
        action: "backend.restart",
      },
      {
        id: "dev.openDevTools",
        label: "Open DevTools",
        accelerator: accel("open-devtools", platform),
        enabled: true,
        action: "window.openDevTools",
      },
    ].map((item) =>
      item.id === "dev.restartBackend"
        ? { ...item, enabled: connected || true }
        : item,
    ),
  };
}

export function buildGitMenu(
  availability: MenuAvailability,
  platform: string = process.platform,
): MenuSpec {
  const { backendConnected, hasGitRepo, canCommit, canPush, canPull } = availability;
  const gitReady = backendConnected && hasGitRepo;
  return {
    id: "git",
    label: "Git",
    submenu: [
      {
        id: "git.stageAll",
        label: "Stage All Changes",
        accelerator: accel("git-stage-all", platform),
        enabled: gitReady,
        action: "git.stageAll",
      },
      {
        id: "git.commit",
        label: "Commit",
        accelerator: accel("git-commit", platform),
        enabled: gitReady && canCommit,
        action: "git.commit",
      },
      {
        id: "git.push",
        label: "Push",
        accelerator: accel("git-push", platform),
        enabled: gitReady && canPush,
        action: "git.push",
      },
      {
        id: "git.pull",
        label: "Pull",
        accelerator: accel("git-pull", platform),
        enabled: gitReady && canPull,
        action: "git.pull",
      },
      {
        id: "git.createBranch",
        label: "Create Branch",
        accelerator: accel("git-create-branch", platform),
        enabled: gitReady,
        action: "git.createBranch",
      },
    ],
  };
}

/** Merge Developer + Git into an existing app menu template without modifying other menus. */
export function injectDevGitMenus(
  existingTemplate: Array<{ label?: string; submenu?: unknown[] }>,
  availability: MenuAvailability,
  platform: string = process.platform,
): Array<Record<string, unknown>> {
  const without = existingTemplate.filter(
    (m) => m.label !== "Developer" && m.label !== "Git",
  );
  const dev = buildDeveloperMenu(availability, platform);
  const git = buildGitMenu(availability, platform);
  // Insert before Help if present, else append
  const helpIdx = without.findIndex((m) => m.label === "Help");
  const inject = [
    { label: dev.label, submenu: dev.submenu },
    { label: git.label, submenu: git.submenu },
  ];
  if (helpIdx >= 0) {
    return [...without.slice(0, helpIdx), ...inject, ...without.slice(helpIdx)];
  }
  return [...without, ...inject];
}

/** Update enabled flags when connection state changes. */
export function availabilityFromConnection(
  state: ConnectionState,
  opts: Partial<MenuAvailability> = {},
): MenuAvailability {
  return {
    backendConnected: state === "connected",
    hasGitRepo: opts.hasGitRepo ?? true,
    canCommit: opts.canCommit ?? state === "connected",
    canPush: opts.canPush ?? state === "connected",
    canPull: opts.canPull ?? state === "connected",
  };
}

export function dispatchMenuAction(
  action: string,
  rpc: (method: string, params?: Record<string, unknown>) => void | Promise<void>,
): void | Promise<void> {
  return rpc(action);
}
