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

  describe("parseDeepLinkUrl", () => {
    it.effect("parses open/project URL", () =>
      Effect.gen(function* () {
        const action = yield* ElectronProtocol.parseDeepLinkUrl(
          "t3code://open/project?path=%2Fhome%2Fuser%2Fmy-project",
        );
        assert.deepEqual(action, {
          kind: "open-project",
          path: "/home/user/my-project",
        });
      }),
    );

    it.effect("parses chat/thread URL", () =>
      Effect.gen(function* () {
        const action = yield* ElectronProtocol.parseDeepLinkUrl(
          "t3code://chat/thread?id=abc123",
        );
        assert.deepEqual(action, { kind: "open-chat-thread", id: "abc123" });
      }),
    );

    it.effect("parses settings URL", () =>
      Effect.gen(function* () {
        const action = yield* ElectronProtocol.parseDeepLinkUrl("t3code://settings");
        assert.deepEqual(action, { kind: "open-settings" });
      }),
    );

    it.effect("rejects path traversal in open/project", () =>
      Effect.gen(function* () {
        const result = yield* Effect.flip(
          ElectronProtocol.parseDeepLinkUrl("t3code://open/project?path=../../etc"),
        );
        assert.include(result.cause, "traversal");
      }),
    );

    it.effect("rejects unknown action", () =>
      Effect.gen(function* () {
        const result = yield* Effect.flip(
          ElectronProtocol.parseDeepLinkUrl("t3code://unknown/action"),
        );
        assert.include(result.cause, "Unknown action");
      }),
    );

    it.effect("rejects missing path parameter", () =>
      Effect.gen(function* () {
        const result = yield* Effect.flip(
          ElectronProtocol.parseDeepLinkUrl("t3code://open/project"),
        );
        assert.include(result.cause, "Missing path");
      }),
    );

    it.effect("rejects missing id parameter", () =>
      Effect.gen(function* () {
        const result = yield* Effect.flip(
          ElectronProtocol.parseDeepLinkUrl("t3code://chat/thread"),
        );
        assert.include(result.cause, "Missing id");
      }),
    );

    it.effect("rejects wrong protocol", () =>
      Effect.gen(function* () {
        const result = yield* Effect.flip(
          ElectronProtocol.parseDeepLinkUrl("t3://settings"),
        );
        assert.include(result.cause, "Invalid protocol");
      }),
    );
  });
});
