import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import {
  increment,
  providerApiCacheInvalidationsTotal,
  providerApiCacheRequestsTotal,
} from "../observability/Metrics.ts";

export const DEFAULT_PROVIDER_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_PROVIDER_CAPABILITY_CACHE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_PROVIDER_API_CACHE_MAX_ENTRIES = 256;

export type ProviderApiCacheKind = "modelList" | "capabilities";

export interface ProviderApiCacheOptions {
  readonly provider: string;
  readonly instanceId: string;
  readonly kind: ProviderApiCacheKind;
  readonly ttl: Duration.Input;
  readonly capacity?: number | undefined;
}

export interface ProviderApiCacheShape<A, E = never> {
  readonly get: (input: {
    readonly key: string;
    readonly lookup: Effect.Effect<A, E>;
  }) => Effect.Effect<A, E>;
  readonly invalidate: (key: string) => Effect.Effect<void>;
}

const normalizeCapacity = (capacity: number | undefined): number =>
  Math.max(1, Math.floor(capacity ?? DEFAULT_PROVIDER_API_CACHE_MAX_ENTRIES));

const cacheAttributes = (
  options: ProviderApiCacheOptions,
  extra?: Readonly<Record<string, unknown>>,
) => ({
  provider: options.provider,
  instanceId: options.instanceId,
  kind: options.kind,
  ...extra,
});

export const makeProviderApiCache = <A, E = never>(
  options: ProviderApiCacheOptions,
): Effect.Effect<ProviderApiCacheShape<A, E>> =>
  Effect.gen(function* () {
    const lookupsRef = yield* Ref.make(new Map<string, Effect.Effect<A, E>>());
    const cache = yield* Cache.makeWith<string, A, E>(
      (key) =>
        Ref.get(lookupsRef).pipe(
          Effect.flatMap((lookups) => {
            const lookup = lookups.get(key);
            if (!lookup) {
              return Effect.die(new Error(`Provider API cache lookup missing for ${key}`));
            }
            return lookup;
          }),
        ),
      {
        capacity: normalizeCapacity(options.capacity),
        timeToLive: (exit) => (Exit.isSuccess(exit) ? options.ttl : Duration.zero),
      },
    );

    return {
      get: Effect.fn("ProviderApiCache.get")(function* (input) {
        yield* Ref.update(lookupsRef, (lookups) => {
          const nextLookups = new Map(lookups);
          nextLookups.set(input.key, input.lookup);
          return nextLookups;
        });

        const cached = yield* Cache.getOption(cache, input.key);
        if (Option.isSome(cached)) {
          yield* increment(
            providerApiCacheRequestsTotal,
            cacheAttributes(options, { result: "hit" }),
          );
          return cached.value;
        }

        yield* increment(
          providerApiCacheRequestsTotal,
          cacheAttributes(options, { result: "miss" }),
        );
        return yield* Cache.get(cache, input.key);
      }),
      invalidate: Effect.fn("ProviderApiCache.invalidate")(function* (key) {
        yield* Cache.invalidate(cache, key);
        yield* Ref.update(lookupsRef, (lookups) => {
          const nextLookups = new Map(lookups);
          nextLookups.delete(key);
          return nextLookups;
        });
        yield* increment(providerApiCacheInvalidationsTotal, cacheAttributes(options));
      }),
    };
  });
