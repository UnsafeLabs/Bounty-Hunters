import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { increment, providerApiCacheRequestsTotal } from "../observability/Metrics.ts";
import type { ProviderServiceError } from "../provider/Errors.ts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";

export const DEFAULT_PROVIDER_MODEL_LIST_CACHE_TTL = Duration.minutes(5);
export const DEFAULT_PROVIDER_CAPABILITIES_CACHE_TTL = Duration.minutes(15);
export const DEFAULT_PROVIDER_CACHE_CAPACITY = 512;

type ProviderCacheKind = "models" | "capabilities";
type ProviderCacheResult = "hit" | "miss";

export interface ProviderCacheOptions {
  readonly modelListTtl?: Duration.Input;
  readonly capabilitiesTtl?: Duration.Input;
  readonly capacity?: number;
}

export interface ProviderCacheShape {
  readonly getModelList: (
    input: {
      readonly instanceId: ProviderInstanceId;
      readonly driverKind: ProviderDriverKind;
    },
    lookup: Effect.Effect<ServerProvider>,
  ) => Effect.Effect<ServerProvider>;

  readonly getCapabilities: (
    input: {
      readonly instanceId: ProviderInstanceId;
      readonly driverKind?: ProviderDriverKind | undefined;
    },
    lookup: Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  readonly invalidateProvider: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/services/ProviderCache",
) {}

const cacheKey = (kind: ProviderCacheKind, instanceId: ProviderInstanceId) =>
  `${kind}:${String(instanceId)}`;

const recordCacheRequest = (input: {
  readonly kind: ProviderCacheKind;
  readonly result: ProviderCacheResult;
  readonly instanceId: ProviderInstanceId;
  readonly driverKind?: ProviderDriverKind | undefined;
}) =>
  increment(providerApiCacheRequestsTotal, {
    cache: input.kind,
    result: input.result,
    instanceId: input.instanceId,
    ...(input.driverKind !== undefined ? { provider: input.driverKind } : {}),
  });

const missingLookup = (kind: ProviderCacheKind, key: string) =>
  Effect.die(new Error(`ProviderCache ${kind} lookup missing for key '${key}'.`));

const successTtl =
  (ttl: Duration.Duration) =>
  <A, E>(exit: Exit.Exit<A, E>): Duration.Duration =>
    Exit.isSuccess(exit) ? ttl : Duration.zero;

const makeProviderCache = (options: ProviderCacheOptions = {}) =>
  Effect.gen(function* () {
    const capacity = options.capacity ?? DEFAULT_PROVIDER_CACHE_CAPACITY;
    const modelListTtl =
      options.modelListTtl !== undefined
        ? Duration.fromInputUnsafe(options.modelListTtl)
        : DEFAULT_PROVIDER_MODEL_LIST_CACHE_TTL;
    const capabilitiesTtl =
      options.capabilitiesTtl !== undefined
        ? Duration.fromInputUnsafe(options.capabilitiesTtl)
        : DEFAULT_PROVIDER_CAPABILITIES_CACHE_TTL;

    const modelLookups = yield* Ref.make<ReadonlyMap<string, Effect.Effect<ServerProvider>>>(
      new Map(),
    );
    const capabilitiesLookups = yield* Ref.make<
      ReadonlyMap<string, Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>>
    >(new Map());

    const modelCache = yield* Cache.makeWith<string, ServerProvider>(
      (key) =>
        Ref.get(modelLookups).pipe(
          Effect.flatMap((lookups) => lookups.get(key) ?? missingLookup("models", key)),
        ),
      {
        capacity,
        timeToLive: successTtl(modelListTtl),
      },
    );
    const capabilitiesCache = yield* Cache.makeWith<
      string,
      ProviderAdapterCapabilities,
      ProviderServiceError
    >(
      (key) =>
        Ref.get(capabilitiesLookups).pipe(
          Effect.flatMap((lookups) => lookups.get(key) ?? missingLookup("capabilities", key)),
        ),
      {
        capacity,
        timeToLive: successTtl(capabilitiesTtl),
      },
    );

    const getModelList: ProviderCacheShape["getModelList"] = (input, lookup) => {
      const key = cacheKey("models", input.instanceId);
      return Effect.gen(function* () {
        yield* Ref.update(modelLookups, (lookups) => new Map(lookups).set(key, lookup));
        const hit = yield* Cache.has(modelCache, key);
        yield* recordCacheRequest({
          kind: "models",
          result: hit ? "hit" : "miss",
          instanceId: input.instanceId,
          driverKind: input.driverKind,
        });
        return yield* Cache.get(modelCache, key);
      });
    };

    const getCapabilities: ProviderCacheShape["getCapabilities"] = (input, lookup) => {
      const key = cacheKey("capabilities", input.instanceId);
      return Effect.gen(function* () {
        yield* Ref.update(capabilitiesLookups, (lookups) => new Map(lookups).set(key, lookup));
        const hit = yield* Cache.has(capabilitiesCache, key);
        yield* recordCacheRequest({
          kind: "capabilities",
          result: hit ? "hit" : "miss",
          instanceId: input.instanceId,
          driverKind: input.driverKind,
        });
        return yield* Cache.get(capabilitiesCache, key);
      });
    };

    const invalidateProvider: ProviderCacheShape["invalidateProvider"] = (instanceId) =>
      Effect.all(
        [
          Cache.invalidate(modelCache, cacheKey("models", instanceId)),
          Cache.invalidate(capabilitiesCache, cacheKey("capabilities", instanceId)),
        ],
        { discard: true },
      );

    return {
      getModelList,
      getCapabilities,
      invalidateProvider,
      invalidateAll: Effect.all(
        [Cache.invalidateAll(modelCache), Cache.invalidateAll(capabilitiesCache)],
        { discard: true },
      ),
    } satisfies ProviderCacheShape;
  });

export const makeProviderCacheLive = (options?: ProviderCacheOptions) =>
  Layer.effect(ProviderCache, makeProviderCache(options));

export const ProviderCacheLive = makeProviderCacheLive();
