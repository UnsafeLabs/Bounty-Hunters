import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { beforeEach, vi } from "vitest";

const { registerFileProtocolMock, registerSchemesAsPrivilegedMock, unregisterProtocolMock, setAsDefaultProtocolClientMock } =
  vi.hoisted(() => ({
    registerFileProtocolMock: vi.fn(),
    registerSchemesAsPrivilegedMock: vi.fn(),
    unregisterProtocolMock: vi.fn(),
    setAsDefaultProtocolClientMock: vi.fn(),
  }));

vi.mock("electron", () => ({
  protocol: {
    registerFileProtocol: registerFileProtocolMock,
    registerSchemesAsPrivileged: registerSchemesAsPrivilegedMock,
    unregisterProtocol: unregisterProtocolMock,
  },
  app: {
    setAsDefaultProtocolClient: setAsDefaultProtocolClientMock,
  },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

describe("ElectronProtocol", () => {
  beforeEach(() => {
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

  it("validates safe project paths", () => {
    assert.equal(
      Option.getOrNull(ElectronProtocol.validateProjectPath("/safe/path")),
      "/safe/path",
    );
    assert.equal(
      Option.getOrNull(ElectronProtocol.validateProjectPath("safe/path")),
      "/safe/path",
    );
    assert.isTrue(Option.isNone(ElectronProtocol.validateProjectPath("/../secret")));
    assert.isTrue(Option.isNone(ElectronProtocol.validateProjectPath("/path/../secret")));
    assert.isTrue(Option.isNone(ElectronProtocol.validateProjectPath("")));
  });

  it.effect("parses valid deep link URLs", () =>
    Effect.gen(function* () {
      const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
      
      const projectAction = yield* electronProtocol.parseDeepLinkUrl("t3code://open/project?path=/path/to/repo");
      assert.deepEqual(projectAction, {
        type: "open-project",
        path: "/path/to/repo",
      });
      
      const chatAction = yield* electronProtocol.parseDeepLinkUrl("t3code://chat/thread?id=abc123");
      assert.deepEqual(chatAction, {
        type: "chat-thread",
        id: "abc123",
      });
      
      const settingsAction = yield* electronProtocol.parseDeepLinkUrl("t3code://settings");
      assert.deepEqual(settingsAction, {
        type: "settings",
      });
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("rejects invalid deep link URLs", () =>
    Effect.gen(function* () {
      const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
      
      // Invalid scheme
      const invalidSchemeResult = yield* electronProtocol.parseDeepLinkUrl("http://settings")
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      assert.isNull(invalidSchemeResult);
      
      // Missing path parameter
      const missingPathResult = yield* electronProtocol.parseDeepLinkUrl("t3code://open/project")
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      assert.isNull(missingPathResult);
      
      // Path traversal attempt
      const traversalResult = yield* electronProtocol.parseDeepLinkUrl("t3code://open/project?path=/../secret")
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      assert.isNull(traversalResult);
      
      // Missing id parameter
      const missingIdResult = yield* electronProtocol.parseDeepLinkUrl("t3code://chat/thread")
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      assert.isNull(missingIdResult);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("registers deep link protocol", () =>
    Effect.scoped(
      Layer.build(ElectronProtocol.layer).pipe(
        Effect.andThen(
          Effect.sync(() => {
            assert.deepEqual(setAsDefaultProtocolClientMock.mock.calls, [
              [
                "t3code",
                process.execPath,
                ["--protocol", "t3code"],
              ],
            ]);
          }),
        ),
      ),
    ),
  );
});
