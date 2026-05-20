import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface ApiResponseCacheEndpointConfig {
  readonly timeToLive: Duration.Duration;
  readonly capacity: number;
}

export const DEFAULT_ENDPOINT_CONFIG: ApiResponseCacheEndpointConfig = {
  timeToLive: Duration.minutes(5),
  capacity: 100,
};

export interface ApiResponseCacheShape {
  readonly getOrCompute: <A, E, R>(
    endpoint: string,
    key: string,
    lookup: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly invalidate: (endpoint: string, key: string) => Effect.Effect<void>;
  readonly invalidateEndpoint: (endpoint: string) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
}

export class ApiResponseCache extends Context.Service<
  ApiResponseCache,
  ApiResponseCacheShape
>()("t3/provider/ApiResponseCache") {}

const makeApiResponseCache = Effect.fn("makeApiResponseCache")(function* (
  endpoints: Record<string, ApiResponseCacheEndpointConfig>,
): Effect.Effect<ApiResponseCacheShape> {
  const endpointConfigs = new Map(Object.entries(endpoints));
  const cacheRef = yield* Ref.make(
    new Map<string, Cache.Cache<string, unknown, never>>(),
  );

  const getOrCreateCache = (endpoint: string): Effect.Effect<Cache.Cache<string, unknown, never>> =>
    Ref.modify(cacheRef, (map) => {
      const existing = map.get(endpoint);
      if (existing) return [existing, map] as const;

      const config = endpointConfigs.get(endpoint) ?? DEFAULT_ENDPOINT_CONFIG;
      const newCache = Cache.make<string, unknown, never>({
        capacity: config.capacity,
        timeToLive: config.timeToLive,
      });
      const next = new Map(map).set(endpoint, newCache);
      return [newCache, next] as const;
    }).pipe(Effect.flatten);

  const getOrCompute: ApiResponseCacheShape["getOrCompute"] = <A, E, R>(
    endpoint: string,
    key: string,
    lookup: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    getOrCreateCache(endpoint).pipe(
      Effect.flatMap((cache) =>
        Cache.get(cache, key).pipe(
          Effect.catchAll(() =>
            lookup.pipe(
              Effect.flatMap((value) =>
                Cache.set(cache, key, value as unknown).pipe(Effect.as(value)),
              ),
            ),
          ),
        ),
      ),
    );

  const invalidate = (endpoint: string, key: string): Effect.Effect<void> =>
    Ref.modify(cacheRef, (map) => {
      const cache = map.get(endpoint);
      if (!cache) return [Effect.void, map] as const;
      return [
        Cache.invalidate(cache, key),
        map,
      ] as const;
    }).pipe(Effect.flatten);

  const invalidateEndpoint = (endpoint: string): Effect.Effect<void> =>
    Ref.update(cacheRef, (map) => {
      const next = new Map(map);
      next.delete(endpoint);
      return next;
    });

  const invalidateAll: Effect.Effect<void> = Ref.set(cacheRef, new Map());

  return { getOrCompute, invalidate, invalidateEndpoint, invalidateAll };
});

export const layer = (
  endpoints: Record<string, ApiResponseCacheEndpointConfig> = {},
): Layer.Layer<ApiResponseCache> =>
  Layer.effect(ApiResponseCache, makeApiResponseCache(endpoints));
