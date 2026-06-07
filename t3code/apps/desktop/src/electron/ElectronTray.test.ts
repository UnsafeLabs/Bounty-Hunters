import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Electron from "electron";

import * as ElectronTray from "./ElectronTray";

// Mock Electron
vi.mock("electron", () => ({
  app: {
    quit: vi.fn(),
  },
  Tray: vi.fn().mockImplementation(() => ({
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
    setImage: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  })),
  Menu: {
    buildFromTemplate: vi.fn().mockReturnValue({}),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
    getFocusedWindow: vi.fn().mockReturnValue(null),
  },
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => true }),
    createFromBuffer: vi.fn().mockReturnValue({ isEmpty: () => false }),
    createEmpty: vi.fn().mockReturnValue({ isEmpty: () => true }),
  },
}));

describe("ElectronTray", () => {
  describe("layer", () => {
    it("should create a tray instance", async () => {
      const program = Effect.gen(function* () {
        const tray = yield* ElectronTray.ElectronTray;
        yield* tray.create("/path/to/icon.png");
        return tray;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(ElectronTray.layer)),
      );

      expect(result).toBeDefined();
    });

    it("should update backend status", async () => {
      const program = Effect.gen(function* () {
        const tray = yield* ElectronTray.ElectronTray;
        yield* tray.create("/path/to/icon.png");
        yield* tray.updateBackendStatus("connected");
        yield* tray.updateBackendStatus("reconnecting");
        yield* tray.updateBackendStatus("disconnected");
      });

      await expect(
        Effect.runPromise(program.pipe(Effect.provide(ElectronTray.layer))),
      ).resolves.toBeUndefined();
    });

    it("should update tooltip", async () => {
      const program = Effect.gen(function* () {
        const tray = yield* ElectronTray.ElectronTray;
        yield* tray.create("/path/to/icon.png");
        yield* tray.updateTooltip("My Project — Connected");
      });

      await expect(
        Effect.runPromise(program.pipe(Effect.provide(ElectronTray.layer))),
      ).resolves.toBeUndefined();
    });

    it("should update recent projects", async () => {
      const program = Effect.gen(function* () {
        const tray = yield* ElectronTray.ElectronTray;
        yield* tray.create("/path/to/icon.png");
        yield* tray.updateRecentProjects(["~/project-a", "~/project-b", "~/project-c"]);
      });

      await expect(
        Effect.runPromise(program.pipe(Effect.provide(ElectronTray.layer))),
      ).resolves.toBeUndefined();
    });

    it("should destroy tray", async () => {
      const program = Effect.gen(function* () {
        const tray = yield* ElectronTray.ElectronTray;
        yield* tray.create("/path/to/icon.png");
        yield* tray.destroy;
      });

      await expect(
        Effect.runPromise(program.pipe(Effect.provide(ElectronTray.layer))),
      ).resolves.toBeUndefined();
    });

    it("should handle multiple create calls gracefully", async () => {
      const program = Effect.gen(function* () {
        const tray = yield* ElectronTray.ElectronTray;
        yield* tray.create("/path/to/icon1.png");
        yield* tray.create("/path/to/icon2.png");
      });

      await expect(
        Effect.runPromise(program.pipe(Effect.provide(ElectronTray.layer))),
      ).resolves.toBeUndefined();
    });
  });
});
