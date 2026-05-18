import { Effect, Schema, Layer } from "effect";

export const BodyLimitConfig = Schema.Struct({
  defaultMaxBytes: Schema.Number.pipe(Schema.positive),
  perRoute: Schema.Record({ key: Schema.String, value: Schema.Number.pipe(Schema.positive) }),
});

export class BodyTooLargeError {
  readonly _tag = "BodyTooLargeError";
  constructor(public readonly limit: number, public readonly actual: number) {}
}

export const RequestBodyLimitMiddleware = Effect.gen(function* (_) {
  const config = yield* _(
    Effect.config(BodyLimitConfig).pipe(
      Effect.orElseSucceed(() => ({
        defaultMaxBytes: 10 * 1024 * 1024, // 10MB
        perRoute: {
          "/api/upload": 100 * 1024 * 1024,    // 100MB
          "/api/chat/completions": 1 * 1024 * 1024, // 1MB
          "/api/images": 50 * 1024 * 1024,     // 50MB
          "/api/import": 200 * 1024 * 1024,    // 200MB
        },
      }))
    )
  );

  const getLimitForRoute = (path: string): number => {
    // Check exact match first
    if (config.perRoute[path]) return config.perRoute[path];
    
    // Check prefix match (e.g., /api/upload/:id matches /api/upload)
    for (const [route, limit] of Object.entries(config.perRoute)) {
      const routePrefix = route.split("/:")[0];
      if (path.startsWith(routePrefix)) return limit;
    }
    
    return config.defaultMaxBytes;
  };

  const validateBodySize = (path: string, contentLength: number) =>
    Effect.gen(function* (_) {
      const limit = getLimitForRoute(path);
      
      if (contentLength > limit) {
        return yield* _(Effect.fail(
          new BodyTooLargeError(limit, contentLength)
        ));
      }
      
      return { limit, actual: contentLength, ok: true };
    });

  const getLimits = () => ({
    default: config.defaultMaxBytes,
    routes: { ...config.perRoute },
  });

  return { validateBodySize, getLimitForRoute, getLimits };
});
