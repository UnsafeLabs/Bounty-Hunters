import {
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { metricAttributes } from "../../observability/Metrics.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderCache,
  type ProviderCacheError,
  type ProviderCapabilities,
  type ProviderCacheShape,
} from "../Services/ProviderCache.ts";

const MODEL_LIST_TTL = Duration.minutes(5);
const CAPABILITIES_TTL = Duration.minutes(15);
const CACHE_CAPACITY = 100;

const cacheHitsTotal = Metric.counter("t3_provider_cache_hits_total", {
  description: "Total provider cache hits.",
});

const cacheMissesTotal = Metric.counter("t3_provider_cache_misses_total", {
  description: "Total provider cache misses.",
});

const cacheInvalidationsTotal = Metric.counter("t3_provider_cache_invalidations_total", {
  description: "Total provider cache invalidations.",
});

const deriveCapabilities = (
  snapshot: ServerProvider,
): ProviderCapabilities => ({
  sessionModelSwitch: "unsupported",
  modelCount: snapshot.models.length,
  capabilitiesByModel: snapshot.models.flatMap((model) => {
    const descriptors = model.capabilities?.optionDescriptors ?? [];
    return descriptors.length > 0
      ? [{ slug: model.slug, optionDescriptors: descriptors.map((d) => d.hint) }]
      : [];
  }),
});

const makeProviderCache = Effect.fn("makeProviderCache")(function* () {
  const registry = yield* ProviderInstanceRegistry;

  const makeModelListCache = () =>
    Cache.make<ProviderInstanceId, ReadonlyArray<ServerProviderModel>, ProviderCacheError>({
      capacity: CACHE_CAPACITY,
      timeToLive: MODEL_LIST_TTL,
      lookup: (instanceId) =>
        Effect.gen(function* () {
          yield* Metric.update(
            Metric.withAttributes(cacheMissesTotal, metricAttributes({ cache: "modelList" })),
            1,
          );
          const instance = yield* registry.getInstance(instanceId);
          if (!instance) {
            return [] as ReadonlyArray<ServerProviderModel>;
          }
          const snapshot = yield* instance.snapshot.getSnapshot;
          return snapshot.models;
        }).pipe(
          Effect.onInterrupt(Effect.void),
          Effect.onSuccess(() =>
            Metric.update(
              Metric.withAttributes(cacheHitsTotal, metricAttributes({ cache: "modelList" })),
              1,
            ),
          ),
        ),
    });

  const makeCapabilitiesCache = () =>
    Cache.make<ProviderInstanceId, ProviderCapabilities, ProviderCacheError>({
      capacity: CACHE_CAPACITY,
      timeToLive: CAPABILITIES_TTL,
      lookup: (instanceId) =>
        Effect.gen(function* () {
          yield* Metric.update(
            Metric.withAttributes(cacheMissesTotal, metricAttributes({ cache: "capabilities" })),
            1,
          );
          const instance = yield* registry.getInstance(instanceId);
          if (!instance) {
            return {
              sessionModelSwitch: "unsupported" as const,
              modelCount: 0,
              capabilitiesByModel: [],
            };
          }
          const snapshot = yield* instance.snapshot.getSnapshot;
          return deriveCapabilities(snapshot);
        }).pipe(
          Effect.onSuccess(() =>
            Metric.update(
              Metric.withAttributes(
                cacheHitsTotal,
                metricAttributes({ cache: "capabilities" }),
              ),
              1,
            ),
          ),
        ),
    });

  let modelListCache = yield* makeModelListCache();
  let capabilitiesCache = yield* makeCapabilitiesCache();

  const modelListCacheRef = yield* Ref.make(modelListCache);
  const capabilitiesCacheRef = yield* Ref.make(capabilitiesCache);

  yield* Effect.forkScoped(
    Stream.runForEach(registry.streamChanges, () =>
      Effect.gen(function* () {
        const newModelListCache = yield* makeModelListCache();
        const newCapabilitiesCache = yield* makeCapabilitiesCache();
        yield* Ref.set(modelListCacheRef, newModelListCache);
        yield* Ref.set(capabilitiesCacheRef, newCapabilitiesCache);
        yield* Metric.update(
          Metric.withAttributes(
            cacheInvalidationsTotal,
            metricAttributes({ reason: "registryChange" }),
          ),
          1,
        );
      }),
    ),
  );

  const service: ProviderCacheShape = {
    getModelList: (instanceId) =>
      Ref.get(modelListCacheRef).pipe(
        Effect.flatMap((cache) => Cache.get(cache, instanceId)),
      ),
    getCapabilities: (instanceId) =>
      Ref.get(capabilitiesCacheRef).pipe(
        Effect.flatMap((cache) => Cache.get(cache, instanceId)),
      ),
    invalidateProvider: (_instanceId) =>
      Effect.gen(function* () {
        const newModelListCache = yield* makeModelListCache();
        const newCapabilitiesCache = yield* makeCapabilitiesCache();
        yield* Ref.set(modelListCacheRef, newModelListCache);
        yield* Ref.set(capabilitiesCacheRef, newCapabilitiesCache);
        yield* Metric.update(
          Metric.withAttributes(
            cacheInvalidationsTotal,
            metricAttributes({ reason: "explicit" }),
          ),
          1,
        );
      }),
  };

  return service;
});

export const ProviderCacheLive = Layer.effect(ProviderCache, makeProviderCache());
