import { EventEmitter } from "node:events";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, WebContents } from "electron";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.assign(new EventEmitter(), {
      requestSingleInstanceLock: vi.fn(() => true),
      setAsDefaultProtocolClient: vi.fn(() => true),
    }),
    ipcMain: new EventEmitter(),
  };
});

import { app, ipcMain } from "electron";
import { createProtocolHandler, parseDeepLink } from "./protocol.ts";
import { DEEP_LINK_CHANNEL, DEEP_LINK_READY_CHANNEL } from "../ipc/channels.ts";

describe("parseDeepLink", () => {
  it.each(["darwin", "linux"] as const)("accepts absolute project paths on %s", (platform) => {
    expect(parseDeepLink("t3code://open/project?path=%2Fwork%2Fmy%20repo", platform)).toEqual({
      type: "project",
      path: "/work/my repo",
    });
  });
  it("accepts Windows drive paths", () => {
    expect(parseDeepLink("t3code://open/project?path=C%3A%5Cwork%5Crepo", "win32")).toEqual({
      type: "project",
      path: "C:\\work\\repo",
    });
  });
  it("parses settings and thread links", () => {
    expect(parseDeepLink("t3code://settings")).toEqual({ type: "settings" });
    expect(parseDeepLink("t3code://chat/thread?id=abc123")).toEqual({
      type: "thread",
      id: "abc123",
    });
  });
  it.each([
    "../repo",
    "/work/../secret",
    "/work/./repo",
    "/work/..\\secret",
    "/work/%2e%2e/secret",
    "/work/\u0000repo",
    "/work/\nrepo",
    "//server/share",
    "~/repo",
    "repo",
  ])("rejects unsafe project path %j", (value) => {
    expect(
      parseDeepLink(`t3code://open/project?path=${encodeURIComponent(value)}`, "linux").type,
    ).toBe("error");
  });
  it.each([
    "C:repo",
    "C:\\work\\..\\secret",
    "C:\\work\\.. \\secret",
    "\\\\server\\share",
    "\\\\?\\C:\\repo",
    "C:\\repo:file",
  ])("rejects unsafe Windows path %j", (value) => {
    expect(
      parseDeepLink(`t3code://open/project?path=${encodeURIComponent(value)}`, "win32").type,
    ).toBe("error");
  });
  it.each([
    "garbage",
    "https://settings",
    "t3code://user@settings",
    "t3code://settings:123",
    "t3code://settings#fragment",
    "t3code://settings#",
    "t3code://settings?extra=1",
    "t3code://unknown",
    "t3code://open/other/../project?path=/repo",
    "t3code://open/project",
    "t3code://open/project?path=",
    "t3code://open/project?path=%ZZ",
    "t3code://open/project?path=%2Frepo&path=%2Fother",
    "t3code://open/project?path=%2F%C0%AE",
    "t3code://chat/thread?id=",
    "t3code://chat/thread?id=../secret",
    "t3code://chat/thread?id=a&id=b",
    "t3code://chat/thread?id=abc&extra=1",
    "t3code://chat/thread?id=%00",
    `t3code://chat/thread?id=${"a".repeat(8192)}`,
  ])("returns an error for invalid URL %j", (url) => {
    expect(parseDeepLink(url).type).toBe("error");
  });
});

const settle = () => Effect.runPromise(Effect.sleep(1));

describe("protocol lifecycle", () => {
  let handler: ReturnType<typeof createProtocolHandler>;
  const originalArgv = process.argv;
  const isDirectory = vi.fn(async () => true);
  const createWindow = () => {
    const webContents = Object.assign(new EventEmitter(), { send: vi.fn(), mainFrame: {} });
    const window = Object.assign(new EventEmitter(), {
      webContents,
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    });
    handler.attachWindow(window as unknown as BrowserWindow);
    return window;
  };
  const ready = (contents: unknown, frame?: unknown) => {
    const webContents = contents as WebContents;
    ipcMain.emit(
      DEEP_LINK_READY_CHANNEL,
      { sender: webContents, senderFrame: frame ?? webContents.mainFrame },
      true,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ["electron", "app.cjs"];
    vi.mocked(app.requestSingleInstanceLock).mockReturnValue(true);
    isDirectory.mockResolvedValue(true);
  });
  afterEach(() => {
    handler?.dispose();
    process.argv = originalArgv;
  });

  it("queues a cold launch until the renderer subscribes", async () => {
    process.argv.push("t3code://settings");
    handler = createProtocolHandler(isDirectory);
    handler.start(vi.fn());
    const window = createWindow();
    await settle();
    expect(window.webContents.send).not.toHaveBeenCalled();
    ready(window.webContents);
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(DEEP_LINK_CHANNEL, {
      type: "settings",
    });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("t3code");
  });
  it("captures macOS open-url events before startup", async () => {
    handler = createProtocolHandler(isDirectory);
    const event = { preventDefault: vi.fn() };
    app.emit("open-url", event, "t3code://chat/thread?id=abc123");
    await settle();
    handler.start(vi.fn());
    const window = createWindow();
    ready(window.webContents);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(DEEP_LINK_CHANNEL, {
      type: "thread",
      id: "abc123",
    });
  });
  it("restores the existing window and handles Windows/Linux second-instance argv", async () => {
    handler = createProtocolHandler(isDirectory);
    handler.start(vi.fn());
    const window = createWindow();
    ready(window.webContents);
    app.emit("second-instance", {}, ["app", "--flag", "t3code://settings", "--other"]);
    await settle();
    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(DEEP_LINK_CHANNEL, { type: "settings" });
  });
  it("does not register a second instance", () => {
    handler = createProtocolHandler(isDirectory);
    vi.mocked(app.requestSingleInstanceLock).mockReturnValue(false);
    expect(handler.start(vi.fn())).toBe(false);
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });
  it("registers the executable and entry point when running in development", () => {
    handler = createProtocolHandler(isDirectory);
    const originalDefaultApp = Object.getOwnPropertyDescriptor(process, "defaultApp");
    Object.defineProperty(process, "defaultApp", { configurable: true, value: true });
    try {
      handler.start(vi.fn());
      expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith("t3code", process.execPath, [
        expect.stringMatching(/[\\/]app\.cjs$/u),
      ]);
    } finally {
      if (originalDefaultApp === undefined) Reflect.deleteProperty(process, "defaultApp");
      else Object.defineProperty(process, "defaultApp", originalDefaultApp);
    }
  });
  it("validates an existing directory before forwarding a project link", async () => {
    handler = createProtocolHandler(isDirectory);
    const window = createWindow();
    ready(window.webContents);
    const projectPath = process.platform === "win32" ? "C:\\work\\repo" : "/work/repo";
    app.emit(
      "open-url",
      { preventDefault: vi.fn() },
      `t3code://open/project?path=${encodeURIComponent(projectPath)}`,
    );
    await settle();
    expect(isDirectory).toHaveBeenCalledExactlyOnceWith(projectPath);
    expect(window.webContents.send).toHaveBeenCalledWith(DEEP_LINK_CHANNEL, {
      type: "project",
      path: projectPath,
    });
  });
  it("rejects readiness from another renderer or a child frame", async () => {
    handler = createProtocolHandler(isDirectory);
    const window = createWindow();
    app.emit("open-url", { preventDefault: vi.fn() }, "t3code://settings");
    await settle();
    ready({ mainFrame: {} });
    ready(window.webContents, {});
    expect(window.webContents.send).not.toHaveBeenCalled();
    ready(window.webContents);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
  });
  it("queues during reload and resumes once without replaying previous links", async () => {
    handler = createProtocolHandler(isDirectory);
    const window = createWindow();
    ready(window.webContents);
    window.webContents.emit("did-start-navigation", {}, "http://localhost", false, true);
    app.emit("open-url", { preventDefault: vi.fn() }, "t3code://settings");
    await settle();
    expect(window.webContents.send).not.toHaveBeenCalled();
    ready(window.webContents);
    ready(window.webContents);
    expect(window.webContents.send).toHaveBeenCalledTimes(1);
  });
  it("recreates a closed macOS window and retains the link", async () => {
    handler = createProtocolHandler(isDirectory);
    const activate = vi.fn();
    handler.start(activate);
    createWindow().emit("closed");
    app.emit("open-url", { preventDefault: vi.fn() }, "t3code://settings");
    await settle();
    expect(activate).toHaveBeenCalled();
    const nextWindow = createWindow();
    ready(nextWindow.webContents);
    expect(nextWindow.webContents.send).toHaveBeenCalledTimes(1);
  });
  it("reports missing directories and malformed links without blocking later links", async () => {
    handler = createProtocolHandler(isDirectory);
    const window = createWindow();
    ready(window.webContents);
    isDirectory.mockRejectedValue(new Error("ENOENT"));
    const projectPath = process.platform === "win32" ? "C:\\missing" : "/missing";
    for (const url of [
      "t3code://bad",
      `t3code://open/project?path=${encodeURIComponent(projectPath)}`,
      "t3code://settings",
    ]) {
      app.emit("open-url", { preventDefault: vi.fn() }, url);
    }
    await settle();
    expect(window.webContents.send.mock.calls.map((call) => call[1].type)).toEqual([
      "error",
      "error",
      "settings",
    ]);
  });
});
