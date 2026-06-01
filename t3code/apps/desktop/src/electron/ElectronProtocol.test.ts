import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import { beforeEach, vi } from "vitest";

const { registerFileProtocolMock, registerSchemesAsPrivilegedMock, unregisterProtocolMock } =
  vi.hoisted(() => ({
    registerFileProtocolMock: vi.fn(),
    registerSchemesAsPrivilegedMock: vi.fn(),
    unregisterProtocolMock: vi.fn(),
  }));

vi.mock("electron", () => ({
  protocol: {
    registerFileProtocol: registerFileProtocolMock,
    registerSchemesAsPrivileged: registerSchemesAsPrivilegedMock,
    unregisterProtocol: unregisterProtocolMock,
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

  it("parses supported t3code deep links", () => {
    assert.deepEqual(ElectronProtocol.parseT3CodeDeepLink("t3code://settings"), {
      kind: "settings",
      rawUrl: "t3code://settings",
    });
    assert.deepEqual(ElectronProtocol.parseT3CodeDeepLink("t3code://chat/thread?id=abc-123"), {
      kind: "chat-thread",
      rawUrl: "t3code://chat/thread?id=abc-123",
      threadId: "abc-123",
    });
    assert.deepEqual(
      ElectronProtocol.parseT3CodeDeepLink("t3code://open/project?path=%2Ftmp%2Frepo"),
      {
        kind: "open-project",
        rawUrl: "t3code://open/project?path=%2Ftmp%2Frepo",
        path: "/tmp/repo",
      },
    );
  });

  it("rejects invalid and unsafe t3code deep links", () => {
    assert.equal(ElectronProtocol.parseT3CodeDeepLink("https://example.com").kind, "error");
    assert.equal(
      ElectronProtocol.parseT3CodeDeepLink("t3code://chat/thread?id=../../secret").kind,
      "error",
    );
    assert.equal(
      ElectronProtocol.parseT3CodeDeepLink("t3code://open/project?path=%2Ftmp%2F..%2Fsecret").kind,
      "error",
    );
    assert.equal(
      ElectronProtocol.parseT3CodeDeepLink("t3code://open/project?path=relative%2Frepo").kind,
      "error",
    );
  });

  it("finds t3code deep link launch arguments", () => {
    assert.equal(
      ElectronProtocol.findT3CodeDeepLinkArg(["electron", ".", "--flag", "t3code://settings"]),
      "t3code://settings",
    );
    assert.equal(ElectronProtocol.findT3CodeDeepLinkArg(["electron", "."]), null);
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
});
