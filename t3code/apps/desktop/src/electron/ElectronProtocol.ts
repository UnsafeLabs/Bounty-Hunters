import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";
import type { DesktopDeepLinkPayload } from "@t3tools/contracts";

import { DesktopEnvironment, type DesktopEnvironmentShape } from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "./ElectronApp.ts";

export const DESKTOP_SCHEME = "t3";
export const DEEP_LINK_SCHEME = "t3code";

const MAX_DEEP_LINK_URL_LENGTH = 4_096;
const MAX_DEEP_LINK_THREAD_ID_LENGTH = 256;
const MAX_DEEP_LINK_PROJECT_PATH_LENGTH = 4_096;
const THREAD_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class ElectronProtocolRegistrationError extends Data.TaggedError(
  "ElectronProtocolRegistrationError",
)<{
  readonly scheme: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Failed to register ${this.scheme}: file protocol.`;
  }
}

export class ElectronProtocolStaticBundleMissingError extends Data.TaggedError(
  "ElectronProtocolStaticBundleMissingError",
)<{}> {
  override get message() {
    return "Desktop static bundle missing. Build apps/server (with bundled client) first.";
  }
}

export interface ElectronProtocolShape {
  readonly registerFileProtocol: <E, R>(input: {
    readonly scheme: string;
    readonly handler: (
      request: Electron.ProtocolRequest,
    ) => Effect.Effect<Electron.ProtocolResponse, E, R>;
    readonly onFailure?: (
      request: Electron.ProtocolRequest,
      cause: Cause.Cause<E>,
    ) => Electron.ProtocolResponse;
  }) => Effect.Effect<void, ElectronProtocolRegistrationError, R | Scope.Scope>;
  readonly registerDesktopFileProtocol: Effect.Effect<
    void,
    ElectronProtocolRegistrationError | ElectronProtocolStaticBundleMissingError,
    FileSystem.FileSystem | DesktopEnvironment | Scope.Scope
  >;
  readonly registerDeepLinkProtocol: <E, R>(input: {
    readonly argv?: readonly string[];
    readonly dispatch: (payload: DesktopDeepLinkPayload) => Effect.Effect<void, E, R>;
    readonly reveal: Effect.Effect<void, E, R>;
  }) => Effect.Effect<void, never, ElectronApp.ElectronApp | R | Scope.Scope>;
}

export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
  "t3/desktop/electron/Protocol",
) {}

export function normalizeDesktopProtocolPathname(rawPath: string): Option.Option<string> {
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return Option.none();
    }
    segments.push(segment);
  }
  return Option.some(segments.join("/"));
}

function deepLinkError(rawUrl: string, message: string): DesktopDeepLinkPayload {
  return {
    kind: "error",
    rawUrl,
    message,
  };
}

function isEmptyOrRootPathname(pathname: string): boolean {
  return pathname.length === 0 || pathname === "/";
}

function hasExactlyOneParam(url: URL, key: string): boolean {
  return url.searchParams.getAll(key).length === 1;
}

function hasProjectPathTraversal(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment === "..");
}

function isAbsoluteProjectPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

function isUnsafeProjectPath(path: string): boolean {
  return (
    path.length === 0 ||
    path.length > MAX_DEEP_LINK_PROJECT_PATH_LENGTH ||
    path.includes("\0") ||
    hasProjectPathTraversal(path) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) ||
    !isAbsoluteProjectPath(path)
  );
}

export function parseT3CodeDeepLink(rawUrl: string): DesktopDeepLinkPayload {
  if (rawUrl.length > MAX_DEEP_LINK_URL_LENGTH) {
    return deepLinkError(rawUrl, "Deep link URL is too long.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return deepLinkError(rawUrl, "Deep link URL is invalid.");
  }

  if (url.protocol.toLowerCase() !== `${DEEP_LINK_SCHEME}:`) {
    return deepLinkError(rawUrl, "Deep link must use the t3code:// protocol.");
  }

  const route = url.hostname.toLowerCase();
  if (route === "settings" && isEmptyOrRootPathname(url.pathname) && url.search.length === 0) {
    return { kind: "settings", rawUrl };
  }

  if (route === "chat" && url.pathname === "/thread" && hasExactlyOneParam(url, "id")) {
    const threadId = url.searchParams.get("id")?.trim() ?? "";
    if (
      threadId.length === 0 ||
      threadId.length > MAX_DEEP_LINK_THREAD_ID_LENGTH ||
      !THREAD_ID_PATTERN.test(threadId)
    ) {
      return deepLinkError(rawUrl, "Deep link thread id is invalid.");
    }
    return {
      kind: "chat-thread",
      rawUrl,
      threadId,
    };
  }

  if (route === "open" && url.pathname === "/project" && hasExactlyOneParam(url, "path")) {
    const projectPath = url.searchParams.get("path")?.trim() ?? "";
    if (isUnsafeProjectPath(projectPath)) {
      return deepLinkError(rawUrl, "Deep link project path is invalid or unsafe.");
    }
    return {
      kind: "open-project",
      rawUrl,
      path: projectPath,
    };
  }

  return deepLinkError(rawUrl, "Deep link route is not supported.");
}

export function findT3CodeDeepLinkArg(argv: readonly string[]): string | null {
  const prefix = `${DEEP_LINK_SCHEME}://`;
  return argv.find((arg) => arg.toLowerCase().startsWith(prefix)) ?? null;
}

function getProtocolClientRegistrationArgs(argv: readonly string[]): readonly string[] | undefined {
  const processWithDefaultApp = process as NodeJS.Process & { readonly defaultApp?: boolean };
  if (processWithDefaultApp.defaultApp !== true || argv.length < 2) {
    return undefined;
  }
  return [argv[1] ?? ""].filter((arg) => arg.length > 0);
}

const registerDesktopSchemePrivileges = Effect.sync(() => {
  Electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}).pipe(Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"));

export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);

const resolveDesktopStaticDir: Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | DesktopEnvironment
> = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const environment = yield* DesktopEnvironment;
  const candidates = [
    environment.path.join(environment.appRoot, "apps/server/dist/client"),
    environment.path.join(environment.appRoot, "apps/web/dist"),
  ];
  for (const candidate of candidates) {
    const hasIndex = yield* fileSystem
      .exists(environment.path.join(candidate, "index.html"))
      .pipe(Effect.orElseSucceed(() => false));
    if (hasIndex) {
      return Option.some(candidate);
    }
  }
  return Option.none<string>();
});

const resolveDesktopStaticPath = Effect.fn("desktop.electron.protocol.resolveDesktopStaticPath")(
  function* (
    staticRoot: string,
    requestUrl: string,
  ): Effect.fn.Return<string, never, FileSystem.FileSystem | DesktopEnvironment> {
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = yield* DesktopEnvironment;
    const url = new URL(requestUrl);
    const rawPath = decodeURIComponent(url.pathname);
    const normalizedPath = normalizeDesktopProtocolPathname(rawPath);
    if (Option.isNone(normalizedPath)) {
      return environment.path.join(staticRoot, "index.html");
    }

    const requestedPath = normalizedPath.value.length > 0 ? normalizedPath.value : "index.html";
    const resolvedPath = environment.path.join(staticRoot, requestedPath);

    if (environment.path.extname(resolvedPath)) {
      return resolvedPath;
    }

    const nestedIndex = environment.path.join(resolvedPath, "index.html");
    const nestedIndexExists = yield* fileSystem
      .exists(nestedIndex)
      .pipe(Effect.orElseSucceed(() => false));
    if (nestedIndexExists) {
      return nestedIndex;
    }

    return environment.path.join(staticRoot, "index.html");
  },
);

function isStaticAssetRequest(requestUrl: string, environment: DesktopEnvironmentShape): boolean {
  try {
    const url = new URL(requestUrl);
    return environment.path.extname(url.pathname).length > 0;
  } catch {
    return false;
  }
}

const make = Effect.gen(function* () {
  const registeredProtocols = yield* Ref.make<ReadonlySet<string>>(new Set());

  const registerFileProtocol = Effect.fn("desktop.electron.protocol.registerFileProtocol")(
    function* <E, R>({
      scheme,
      handler,
      onFailure,
    }: {
      readonly scheme: string;
      readonly handler: (
        request: Electron.ProtocolRequest,
      ) => Effect.Effect<Electron.ProtocolResponse, E, R>;
      readonly onFailure?: (
        request: Electron.ProtocolRequest,
        cause: Cause.Cause<E>,
      ) => Electron.ProtocolResponse;
    }): Effect.fn.Return<void, ElectronProtocolRegistrationError, R | Scope.Scope> {
      yield* Effect.annotateCurrentSpan({ scheme });
      const alreadyRegistered = yield* Ref.get(registeredProtocols).pipe(
        Effect.map((protocols) => protocols.has(scheme)),
      );
      if (alreadyRegistered) {
        return;
      }

      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const registered = Electron.protocol.registerFileProtocol(
              scheme,
              (request, callback) => {
                const response = handler(request).pipe(
                  Effect.withSpan("desktop.electron.protocol.handleFileRequest"),
                  Effect.catchCause((cause) =>
                    Effect.succeed(onFailure?.(request, cause) ?? ({ error: -2 } as const)),
                  ),
                );

                void runPromise(response).then(callback, () => callback({ error: -2 }));
              },
            );
            if (!registered) {
              throw new ElectronProtocolRegistrationError({
                scheme,
                cause: "registerFileProtocol returned false",
              });
            }
          },
          catch: (cause) =>
            cause instanceof ElectronProtocolRegistrationError
              ? cause
              : new ElectronProtocolRegistrationError({ scheme, cause }),
        }).pipe(
          Effect.andThen(
            Ref.update(registeredProtocols, (protocols) => new Set(protocols).add(scheme)),
          ),
        ),
        () =>
          Effect.sync(() => {
            Electron.protocol.unregisterProtocol(scheme);
          }).pipe(
            Effect.andThen(
              Ref.update(registeredProtocols, (protocols) => {
                const next = new Set(protocols);
                next.delete(scheme);
                return next;
              }),
            ),
          ),
      );
    },
  );

  const registerDesktopFileProtocol = Effect.gen(function* () {
    const environment = yield* DesktopEnvironment;
    if (environment.isDevelopment) return;

    const staticRoot = yield* resolveDesktopStaticDir;
    if (Option.isNone(staticRoot)) {
      return yield* new ElectronProtocolStaticBundleMissingError();
    }

    const staticRootResolved = environment.path.resolve(staticRoot.value);
    const staticRootPrefix = `${staticRootResolved}${environment.path.sep}`;
    const fallbackIndex = environment.path.join(staticRootResolved, "index.html");

    yield* registerFileProtocol({
      scheme: DESKTOP_SCHEME,
      handler: Effect.fn("desktop.electron.protocol.handleDesktopFileRequest")(function* (request) {
        const fileSystem = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment;
        const candidate = yield* resolveDesktopStaticPath(staticRootResolved, request.url);
        const resolvedCandidate = environment.path.resolve(candidate);
        const isInRoot =
          resolvedCandidate === fallbackIndex || resolvedCandidate.startsWith(staticRootPrefix);
        const isAssetRequest = isStaticAssetRequest(request.url, environment);
        const exists = yield* fileSystem
          .exists(resolvedCandidate)
          .pipe(Effect.orElseSucceed(() => false));

        if (!isInRoot || !exists) {
          return isAssetRequest ? ({ error: -6 } as const) : ({ path: fallbackIndex } as const);
        }

        return { path: resolvedCandidate } as const;
      }),
      onFailure: () => ({ path: fallbackIndex }),
    });
  }).pipe(Effect.withSpan("desktop.electron.protocol.registerDesktopFileProtocol"));

  const registerDeepLinkProtocol = Effect.fn("desktop.electron.protocol.registerDeepLinkProtocol")(
    function* <E, R>({
      argv = process.argv,
      dispatch,
      reveal,
    }: {
      readonly argv?: readonly string[];
      readonly dispatch: (payload: DesktopDeepLinkPayload) => Effect.Effect<void, E, R>;
      readonly reveal: Effect.Effect<void, E, R>;
    }): Effect.fn.Return<void, never, ElectronApp.ElectronApp | R | Scope.Scope> {
      const electronApp = yield* ElectronApp.ElectronApp;
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);
      const registrationArgs = getProtocolClientRegistrationArgs(argv);

      const dispatchDeepLinkUrl = (rawUrl: string) =>
        dispatch(parseT3CodeDeepLink(rawUrl)).pipe(Effect.catchCause(() => Effect.void));

      const didRegister = yield* electronApp.setAsDefaultProtocolClient(
        DEEP_LINK_SCHEME,
        registrationArgs ? process.execPath : undefined,
        registrationArgs,
      );
      if (!didRegister) {
        yield* dispatch(
          deepLinkError(
            `${DEEP_LINK_SCHEME}://registration`,
            "T3 Code could not register t3code:// deep links with the operating system.",
          ),
        ).pipe(Effect.catchCause(() => Effect.void));
      }

      const handleArgv = (nextArgv: readonly string[]) => {
        const rawUrl = findT3CodeDeepLinkArg(nextArgv);
        void runPromise(
          rawUrl ? dispatchDeepLinkUrl(rawUrl) : reveal.pipe(Effect.catchCause(() => Effect.void)),
        );
      };

      yield* electronApp.on("second-instance", (_event: Electron.Event, nextArgv: string[]) => {
        handleArgv(nextArgv);
      });

      yield* electronApp.on("open-url", (event: Electron.Event, rawUrl: string) => {
        event.preventDefault();
        void runPromise(dispatchDeepLinkUrl(rawUrl));
      });

      const initialUrl = findT3CodeDeepLinkArg(argv);
      if (initialUrl) {
        yield* dispatchDeepLinkUrl(initialUrl);
      }
    },
  );

  return ElectronProtocol.of({
    registerFileProtocol,
    registerDesktopFileProtocol,
    registerDeepLinkProtocol,
  });
});

export const layer = Layer.effect(ElectronProtocol, make);
