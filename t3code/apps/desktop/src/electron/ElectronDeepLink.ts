import type { DesktopDeepLinkRoute } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronApp from "./ElectronApp.ts";
import * as ElectronDialog from "./ElectronDialog.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

export const DEEP_LINK_SCHEME = "t3code";

export class DeepLinkUrlParseError extends Data.TaggedError("DeepLinkUrlParseError")<{
  readonly url: string;
  readonly issue: string;
}> {
  override get message() {
    return `Invalid ${DEEP_LINK_SCHEME} deep link: ${this.issue}`;
  }
}

export interface ElectronDeepLinkShape {
  readonly register: Effect.Effect<void, never, Scope.Scope>;
  readonly markReadyAndFlush: Effect.Effect<void>;
}

export class ElectronDeepLink extends Context.Service<ElectronDeepLink, ElectronDeepLinkShape>()(
  "t3/desktop/electron/DeepLink",
) {}

const { logWarning: logDeepLinkWarning } =
  DesktopObservability.makeComponentLogger("desktop-deep-link");

function isDeepLinkArg(value: string): boolean {
  return value.startsWith(`${DEEP_LINK_SCHEME}://`);
}

export function findDeepLinkArg(argv: readonly string[]): Option.Option<string> {
  const match = argv.find(isDeepLinkArg);
  return match === undefined ? Option.none() : Option.some(match);
}

export function validateDeepLinkProjectPath(rawPath: string): Option.Option<string> {
  const path = rawPath.trim();
  if (path.length === 0 || path.includes("\0")) {
    return Option.none();
  }

  const hasTraversal = path
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
  return hasTraversal ? Option.none() : Option.some(path);
}

function parseDeepLinkUrlValue(urlString: string): DesktopDeepLinkRoute | DeepLinkUrlParseError {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (cause) {
    return new DeepLinkUrlParseError({
      url: urlString,
      issue: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) {
    return new DeepLinkUrlParseError({
      url: urlString,
      issue: `expected protocol ${DEEP_LINK_SCHEME}:, received ${url.protocol}`,
    });
  }

  const host = url.hostname;
  const routePath = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

  if (host === "settings" && routePath.length === 0) {
    return { kind: "open-settings" };
  }

  if (host === "chat" && routePath === "thread") {
    const id = url.searchParams.get("id")?.trim() ?? "";
    if (id.length === 0) {
      return new DeepLinkUrlParseError({
        url: urlString,
        issue: "chat/thread links require a non-empty id parameter",
      });
    }
    return { kind: "open-thread", id };
  }

  if (host === "open" && routePath === "project") {
    const rawPath = url.searchParams.get("path") ?? "";
    const path = validateDeepLinkProjectPath(rawPath);
    if (Option.isNone(path)) {
      return new DeepLinkUrlParseError({
        url: urlString,
        issue: "open/project links require a non-empty path without traversal segments",
      });
    }
    return { kind: "open-project", path: path.value };
  }

  return new DeepLinkUrlParseError({
    url: urlString,
    issue:
      "supported routes are t3code://open/project?path=<path>, t3code://chat/thread?id=<id>, and t3code://settings",
  });
}

export function parseDeepLinkUrl(
  urlString: string,
): Effect.Effect<DesktopDeepLinkRoute, DeepLinkUrlParseError> {
  const parsed = parseDeepLinkUrlValue(urlString);
  return parsed instanceof DeepLinkUrlParseError ? Effect.fail(parsed) : Effect.succeed(parsed);
}

type ElectronDeepLinkRuntimeServices =
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog
  | ElectronApp.ElectronApp;

const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronDialog = yield* ElectronDialog.ElectronDialog;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const pendingRoutes = yield* Ref.make<readonly DesktopDeepLinkRoute[]>([]);
  const readyToDispatch = yield* Ref.make(false);
  const context = yield* Effect.context<ElectronDeepLinkRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const notifyInvalidDeepLink = (error: unknown) =>
    electronDialog.showErrorBox(
      "Invalid T3 Code link",
      error instanceof Error ? error.message : String(error),
    );

  const sendRoute = Effect.fn("desktop.deepLink.sendRoute")(function* (
    route: DesktopDeepLinkRoute,
  ) {
    const window = yield* desktopWindow.revealOrCreateMain;
    const send = () => {
      if (window.isDestroyed()) return;
      window.webContents.send(IpcChannels.DEEP_LINK_CHANNEL, route);
    };

    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once("did-finish-load", send);
      return;
    }

    send();
  });

  const sendRouteSafely = (route: DesktopDeepLinkRoute) =>
    sendRoute(route).pipe(
      Effect.catchCause((cause) =>
        logDeepLinkWarning("failed to dispatch deep link", { cause: Cause.pretty(cause) }),
      ),
    );

  const dispatchOrQueue = Effect.fn("desktop.deepLink.dispatchOrQueue")(function* (
    route: DesktopDeepLinkRoute,
  ) {
    if (yield* Ref.get(readyToDispatch)) {
      yield* sendRouteSafely(route);
      return;
    }

    yield* Ref.update(pendingRoutes, (routes) => [...routes, route]);
  });

  const handleUrl = (url: string) => {
    void runPromise(
      parseDeepLinkUrl(url).pipe(
        Effect.flatMap(dispatchOrQueue),
        Effect.catchCause((cause) =>
          notifyInvalidDeepLink(Cause.pretty(cause)).pipe(
            Effect.andThen(logDeepLinkWarning("ignored invalid deep link", { url })),
          ),
        ),
      ),
    );
  };

  const register = Effect.gen(function* () {
    yield* Effect.sync(() => {
      Electron.app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    });

    const hasSingleInstanceLock = Electron.app.requestSingleInstanceLock();
    if (!hasSingleInstanceLock) {
      yield* electronApp.quit;
      return;
    }

    const initialUrl = findDeepLinkArg(process.argv);
    if (Option.isSome(initialUrl)) {
      handleUrl(initialUrl.value);
    }

    yield* electronApp.on("open-url", (event: Electron.Event, url: string) => {
      event.preventDefault();
      handleUrl(url);
    });

    yield* electronApp.on(
      "second-instance",
      (
        _event: Electron.Event,
        argv: readonly string[],
        _workingDirectory?: string,
        additionalData?: unknown,
      ) => {
        const additionalUrl =
          typeof additionalData === "object" &&
          additionalData !== null &&
          "url" in additionalData &&
          typeof additionalData.url === "string"
            ? Option.some(additionalData.url)
            : Option.none<string>();
        const url = Option.orElse(findDeepLinkArg(argv), () => additionalUrl);
        if (Option.isSome(url)) {
          handleUrl(url.value);
        } else {
          void runPromise(
            desktopWindow.activate.pipe(
              Effect.catchCause((cause) =>
                logDeepLinkWarning("failed to focus existing window", {
                  cause: Cause.pretty(cause),
                }),
              ),
            ),
          );
        }
      },
    );
  }).pipe(Effect.withSpan("desktop.deepLink.register"));

  const markReadyAndFlush = Effect.gen(function* () {
    yield* Ref.set(readyToDispatch, true);
    const routes = yield* Ref.getAndSet(pendingRoutes, []);
    for (const route of routes) {
      yield* sendRouteSafely(route);
    }
  }).pipe(Effect.withSpan("desktop.deepLink.markReadyAndFlush"));

  return ElectronDeepLink.of({ register, markReadyAndFlush });
});

export const layer = Layer.effect(ElectronDeepLink, make);
