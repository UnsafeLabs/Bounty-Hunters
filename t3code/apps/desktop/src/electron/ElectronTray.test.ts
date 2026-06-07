import { assert, describe, it } from "@effect/vitest";
import type * as Electron from "electron";
import { vi } from "vitest";

const { createFromDataURLMock } = vi.hoisted(() => ({
  createFromDataURLMock: vi.fn(),
}));

vi.mock("electron", () => ({
  nativeImage: {
    createFromDataURL: createFromDataURLMock,
  },
}));

import {
  buildTrayIcon,
  buildTrayMenuTemplate,
  buildTrayTooltip,
  normalizeRecentProjects,
  statusColor,
} from "./ElectronTray.ts";

describe("ElectronTray", () => {
  it("builds a status-aware tooltip with the active project", () => {
    assert.equal(
      buildTrayTooltip({
        displayName: "T3 Code",
        state: {
          backendStatus: "connected",
          activeProjectName: "acme-web",
          recentProjects: [],
        },
      }),
      "T3 Code\nStatus: Connected\nProject: acme-web",
    );
  });

  it("normalizes recent projects to the newest five unique paths", () => {
    assert.deepEqual(
      normalizeRecentProjects([
        { name: "One", path: "C:\\work\\one" },
        { name: "Duplicate", path: "C:\\work\\one" },
        { path: "C:\\work\\two" },
        { path: "C:\\work\\three" },
        { path: "C:\\work\\four" },
        { path: "C:\\work\\five" },
        { path: "C:\\work\\six" },
      ]),
      [
        { name: "One", path: "C:\\work\\one" },
        { name: "two", path: "C:\\work\\two" },
        { name: "three", path: "C:\\work\\three" },
        { name: "four", path: "C:\\work\\four" },
        { name: "five", path: "C:\\work\\five" },
      ],
    );
  });

  it("builds the required tray menu entries", () => {
    const menu = buildTrayMenuTemplate({
      isWindowVisible: false,
      recentProjects: [{ name: "Repo", path: "/repo" }],
      onToggleWindow: () => {},
      onNewChat: () => {},
      onOpenRecentProject: () => {},
      onQuit: () => {},
    });

    assert.equal(menu[0]?.label, "Show Window");
    assert.equal(menu[1]?.label, "New Chat");
    assert.equal(menu[2]?.label, "Open Recent Project");
    assert.equal((menu[2]?.submenu as Electron.MenuItemConstructorOptions[])[0]?.label, "Repo");
    assert.equal(menu.at(-1)?.label, "Quit");
  });

  it("creates colored tray icons for backend status", () => {
    const resizedImage = {};
    const image = {
      resize: vi.fn(() => resizedImage),
    };
    createFromDataURLMock.mockReturnValue(image);

    assert.equal(statusColor("connected"), "#16a34a");
    assert.equal(buildTrayIcon("connected"), resizedImage);
    const resizeCalls = image.resize.mock.calls as unknown as Array<[Electron.Size]>;
    assert.equal(resizeCalls[0]?.[0]?.width, 16);
    assert.include(createFromDataURLMock.mock.calls[0]?.[0], encodeURIComponent("#16a34a"));
  });
});
