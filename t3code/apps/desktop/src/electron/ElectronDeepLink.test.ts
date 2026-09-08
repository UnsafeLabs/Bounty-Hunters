import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { beforeEach, vi } from "vitest";

// Mock Electron
const mockBrowserWindow = {
  getAllWindows: vi.fn(() => []),
  focus: vi.fn(),
  webContents: {
    send: vi.fn(),
  },
};

const mockNotification = {
  isSupported: vi.fn(() => true),
  show: vi.fn(),
};

const mockApp = {
  on: vi.fn(),
  whenReady: Promise.resolve(),
  setAsDefaultProtocolClient: vi.fn(() => true),
};

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: mockBrowserWindow.getAllWindows,
  },
  Notification: mockNotification,
  app: mockApp,
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    registerFileProtocol: vi.fn(() => true),
    unregisterProtocol: vi.fn(),
  },
  ipcMain: {
    emit: vi.fn(),
  },
}));

import * as ElectronDeepLink from "./ElectronDeepLink.ts";

describe("ElectronDeepLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset process.argv
    Object.defineProperty(process, "argv", {
      value: ["node", "main.js"],
      writable: true,
    });
  });

  it("extracts deep link URL from command line arguments", () => {
    Object.defineProperty(process, "argv", {
      value: ["node", "main.js", "t3code://open/project?path=/test"],
      writable: true,
    });

    const url = ElectronDeepLink.getDeepLinkUrlFromArgs();
    assert.isTrue(Option.isSome(url));
    if (Option.isSome(url)) {
      assert.equal(url.value, "t3code://open/project?path=/test");
    }
  });

  it("returns none for no deep link URL in arguments", () => {
    Object.defineProperty(process, "argv", {
      value: ["node", "main.js", "--other-arg"],
      writable: true,
    });

    const url = ElectronDeepLink.getDeepLinkUrlFromArgs();
    assert.isTrue(Option.isNone(url));
  });

  it("handles protocol argument pattern", () => {
    Object.defineProperty(process, "argv", {
      value: ["node", "main.js", "--protocol", "t3code", "t3code://settings"],
      writable: true,
    });

    const url = ElectronDeepLink.getDeepLinkUrlFromArgs();
    assert.isTrue(Option.isSome(url));
    if (Option.isSome(url)) {
      assert.equal(url.value, "t3code://settings");
    }
  });

  it.effect("sets up deep link handling", () =>
    Effect.scoped(
      Layer.build(ElectronDeepLink.layer).pipe(
        Effect.andThen(
          Effect.sync(() => {
            // Verify that setAsDefaultProtocolClient was called
            assert.isTrue(mockApp.setAsDefaultProtocolClient.mock.calls.length > 0);
            const call = mockApp.setAsDefaultProtocolClient.mock.calls[0];
            assert.equal(call[0], "t3code");
          }),
        ),
      ),
    ),
  );
});
