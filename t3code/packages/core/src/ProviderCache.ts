import { Effect, Cache, Duration, Ref } from "effect";

export interface ProviderData {
  models: string[];
  capabilities: string[];
}

export interface CacheMetrics {
  hits: number;
  misses: number;
}

export class ProviderCacheService {
  private hitsRef = Ref.unsafeMake(0);
  private missesRef = Ref.unsafeMake(0);

  // Fallback handlers if none provided to method
  private fetchModelsFallback = (provider: string) => 
    Effect.succeed({ models: ["default-model-1"] } as any);
    
  private fetchCapabilitiesFallback = (provider: string) => 
    Effect.succeed({ capabilities: ["text-gen"] } as any);

  public readonly modelsCache = Cache.unsafeMake({
    capacity: 100,
    timeToLive: Duration.minutes(5),
    lookup: (provider: string) => Effect.suspend(() => {
      Ref.unsafeUpdate(this.missesRef, n => n + 1);
      return this.fetchModelsFallback(provider);
    })
  });

  public readonly capabilitiesCache = Cache.unsafeMake({
    capacity: 100,
    timeToLive: Duration.minutes(15),
    lookup: (provider: string) => Effect.suspend(() => {
      Ref.unsafeUpdate(this.missesRef, n => n + 1);
      return this.fetchCapabilitiesFallback(provider);
    })
  });

  public getModels(provider: string, fetcher?: (p: string) => Effect.Effect<ProviderData, Error>): Effect.Effect<ProviderData, Error> {
    return Effect.gen(this, function* (_) {
      if (fetcher) {
        // Temporarily swap fallback for this lookup if needed
        this.fetchModelsFallback = fetcher as any;
      }
      
      const contains = yield* _(Cache.contains(this.modelsCache, provider));
      if (contains) {
        yield* _(Ref.update(this.hitsRef, n => n + 1));
      }
      
      return yield* _(Cache.get(this.modelsCache, provider));
    });
  }

  public getCapabilities(provider: string, fetcher?: (p: string) => Effect.Effect<ProviderData, Error>): Effect.Effect<ProviderData, Error> {
    return Effect.gen(this, function* (_) {
      if (fetcher) {
        this.fetchCapabilitiesFallback = fetcher as any;
      }

      const contains = yield* _(Cache.contains(this.capabilitiesCache, provider));
      if (contains) {
        yield* _(Ref.update(this.hitsRef, n => n + 1));
      }

      return yield* _(Cache.get(this.capabilitiesCache, provider));
    });
  }

  public invalidateProvider(provider: string): Effect.Effect<void, never> {
    return Effect.all([
      Cache.invalidate(this.modelsCache, provider),
      Cache.invalidate(this.capabilitiesCache, provider)
    ], { discard: true });
  }

  public getMetrics(): Effect.Effect<CacheMetrics, never> {
    return Effect.gen(this, function* (_) {
      const hits = yield* _(Ref.get(this.hitsRef));
      const misses = yield* _(Ref.get(this.missesRef));
      return { hits, misses };
    });
  }
}
