import {
  DESKTOP_TRAY_NEW_CHAT_ACTION,
  encodeDesktopTrayOpenProjectAction,
  type DesktopTrayState,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";

import {
  buildDesktopTrayMenuTemplate,
  makeTrayTooltip,
  normalizeTrayState,
} from "./DesktopTray.ts";

const trayState: DesktopTrayState = {
  connectionStatus: "connected",
  activeProject: {
    id: "project-active",
    environmentId: "environment-local",
    name: "money-maker",
    cwd: "/repo/money-maker",
  },
  recentProjects: [
    {
      id: "project-one",
      environmentId: "environment-local",
      name: "one",
      cwd: "/repo/one",
    },
  ],
};

describe("DesktopTray", () => {
  it("normalizes recent projects to five unique entries", () => {
    const normalized = normalizeTrayState({
      ...trayState,
      recentProjects: [
        { id: "one", environmentId: "env", name: " one ", cwd: "/repo/one" },
        { id: "one", environmentId: "env", name: "duplicate", cwd: "/repo/one-copy" },
        { id: "two", environmentId: "env", name: "two", cwd: "/repo/two" },
        { id: "three", environmentId: "env", name: "three", cwd: "/repo/three" },
        { id: "four", environmentId: "env", name: "four", cwd: "/repo/four" },
        { id: "five", environmentId: "env", name: "five", cwd: "/repo/five" },
        { id: "six", environmentId: "env", name: "six", cwd: "/repo/six" },
      ],
    });

    assert.deepEqual(
      normalized.recentProjects.map((project) => project.id),
      ["one", "two", "three", "four", "five"],
    );
    assert.equal(normalized.recentProjects[0]?.name, "one");
  });

  it("builds tooltip text from app name, connection status, and active project", () => {
    assert.equal(makeTrayTooltip("T3 Code", trayState), "T3 Code\nConnected - money-maker");
    assert.equal(
      makeTrayTooltip("T3 Code", { ...trayState, connectionStatus: "reconnecting" }),
      "T3 Code\nReconnecting - money-maker",
    );
  });

  it("routes menu actions through the shared tray action strings", () => {
    const dispatchedActions: string[] = [];
    const template = buildDesktopTrayMenuTemplate({
      state: trayState,
      windowVisible: false,
      onToggleWindow: () => dispatchedActions.push("toggle"),
      onDispatchMenuAction: (action) => dispatchedActions.push(action),
      onQuit: () => dispatchedActions.push("quit"),
    });

    template[0]?.click?.({} as never, {} as never, {} as never);
    template[1]?.click?.({} as never, {} as never, {} as never);
    const recentSubmenu = template.find((item) => item.label === "Open Recent Project")?.submenu;
    if (!Array.isArray(recentSubmenu)) {
      throw new Error("Expected recent-project submenu to be an array.");
    }
    recentSubmenu[0]?.click?.({} as never, {} as never, {} as never);

    assert.deepEqual(dispatchedActions, [
      "toggle",
      DESKTOP_TRAY_NEW_CHAT_ACTION,
      encodeDesktopTrayOpenProjectAction(trayState.recentProjects[0]!),
    ]);
  });

  it("uses the current visibility for the show or hide menu label", () => {
    const hiddenTemplate = buildDesktopTrayMenuTemplate({
      state: trayState,
      windowVisible: false,
      onToggleWindow: () => {},
      onDispatchMenuAction: () => {},
      onQuit: () => {},
    });
    const visibleTemplate = buildDesktopTrayMenuTemplate({
      state: trayState,
      windowVisible: true,
      onToggleWindow: () => {},
      onDispatchMenuAction: () => {},
      onQuit: () => {},
    });

    assert.equal(hiddenTemplate[0]?.label, "Show Window");
    assert.equal(visibleTemplate[0]?.label, "Hide Window");
  });
});
