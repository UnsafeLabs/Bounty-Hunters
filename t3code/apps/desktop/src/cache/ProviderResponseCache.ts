import { Effect, Cache, Schema, Duration } from "effect";

export const CacheConfig = Schema.Struct({
  maxSize: Schema.Number.pipe(Schema.positive),
  ttl: Schema.Number.pipe(Schema.positive),  // milliseconds
  keyPrefix: Schema.String,
});

export type CacheConfigType = Schema.Schema.Type<typeof CacheConfig>;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  etag: string | null;
}

export const ProviderResponseCache = Effect.gen(function* (_) {
  const config = yield* _(
    Effect.config(CacheConfig).pipe(
      Effect.orElseSucceed(() => ({
        maxSize: 1000,
        ttl: 300_000, // 5 minutes
        keyPrefix: "provider:",
      }))
    )
  );

  const cache = yield* _(
    Cache.make({
      capacity: config.maxSize,
      timeToLive: Duration.millis(config.ttl),
    })
  );

  const computeKey = (provider: string, model: string, prompt: string): string =>
    `${config.keyPrefix}${provider}:${model}:${hashString(prompt)}`;

  const hashString = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  };

  const get = <T>(provider: string, model: string, prompt: string) =>
    Effect.gen(function* (_) {
      const key = computeKey(provider, model, prompt);
      return yield* _(cache.get(key)) as CacheEntry<T> | undefined;
    });

  const set = <T>(
    provider: string,
    model: string,
    prompt: string,
    value: T,
    etag: string | null = null
  ) =>
    Effect.gen(function* (_) {
      const key = computeKey(provider, model, prompt);
      const entry: CacheEntry<T> = {
        value,
        cachedAt: Date.now(),
        etag,
      };
      yield* _(cache.set(key, entry));
    });

  const getOrCompute = <T>(
    provider: string,
    model: string,
    prompt: string,
    computeFn: () => Effect.Effect<T, Error>
  ) =>
    Effect.gen(function* (_) {
      const cached = yield* _(get<T>(provider, model, prompt));
      if (cached) return cached.value;

      const result = yield* _(computeFn());
      yield* _(set(provider, model, prompt, result));
      return result;
    });

  const invalidate = (provider: string, model: string, prompt: string) =>
    Effect.gen(function* (_) {
      const key = computeKey(provider, model, prompt);
      yield* _(cache.invalidate(key));
    });

  const invalidateProvider = (provider: string) =>
    Effect.gen(function* (_) {
      yield* _(cache.invalidateAll());
    });

  const stats = Effect.gen(function* (_) {
    return {
      size: cache.size,
      capacity: config.maxSize,
    };
  });

  return { get, set, getOrCompute, invalidate, invalidateProvider, stats };
});
