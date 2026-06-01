import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Electron from "electron";
import type { DesktopDeepLinkPayload } from "@t3tools/contracts";
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

import * as ElectronApp from "./ElectronApp.ts";
import * as ElectronProtocol from "./ElectronProtocol.ts";

function makeElectronAppLayer() {
  const registrations: Array<{
    protocol: string;
    path: string | undefined;
    args: readonly string[] | undefined;
  }> = [];
  const listeners = new Map<string, Array<(...args: Array<unknown>) => void>>();
  let nextRegistrationResult = true;

  const layer = Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("T3 Code"),
    whenReady: Effect.void,
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    requestSingleInstanceLock: () => Effect.succeed(true),
    setAsDefaultProtocolClient: (protocol, path, args) =>
      Effect.sync(() => {
        registrations.push({ protocol, path, args });
        return nextRegistrationResult;
      }),
    setPath: () => Effect.void,
    setName: () => Effect.void,
    setAboutPanelOptions: () => Effect.void,
    setAppUserModelId: () => Effect.void,
    setDesktopName: () => Effect.void,
    setDockIcon: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    on: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
          const eventListeners = listeners.get(eventName) ?? [];
          eventListeners.push(untypedListener);
          listeners.set(eventName, eventListeners);
        }),
        () =>
          Effect.sync(() => {
            const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
            const eventListeners = listeners.get(eventName) ?? [];
            listeners.set(
              eventName,
              eventListeners.filter((candidate) => candidate !== untypedListener),
            );
          }),
      ).pipe(Effect.asVoid),
  } satisfies ElectronApp.ElectronAppShape);

  return {
    layer,
    listeners,
    registrations,
    setRegistrationResult: (value: boolean) => {
      nextRegistrationResult = value;
    },
  };
}

const flushPromises = Effect.yieldNow;

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

  it.effect("registers the OS protocol handler and dispatches deep link app events", () =>
    Effect.gen(function* () {
      const app = makeElectronAppLayer();
      const dispatched: DesktopDeepLinkPayload[] = [];
      let revealCount = 0;
      let openUrlPrevented = false;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
          yield* electronProtocol.registerDeepLinkProtocol({
            argv: ["electron", ".", "t3code://settings"],
            dispatch: (payload) =>
              Effect.sync(() => {
                dispatched.push(payload);
              }),
            reveal: Effect.sync(() => {
              revealCount += 1;
            }),
          });

          assert.deepEqual(app.registrations, [
            {
              protocol: "t3code",
              path: undefined,
              args: undefined,
            },
          ]);
          assert.deepEqual(dispatched.at(0), {
            kind: "settings",
            rawUrl: "t3code://settings",
          });

          app.listeners.get("second-instance")?.at(0)?.({} as Electron.Event, [
            "electron",
            ".",
            "t3code://chat/thread?id=abc",
          ]);
          yield* flushPromises;
          assert.deepEqual(dispatched.at(1), {
            kind: "chat-thread",
            rawUrl: "t3code://chat/thread?id=abc",
            threadId: "abc",
          });

          app.listeners.get("second-instance")?.at(0)?.({} as Electron.Event, ["electron", "."]);
          yield* flushPromises;
          assert.equal(revealCount, 1);

          app.listeners.get("open-url")?.at(0)?.(
            {
              preventDefault: () => {
                openUrlPrevented = true;
              },
            } as Electron.Event,
            "t3code://open/project?path=%2Ftmp%2Frepo",
          );
          yield* flushPromises;
          assert.isTrue(openUrlPrevented);
          assert.deepEqual(dispatched.at(2), {
            kind: "open-project",
            rawUrl: "t3code://open/project?path=%2Ftmp%2Frepo",
            path: "/tmp/repo",
          });
        }),
      ).pipe(Effect.provide(Layer.merge(ElectronProtocol.layer, app.layer)));
    }),
  );

  it.effect("uses default-app registration args and surfaces registration failures", () =>
    Effect.gen(function* () {
      const app = makeElectronAppLayer();
      app.setRegistrationResult(false);
      const dispatched: DesktopDeepLinkPayload[] = [];
      const processWithDefaultApp = process as NodeJS.Process & { defaultApp?: boolean };
      const originalDefaultApp = processWithDefaultApp.defaultApp;
      processWithDefaultApp.defaultApp = true;

      yield* Effect.scoped(
        Effect.gen(function* () {
          const electronProtocol = yield* ElectronProtocol.ElectronProtocol;
          yield* electronProtocol.registerDeepLinkProtocol({
            argv: ["electron", "/repo/apps/desktop/src/main.ts"],
            dispatch: (payload) =>
              Effect.sync(() => {
                dispatched.push(payload);
              }),
            reveal: Effect.void,
          });
        }),
      ).pipe(
        Effect.provide(Layer.merge(ElectronProtocol.layer, app.layer)),
        Effect.ensuring(
          Effect.sync(() => {
            processWithDefaultApp.defaultApp = originalDefaultApp;
          }),
        ),
      );

      assert.deepEqual(app.registrations, [
        {
          protocol: "t3code",
          path: process.execPath,
          args: ["/repo/apps/desktop/src/main.ts"],
        },
      ]);
      assert.deepEqual(dispatched, [
        {
          kind: "error",
          rawUrl: "t3code://registration",
          message: "T3 Code could not register t3code:// deep links with the operating system.",
        },
      ]);
    }),
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
