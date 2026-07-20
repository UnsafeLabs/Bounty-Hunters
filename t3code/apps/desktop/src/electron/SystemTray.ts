/**
 * System tray icon model: menu, tooltip, status colors (issue #859).
 */

export type BackendStatus = "connected" | "reconnecting" | "disconnected";

export interface TrayMenuItem {
  id: string;
  label: string;
  type?: "normal" | "submenu" | "separator";
  submenu?: TrayMenuItem[];
  enabled?: boolean;
}

export interface TrayModel {
  tooltip: string;
  status: BackendStatus;
  iconTint: "green" | "yellow" | "red";
  menu: TrayMenuItem[];
  recentProjects: string[];
  windowVisible: boolean;
}

export function statusToTint(status: BackendStatus): "green" | "yellow" | "red" {
  if (status === "connected") return "green";
  if (status === "reconnecting") return "yellow";
  return "red";
}

export function buildTooltip(status: BackendStatus, projectName?: string | null): string {
  const s =
    status === "connected"
      ? "Connected"
      : status === "reconnecting"
        ? "Reconnecting…"
        : "Disconnected";
  return projectName ? `T3 Code — ${s} — ${projectName}` : `T3 Code — ${s}`;
}

export function buildTrayMenu(
  recentProjects: string[],
  windowVisible: boolean,
): TrayMenuItem[] {
  const recent = recentProjects.slice(0, 5).map((p, i) => ({
    id: `recent.${i}`,
    label: p,
    type: "normal" as const,
  }));
  return [
    {
      id: "toggle",
      label: windowVisible ? "Hide Window" : "Show Window",
      type: "normal",
    },
    { id: "newChat", label: "New Chat", type: "normal" },
    {
      id: "recent",
      label: "Open Recent Project",
      type: "submenu",
      submenu: recent.length
        ? recent
        : [{ id: "recent.empty", label: "(none)", enabled: false }],
    },
    { id: "sep1", label: "", type: "separator" },
    { id: "quit", label: "Quit", type: "normal" },
  ];
}

export function createTrayModel(input: {
  status: BackendStatus;
  projectName?: string | null;
  recentProjects?: string[];
  windowVisible?: boolean;
}): TrayModel {
  const recent = input.recentProjects ?? [];
  const visible = input.windowVisible ?? true;
  return {
    status: input.status,
    iconTint: statusToTint(input.status),
    tooltip: buildTooltip(input.status, input.projectName),
    recentProjects: recent.slice(0, 5),
    windowVisible: visible,
    menu: buildTrayMenu(recent, visible),
  };
}

/** Platform click behavior policy. */
export function trayClickAction(
  platform: string,
  button: "left" | "right",
): "toggle-window" | "show-menu" | "none" {
  if (platform === "darwin") {
    return button === "left" ? "toggle-window" : "show-menu";
  }
  // Windows/Linux: left show window, right menu
  if (button === "left") return "toggle-window";
  return "show-menu";
}

export function toggleWindowVisible(visible: boolean): boolean {
  return !visible;
}
