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

import type { DesktopDeepLinkPayload, ThreadId } from "@t3tools/contracts";
import { DesktopEnvironment, type DesktopEnvironmentShape } from "../app/DesktopEnvironment.ts";

export const DESKTOP_SCHEME = "t3";
export const DESKTOP_DEEP_LINK_SCHEME = "t3code";

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
}

export class ElectronProtocol extends Context.Service<ElectronProtocol, ElectronProtocolShape>()(
  "t3/desktop/electron/Protocol",
) {}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value);
}

function hasTraversalSegment(value: string): boolean {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function isSafeProjectPath(value: string): boolean {
  if (value.length === 0 || value.includes("\0")) {
    return false;
  }
  if (!value.startsWith("/") && !isWindowsAbsolutePath(value)) {
    return false;
  }
  return !hasTraversalSegment(value);
}

function routeKey(url: URL): string {
  const pathname = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return pathname.length > 0 ? `${url.hostname}/${pathname}` : url.hostname;
}

function deepLinkError(rawUrl: string, message: string): DesktopDeepLinkPayload {
  return { type: "error", message, url: rawUrl };
}

export function parseDesktopDeepLink(rawUrl: string): DesktopDeepLinkPayload {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return deepLinkError(rawUrl, "Invalid T3 Code link.");
  }

  if (url.protocol !== `${DESKTOP_DEEP_LINK_SCHEME}:`) {
    return deepLinkError(rawUrl, "Unsupported T3 Code link protocol.");
  }

  const key = routeKey(url);
  if (key === "settings") {
    return { type: "settings", url: url.href };
  }

  if (key === "chat/thread") {
    const threadId = url.searchParams.get("id")?.trim() ?? "";
    if (threadId.length === 0) {
      return deepLinkError(rawUrl, "Chat thread links must include a thread id.");
    }
    return { type: "chat-thread", threadId: threadId as ThreadId, url: url.href };
  }

  if (key === "open/project") {
    const path = url.searchParams.get("path")?.trim() ?? "";
    if (!isSafeProjectPath(path)) {
      return deepLinkError(rawUrl, "Project links must include a safe absolute path.");
    }
    return { type: "open-project", path, url: url.href };
  }

  return deepLinkError(rawUrl, "Unsupported T3 Code link.");
}

export function findDesktopDeepLinkUrl(argv: readonly string[]): Option.Option<string> {
  return Option.fromNullable(
    argv.find((arg) => {
      try {
        return new URL(arg).protocol === `${DESKTOP_DEEP_LINK_SCHEME}:`;
      } catch {
        return false;
      }
    }),
  );
}

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

  return ElectronProtocol.of({
    registerFileProtocol,
    registerDesktopFileProtocol,
  });
});

export const layer = Layer.effect(ElectronProtocol, make);
