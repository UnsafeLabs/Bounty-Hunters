import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
export interface ProviderCacheEntry { readonly data: unknown; readonly cachedAt: number; readonly ttl: number; }
export interface ProviderCacheShape {
  readonly getCachedModels: (provider: string) => Effect.Effect<unknown>;
  readonly getCachedCapabilities: (provider: string) => Effect.Effect<unknown>;
  readonly invalidateProvider: (provider: string) => Effect.Effect<void>;
}
export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()("t3/server/services/ProviderCache") {
  static readonly layer = Layer.effect(
    ProviderCache,
    Effect.gen(function* () {
      const cache = new Map<string, ProviderCacheEntry>();
      const get = (key: string, ttl: number): Effect.Effect<unknown> => Effect.sync(() => {
        const entry = cache.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.cachedAt > entry.ttl) { cache.delete(key); return undefined; }
        return entry.data;
      });
      const set = (key: string, data: unknown, ttl: number) => { cache.set(key, { data, cachedAt: Date.now(), ttl }); };
      return {
        getCachedModels: (p: string) => get("models:" + p, 5 * 60 * 1000),
        getCachedCapabilities: (p: string) => get("caps:" + p, 15 * 60 * 1000),
        invalidateProvider: (p: string) => Effect.sync(() => { cache.delete("models:" + p); cache.delete("caps:" + p); }),
      };
    }),
  );
}
