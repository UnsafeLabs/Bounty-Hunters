import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { beforeEach, vi } from "vitest";

const {
  appOnMock,
  appRemoveListenerMock,
  requestSingleInstanceLockMock,
  setAsDefaultProtocolClientMock,
  registerFileProtocolMock,
  registerSchemesAsPrivilegedMock,
  unregisterProtocolMock,
} = vi.hoisted(() => ({
  appOnMock: vi.fn(),
  appRemoveListenerMock: vi.fn(),
  requestSingleInstanceLockMock: vi.fn(() => true),
  setAsDefaultProtocolClientMock: vi.fn(),
  registerFileProtocolMock: vi.fn(),
  registerSchemesAsPrivilegedMock: vi.fn(),
  unregisterProtocolMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    on: appOnMock,
    removeListener: appRemoveListenerMock,
    requestSingleInstanceLock: requestSingleInstanceLockMock,
    setAsDefaultProtocolClient: setAsDefaultProtocolClientMock,
  },
  protocol: {
    registerFileProtocol: registerFileProtocolMock,
    registerSchemesAsPrivileged: registerSchemesAsPrivilegedMock,
    unregisterProtocol: unregisterProtocolMock,
  },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

describe("ElectronProtocol", () => {
  beforeEach(() => {
    appOnMock.mockReset();
    appRemoveListenerMock.mockReset();
    requestSingleInstanceLockMock.mockReset();
    requestSingleInstanceLockMock.mockReturnValue(true);
    setAsDefaultProtocolClientMock.mockReset();
    registerFileProtocolMock.mockReset();
    registerSchemesAsPrivilegedMock.mockReset();
    unregisterProtocolMock.mockReset();
  });

  it("normalizes safe desktop protocol pathnames", () => {
    assert.equal(
      Option.getOrNull(ElectronProtocol.normalizeDesktopProtocolPathname("/settings/./general")),
      "settings/general",
    );
    assert.isTrue(Option.isNone(ElectronProtocol.normalizeDesktopProtocolPathname("/../secret")));
  });

  it("parses supported t3code deep links", () => {
    assert.deepEqual(
      ElectronProtocol.parseDesktopDeepLink("t3code://open/project?path=/Users/alice/repo"),
      { type: "openProject", path: "/Users/alice/repo" },
    );
    assert.deepEqual(ElectronProtocol.parseDesktopDeepLink("t3code://chat/thread?id=abc123"), {
      type: "chatThread",
      id: "abc123",
    });
    assert.deepEqual(ElectronProtocol.parseDesktopDeepLink("t3code://settings"), {
      type: "settings",
    });
  });

  it("rejects invalid project deep links without throwing", () => {
    assert.deepEqual(ElectronProtocol.parseDesktopDeepLink("t3code://open/project?path=../repo"), {
      type: "error",
      message: "Project deep link path must be absolute.",
    });
    assert.deepEqual(
      ElectronProtocol.parseDesktopDeepLink("t3code://open/project?path=/Users/alice/../secret"),
      {
        type: "error",
        message: "Project deep link path cannot contain '..' segments.",
      },
    );
  });

  it.effect("registers t3code protocol listeners and dispatches startup urls", () =>
    Effect.gen(function* () {
      const originalArgv = process.argv;
      process.argv = ["electron", "main.js", "t3code://settings"];
      const links: unknown[] = [];

      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
            const hasLock = yield* electronProtocol.registerDeepLinkProtocol((link) =>
              Effect.sync(() => {
                links.push(link);
              }),
            );
            assert.equal(hasLock, true);
          }),
        );
      } finally {
        process.argv = originalArgv;
      }

      assert.deepEqual(links, [{ type: "settings" }]);
      assert.deepEqual(requestSingleInstanceLockMock.mock.calls, [[]]);
      assert.deepEqual(setAsDefaultProtocolClientMock.mock.calls, [["t3code"]]);
      assert.equal(appOnMock.mock.calls.length, 2);
      assert.deepEqual(
        appRemoveListenerMock.mock.calls.map((call) => call[0]),
        ["open-url", "second-instance"],
      );
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("registers desktop scheme privileges through a layer", () =>
    Effect.scoped(
      Layer.build(ElectronProtocol.layerSchemePrivileges).pipe(
        Effect.andThen(
          Effect.sync(() => {
            assert.deepEqual(registerSchemesAsPrivilegedMock.mock.calls, [
              [
                [
                  {
                    scheme: "t3",
                    privileges: {
                      standard: true,
                      secure: true,
                      supportFetchAPI: true,
                      corsEnabled: true,
                    },
                  },
                ],
              ],
            ]);
          }),
        ),
      ),
    ),
  );

  it.effect("scopes registered file protocols", () =>
    Effect.gen(function* () {
      let capturedHandler:
        | ((
            request: Electron.ProtocolRequest,
            callback: (response: Electron.ProtocolResponse) => void,
          ) => void)
        | undefined;

      registerFileProtocolMock.mockImplementation((_scheme, handler) => {
        capturedHandler = handler;
        return true;
      });

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
          yield* electronProtocol.registerFileProtocol({
            scheme: "t3",
            handler: () => Effect.succeed({ path: "/app/index.html" }),
          });

          assert.isDefined(capturedHandler);
          return yield* Effect.callback<Electron.ProtocolResponse>((resume) => {
            capturedHandler?.({ url: "t3://app/" } as Electron.ProtocolRequest, (response) =>
              resume(Effect.succeed(response)),
            );
          });
        }),
      );

      assert.deepEqual(response, { path: "/app/index.html" });
      assert.deepEqual(
        registerFileProtocolMock.mock.calls.map((call) => call[0]),
        ["t3"],
      );
      assert.deepEqual(unregisterProtocolMock.mock.calls, [["t3"]]);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );
});
