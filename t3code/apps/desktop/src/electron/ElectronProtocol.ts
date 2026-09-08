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

import { DesktopEnvironment, type DesktopEnvironmentShape } from "../app/DesktopEnvironment.ts";

export const DESKTOP_SCHEME = "t3";
export const T3CODE_SCHEME = "t3code";

// Types for deep link actions
export interface DeepLinkAction {
  readonly type: "open-project" | "chat-thread" | "settings";
  readonly path?: string;
  readonly id?: string;
}

// Error for invalid deep links
export class ElectronDeepLinkValidationError extends Data.TaggedError(
  "ElectronDeepLinkValidationError",
)<{
  readonly url: string;
  readonly reason: string;
}> {
  override get message() {
    return `Invalid deep link URL ${this.url}: ${this.reason}`;
  }
}

// Error for deep link protocol registration
export class ElectronDeepLinkRegistrationError extends Data.TaggedError(
  "ElectronDeepLinkRegistrationError",
)<{
  readonly scheme: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Failed to register ${this.scheme} deep link protocol.`;
  }
}

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
  readonly registerDeepLinkProtocol: Effect.Effect<
    void,
    ElectronDeepLinkRegistrationError,
    Scope.Scope
  >;
  readonly parseDeepLinkUrl: (
    url: string,
  ) => Effect.Effect<DeepLinkAction, ElectronDeepLinkValidationError, never>;
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

// Validate project path to prevent path traversal attacks
export function validateProjectPath(path: string): Option.Option<string> {
  if (!path) {
    return Option.none();
  }
  
  // Decode URI components
  const decodedPath = decodeURIComponent(path);
  
  // Check for path traversal patterns
  if (decodedPath.includes("..") || decodedPath.includes("//")) {
    return Option.none();
  }
  
  // Check if path starts with a slash (absolute path)
  if (decodedPath.startsWith("/")) {
    return Option.some(decodedPath);
  }
  
  return Option.some("/" + decodedPath);
}

// Parse t3code:// deep link URL
export function parseT3CodeUrl(url: string): Effect.Effect<DeepLinkAction, ElectronDeepLinkValidationError> {
  return Effect.gen(function* () {
    try {
      const parsedUrl = new URL(url);
      
      // Check scheme
      if (parsedUrl.protocol !== "t3code:") {
        return yield* new ElectronDeepLinkValidationError({
          url,
          reason: `Invalid scheme: expected t3code://`,
        });
      }
      
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;
      
      // Parse based on path pattern
      if (pathname.startsWith("/open/project")) {
        const path = searchParams.get("path");
        if (!path) {
          return yield* new ElectronDeepLinkValidationError({
            url,
            reason: "Missing 'path' parameter for project deep link",
          });
        }
        
        const validatedPath = validateProjectPath(path);
        if (Option.isNone(validatedPath)) {
          return yield* new ElectronDeepLinkValidationError({
            url,
            reason: "Invalid project path: path traversal detected",
          });
        }
        
        return {
          type: "open-project",
          path: validatedPath.value,
        } as DeepLinkAction;
      }
      
      if (pathname.startsWith("/chat/thread")) {
        const id = searchParams.get("id");
        if (!id) {
          return yield* new ElectronDeepLinkValidationError({
            url,
            reason: "Missing 'id' parameter for chat thread deep link",
          });
        }
        
        return {
          type: "chat-thread",
          id,
        } as DeepLinkAction;
      }
      
      if (pathname === "/settings" || pathname === "/settings/") {
        return {
          type: "settings",
        } as DeepLinkAction;
      }
      
      return yield* new ElectronDeepLinkValidationError({
        url,
        reason: `Unknown deep link path: ${pathname}`,
      });
    } catch (error) {
      return yield* new ElectronDeepLinkValidationError({
        url,
        reason: `Failed to parse URL: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
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
    {
      scheme: T3CODE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
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

  const registerDeepLinkProtocol = Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ scheme: T3CODE_SCHEME });
    
    const alreadyRegistered = yield* Ref.get(registeredProtocols).pipe(
      Effect.map((protocols) => protocols.has(T3CODE_SCHEME)),
    );
    
    if (alreadyRegistered) {
      return;
    }

    // Set as default protocol client for the t3code scheme
    const success = Electron.app.setAsDefaultProtocolClient(
      T3CODE_SCHEME,
      process.execPath,
      ["--protocol", T3CODE_SCHEME],
    );
    
    if (!success) {
      return yield* new ElectronDeepLinkRegistrationError({
        scheme: T3CODE_SCHEME,
        cause: "setAsDefaultProtocolClient returned false",
      });
    }

    // Track registration
    yield* Ref.update(registeredProtocols, (protocols) => new Set(protocols).add(T3CODE_SCHEME));
  }).pipe(Effect.withSpan("desktop.electron.protocol.registerDeepLinkProtocol"));

  const parseDeepLinkUrl = (url: string): Effect.Effect<DeepLinkAction, ElectronDeepLinkValidationError> => {
    return parseT3CodeUrl(url);
  };

  return ElectronProtocol.of({
    registerFileProtocol,
    registerDesktopFileProtocol,
    registerDeepLinkProtocol,
    parseDeepLinkUrl,
  });
});

export const layer = Layer.effect(ElectronProtocol, make);
