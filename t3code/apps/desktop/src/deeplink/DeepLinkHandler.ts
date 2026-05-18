import { Effect, Schema, Ref } from "effect";
import { app } from "electron";

/**
 * Fix: Add deep linking support via t3code:// custom protocol (#864)
 */

export const DeepLinkRoute = Schema.Union(
  Schema.Struct({ action: Schema.Literal("chat"), roomId: Schema.String }),
  Schema.Struct({ action: Schema.Literal("file"), path: Schema.String }),
  Schema.Struct({ action: Schema.Literal("settings"), section: Schema.String }),
  Schema.Struct({ action: Schema.Literal("extension"), extensionId: Schema.String }),
  Schema.Struct({ action: Schema.Literal("import"), url: Schema.String }),
);

export type DeepLinkRouteType = Schema.Schema.Type<typeof DeepLinkRoute>;

export const DeepLinkHandler = Effect.gen(function* (_) {
  const pendingRef = yield* _(Ref.make<DeepLinkRouteType | null>(null));

  const registerProtocol = Effect.sync(() => {
    if (process.defaultApp || process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("t3code", process.execPath, [
        process.argv[1] || "",
      ]);
    } else {
      app.setAsDefaultProtocolClient("t3code");
    }
  });

  const parseDeepLink = (url: string): Effect.Effect<DeepLinkRouteType, Error> =>
    Effect.gen(function* (_) {
      const parsed = new URL(url);

      if (parsed.protocol !== "t3code:") {
        return yield* _(Effect.fail(new Error(`Invalid protocol: ${parsed.protocol}`)));
      }

      const action = parsed.hostname;
      const params = Object.fromEntries(parsed.searchParams.entries());

      switch (action) {
        case "chat":
          return { action: "chat" as const, roomId: params.roomId || params.id || "" };
        case "file":
          return { action: "file" as const, path: params.path || "" };
        case "settings":
          return { action: "settings" as const, section: params.section || "general" };
        case "extension":
          return { action: "extension" as const, extensionId: params.id || "" };
        case "import":
          return { action: "import" as const, url: params.url || "" };
        default:
          return yield* _(Effect.fail(new Error(`Unknown action: ${action}`)));
      }
    });

  const handleDeepLink = (url: string) =>
    Effect.gen(function* (_) {
      const route = yield* _(parseDeepLink(url));
      yield* _(Ref.set(pendingRef, route));
      return route;
    });

  const getPending = Effect.gen(function* (_) {
    const pending = yield* _(Ref.get(pendingRef));
    if (pending) yield* _(Ref.set(pendingRef, null));
    return pending;
  });

  // Handle macOS open-url event
  const handleOpenUrl = Effect.sync(() => {
    app.on("open-url", (event, url) => {
      event.preventDefault();
      if (url.startsWith("t3code://")) {
        Effect.runFork(handleDeepLink(url));
      }
    });
  });

  // Handle Windows/Linux second-instance
  const handleSecondInstance = Effect.sync(() => {
    app.on("second-instance", (_, argv) => {
      const deepLink = argv.find((arg) => arg.startsWith("t3code://"));
      if (deepLink) {
        Effect.runFork(handleDeepLink(deepLink));
      }
    });
  });

  return {
    registerProtocol,
    parseDeepLink,
    handleDeepLink,
    getPending,
    handleOpenUrl,
    handleSecondInstance,
  };
});
