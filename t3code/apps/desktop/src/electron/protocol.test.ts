import { describe, it, expect, vi, beforeEach } from "vitest";
import { app, dialog, BrowserWindow } from "electron";
import { handleDeepLinkUrl, getPendingDeepLink } from "./protocol.ts";

vi.mock("electron", () => {
  const mockWebContents = {
    send: vi.fn(),
  };
  const mockWindow = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: mockWebContents,
  };
  return {
    app: {
      setAsDefaultProtocolClient: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
      quit: vi.fn(),
      on: vi.fn(),
    },
    dialog: {
      showErrorBox: vi.fn(),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => [mockWindow]),
    },
    ipcMain: {
      handle: vi.fn(),
    },
  };
});

describe("Deep Linking Protocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should parse and validate settings URL correctly", () => {
    handleDeepLinkUrl("t3code://settings");
    const windows = BrowserWindow.getAllWindows();
    expect(windows[0].webContents.send).toHaveBeenCalledWith("desktop:deep-link", {
      type: "settings",
      params: {},
    });
  });

  it("should parse and validate chat/thread URL correctly", () => {
    handleDeepLinkUrl("t3code://chat/thread?id=abc123");
    const windows = BrowserWindow.getAllWindows();
    expect(windows[0].webContents.send).toHaveBeenCalledWith("desktop:deep-link", {
      type: "chat-thread",
      params: { id: "abc123" },
    });
  });

  it("should parse and validate open/project URL correctly", () => {
    handleDeepLinkUrl("t3code://open/project?path=/path/to/repo");
    const windows = BrowserWindow.getAllWindows();
    expect(windows[0].webContents.send).toHaveBeenCalledWith("desktop:deep-link", {
      type: "open-project",
      params: { path: "/path/to/repo" },
    });
  });

  it("should reject path traversal attempts and show error dialog", () => {
    handleDeepLinkUrl("t3code://open/project?path=/path/to/../secret");
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      "Security Warning",
      expect.stringContaining("Path traversal attempts")
    );
  });

  it("should show error box on invalid URLs", () => {
    handleDeepLinkUrl("t3code://invalid/url");
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      "Invalid Deep Link",
      expect.stringContaining("Invalid path")
    );
  });
});
