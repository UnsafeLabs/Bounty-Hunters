import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

// ── Tagged Errors ─────────────────────────────────────────────────────

export class ProviderCacheKeyNotFound extends Data.TaggedError(
  "ProviderCacheKeyNotFound",
)<{
  readonly key: string;
}> {
  override get message() {
    return `Provider cache key not found: ${this.key}`;
  }
}

// ── Service Shape ─────────────────────────────────────────────────────

export interface CachedModelList {
  readonly models: ReadonlyArray<unknown>;
  readonly fetchedAt: number;
}

export interface CachedCapability {
  readonly capabilities: Record<string, unknown>;
  readonly fetchedAt: number;
}

export interface ProviderCacheStats {
  readonly modelHits: number;
  readonly modelMisses: number;
  readonly capabilityHits: number;
  readonly capabilityMisses: number;
  readonly modelEntries: number;
  readonly capabilityEntries: number;
}

export interface ProviderCacheShape {
  readonly getOrFetchModelList: <E>(
    providerKey: string,
    fetch: () => Effect.Effect<CachedModelList, E>,
  ) => Effect.Effect<CachedModelList, E>;
  readonly getOrFetchCapability: <E>(
    providerKey: string,
    fetch: () => Effect.Effect<CachedCapability, E>,
  ) => Effect.Effect<CachedCapability, E>;
  readonly invalidateProvider: (providerKey: string) => Effect.Effect<void>;
  readonly getStats: Effect.Effect<ProviderCacheStats>;
}

export class ProviderCache extends Context.Service<
  ProviderCache,
  ProviderCacheShape
>()("t3/provider/ProviderCache") {}

// ── Cache Configuration ───────────────────────────────────────────────

const MODEL_LIST_TTL: Duration.DurationInput = Duration.minutes(5);
const CAPABILITY_TTL: Duration.DurationInput = Duration.minutes(15);
const MAX_CACHE_ENTRIES = 256;

// ── Helpers ───────────────────────────────────────────────────────────

const alwaysFailingLookup = <Value, Key extends string>(
  key: Key,
): Effect.Effect<Value, ProviderCacheKeyNotFound> =>
  Effect.fail(new ProviderCacheKeyNotFound({ key }));

// ── Implementation ────────────────────────────────────────────────────

const make = Effect.gen(function* () {
  const modelHitsRef = yield* Ref.make(0);
  const modelMissesRef = yield* Ref.make(0);
  const capabilityHitsRef = yield* Ref.make(0);
  const capabilityMissesRef = yield* Ref.make(0);

  const modelListCache = yield* Cache.make({
    capacity: MAX_CACHE_ENTRIES,
    timeToLive: MODEL_LIST_TTL,
    lookup: alwaysFailingLookup as (
      key: string,
    ) => Effect.Effect<CachedModelList, ProviderCacheKeyNotFound>,
  });

  const capabilityCache = yield* Cache.make({
    capacity: MAX_CACHE_ENTRIES,
    timeToLive: CAPABILITY_TTL,
    lookup: alwaysFailingLookup as (
      key: string,
    ) => Effect.Effect<CachedCapability, ProviderCacheKeyNotFound>,
  });

  const getOrFetchModelList: ProviderCacheShape["getOrFetchModelList"] = <E>(
    providerKey: string,
    fetch: () => Effect.Effect<CachedModelList, E>,
  ): Effect.Effect<CachedModelList, E> =>
    modelListCache.get(providerKey).pipe(
      Effect.catchAll(() =>
        Effect.gen(function* () {
          yield* Ref.update(modelMissesRef, (n) => n + 1);
          const result = yield* fetch();
          yield* modelListCache.set(providerKey, result);
          return result;
        }),
      ),
      Effect.tap(() => Ref.update(modelHitsRef, (n) => n + 1)),
    );

  const getOrFetchCapability: ProviderCacheShape["getOrFetchCapability"] = <E>(
    providerKey: string,
    fetch: () => Effect.Effect<CachedCapability, E>,
  ): Effect.Effect<CachedCapability, E> =>
    capabilityCache.get(providerKey).pipe(
      Effect.catchAll(() =>
        Effect.gen(function* () {
          yield* Ref.update(capabilityMissesRef, (n) => n + 1);
          const result = yield* fetch();
          yield* capabilityCache.set(providerKey, result);
          return result;
        }),
      ),
      Effect.tap(() => Ref.update(capabilityHitsRef, (n) => n + 1)),
    );

  const invalidateProvider: ProviderCacheShape["invalidateProvider"] = (
    providerKey,
  ) =>
    Effect.gen(function* () {
      yield* modelListCache.invalidate(providerKey);
      yield* capabilityCache.invalidate(providerKey);
    });

  const getStats: ProviderCacheShape["getStats"] = Effect.gen(function* () {
    const [mh, mm, ch, cm, me, ce] = yield* Effect.all(
      [
        Ref.get(modelHitsRef),
        Ref.get(modelMissesRef),
        Ref.get(capabilityHitsRef),
        Ref.get(capabilityMissesRef),
        modelListCache.size,
        capabilityCache.size,
      ],
      { concurrency: 3 },
    );
    return {
      modelHits: mh,
      modelMisses: mm,
      capabilityHits: ch,
      capabilityMisses: cm,
      modelEntries: me,
      capabilityEntries: ce,
    };
  });

  return ProviderCache.of({
    getOrFetchModelList,
    getOrFetchCapability,
    invalidateProvider,
    getStats,
  });
});

export const layer = Layer.effect(ProviderCache, make);
