import type { DesktopDeepLinkPayload, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as ElectronApp from "./ElectronApp.ts";

export const T3CODE_DEEP_LINK_SCHEME = "t3code";

type DeepLinkPlatform = NodeJS.Platform;

export type DesktopDeepLinkLaunchMode = "primary" | "secondary";

export interface DesktopDeepLinksShape {
  readonly registerLaunchHandlers: Effect.Effect<
    DesktopDeepLinkLaunchMode,
    never,
    | Scope.Scope
    | DesktopEnvironment.DesktopEnvironment
    | DesktopWindow.DesktopWindow
    | ElectronApp.ElectronApp
  >;
  readonly flushPending: Effect.Effect<
    void,
    DesktopWindow.DesktopWindowError,
    DesktopWindow.DesktopWindow
  >;
}

export class DesktopDeepLinks extends Context.Service<DesktopDeepLinks, DesktopDeepLinksShape>()(
  "t3/desktop/electron/DeepLinks",
) {}

const { logInfo: logDeepLinkInfo, logWarning: logDeepLinkWarning } =
  DesktopObservability.makeComponentLogger("desktop-deep-links");

function deepLinkError(message: string): DesktopDeepLinkPayload {
  return {
    type: "error",
    message,
  };
}

function normalizeDeepLinkRoute(url: URL): string {
  const host = url.hostname.toLowerCase();
  const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  if (host.length > 0) {
    return `${host}${pathname}`.toLowerCase();
  }
  return pathname.replace(/^\/+/, "").toLowerCase();
}

function isAbsoluteProjectPath(projectPath: string, platform: DeepLinkPlatform): boolean {
  if (platform === "win32") {
    return /^[a-zA-Z]:[\\/]/.test(projectPath) || /^\\\\[^\\]+\\[^\\]+/.test(projectPath);
  }
  return projectPath.startsWith("/");
}

export function validateDeepLinkProjectPath(
  projectPath: string,
  platform: DeepLinkPlatform = process.platform,
): string | null {
  const trimmedPath = projectPath.trim();
  if (trimmedPath.length === 0) {
    return "Project links must include a non-empty path.";
  }
  if (trimmedPath.includes("\0")) {
    return "Project paths cannot contain null bytes.";
  }
  if (!isAbsoluteProjectPath(trimmedPath, platform)) {
    return "Project links must use an absolute path.";
  }
  const pathSegments = trimmedPath.split(/[\\/]+/);
  if (pathSegments.some((segment) => segment === "..")) {
    return "Project links cannot contain path traversal segments.";
  }
  return null;
}

export function parseT3CodeDeepLink(
  rawUrl: string,
  platform: DeepLinkPlatform = process.platform,
): DesktopDeepLinkPayload {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return deepLinkError("Invalid t3code link.");
  }

  if (url.protocol !== `${T3CODE_DEEP_LINK_SCHEME}:`) {
    return deepLinkError("Unsupported link protocol.");
  }

  const route = normalizeDeepLinkRoute(url);
  if (route === "settings") {
    return {
      type: "settings",
    };
  }

  if (route === "chat/thread") {
    const threadId = url.searchParams.get("id")?.trim() ?? "";
    if (threadId.length === 0) {
      return deepLinkError("Chat links must include a thread id.");
    }
    return {
      type: "chat-thread",
      threadId: threadId as ThreadId,
    };
  }

  if (route === "open/project") {
    const projectPath = url.searchParams.get("path")?.trim() ?? "";
    const validationError = validateDeepLinkProjectPath(projectPath, platform);
    if (validationError) {
      return deepLinkError(validationError);
    }
    return {
      type: "open-project",
      path: projectPath,
    };
  }

  return deepLinkError("Unsupported t3code link.");
}

export function isT3CodeDeepLinkArg(arg: string): boolean {
  return arg.toLowerCase().startsWith(`${T3CODE_DEEP_LINK_SCHEME}://`);
}

export function findT3CodeDeepLinkArg(args: readonly string[]): string | null {
  return args.find(isT3CodeDeepLinkArg) ?? null;
}

function resolveProtocolRegistrationOptions(
  environment: DesktopEnvironment.DesktopEnvironmentShape,
): { readonly path?: string; readonly args?: readonly string[] } {
  if (!environment.isDevelopment) {
    return {};
  }

  return {
    path: process.execPath,
    args: process.argv.slice(1).filter((arg) => !isT3CodeDeepLinkArg(arg)),
  };
}

const make = Effect.gen(function* () {
  const state = yield* DesktopState.DesktopState;
  const pending = yield* Ref.make<readonly DesktopDeepLinkPayload[]>([]);
  const rendererReady = yield* Ref.make(false);

  const dispatchOrQueue = Effect.fn("desktop.deepLinks.dispatchOrQueue")(function* (
    payload: DesktopDeepLinkPayload,
  ): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
    const ready = yield* Ref.get(rendererReady);
    if (!ready) {
      yield* Ref.update(pending, (current) => [...current, payload]);
      return;
    }

    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.dispatchDeepLink(payload);
  });

  const queueUrl = Effect.fn("desktop.deepLinks.queueUrl")(function* (
    rawUrl: string,
  ): Effect.fn.Return<void, never, DesktopEnvironment.DesktopEnvironment> {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const payload = parseT3CodeDeepLink(rawUrl, environment.platform);
    yield* logDeepLinkInfo("deep link received", { type: payload.type });
    yield* Ref.update(pending, (current) => [...current, payload]);
  });

  const enqueueUrl = Effect.fn("desktop.deepLinks.enqueueUrl")(function* (
    rawUrl: string,
  ): Effect.fn.Return<
    void,
    DesktopWindow.DesktopWindowError,
    DesktopEnvironment.DesktopEnvironment | DesktopWindow.DesktopWindow
  > {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const payload = parseT3CodeDeepLink(rawUrl, environment.platform);
    yield* logDeepLinkInfo("deep link received", { type: payload.type });
    yield* dispatchOrQueue(payload);
  });

  return DesktopDeepLinks.of({
    registerLaunchHandlers: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      const context = yield* Effect.context<
        DesktopEnvironment.DesktopEnvironment | DesktopWindow.DesktopWindow
      >();
      const runPromise = Effect.runPromiseWith(context);

      const hasSingleInstanceLock = yield* electronApp.requestSingleInstanceLock;
      if (!hasSingleInstanceLock) {
        return "secondary" as const;
      }

      const registrationOptions = resolveProtocolRegistrationOptions(environment);
      const registered = yield* electronApp.setAsDefaultProtocolClient(
        T3CODE_DEEP_LINK_SCHEME,
        registrationOptions.path,
        registrationOptions.args,
      );
      if (!registered) {
        yield* logDeepLinkWarning("failed to register default protocol client", {
          scheme: T3CODE_DEEP_LINK_SCHEME,
        });
      }

      yield* electronApp.on("open-url", (event: { preventDefault: () => void }, rawUrl: string) => {
        event.preventDefault();
        void runPromise(enqueueUrl(rawUrl)).catch(() => undefined);
      });

      yield* electronApp.on(
        "second-instance",
        (_event: unknown, commandLine: readonly string[]) => {
          const rawUrl = findT3CodeDeepLinkArg(commandLine);
          void runPromise(
            Effect.gen(function* () {
              const desktopWindow = yield* DesktopWindow.DesktopWindow;
              yield* desktopWindow.activate;
              if (rawUrl) {
                yield* enqueueUrl(rawUrl);
              }
            }),
          ).catch(() => undefined);
        },
      );

      const launchUrl = findT3CodeDeepLinkArg(process.argv);
      if (launchUrl) {
        yield* queueUrl(launchUrl);
      }

      return "primary" as const;
    }).pipe(Effect.withSpan("desktop.deepLinks.registerLaunchHandlers")),
    flushPending: Effect.gen(function* () {
      while (!(yield* Ref.get(state.backendReady))) {
        yield* Effect.sleep(Duration.millis(100));
      }
      yield* Ref.set(rendererReady, true);
      const pendingPayloads = yield* Ref.getAndSet(pending, []);
      for (const payload of pendingPayloads) {
        yield* dispatchOrQueue(payload);
      }
    }).pipe(Effect.withSpan("desktop.deepLinks.flushPending")),
  });
});

export const layer = Layer.effect(DesktopDeepLinks, make);
