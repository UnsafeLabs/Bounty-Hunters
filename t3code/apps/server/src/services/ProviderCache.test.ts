import { describe, it, assert } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import { ProviderCache, makeProviderCacheLive } from "./ProviderCache.ts";

const codexDriver = ProviderDriverKind.make("codex");
const codexInstanceId = ProviderInstanceId.make("codex");

const makeProvider = (checkedAt: string): ServerProvider => ({
  instanceId: codexInstanceId,
  driver: codexDriver,
  status: "ready",
  enabled: true,
  installed: true,
  auth: { status: "authenticated" },
  checkedAt,
  version: "1.0.0",
  models: [
    {
      slug: `model-${checkedAt}`,
      name: `Model ${checkedAt}`,
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
});

const cacheLayer = makeProviderCacheLive({
  capacity: 16,
  modelListTtl: Duration.seconds(1),
  capabilitiesTtl: Duration.seconds(1),
});
const testLayer = Layer.mergeAll(cacheLayer, TestClock.layer());

const runWithCache = <A, E>(effect: Effect.Effect<A, E, ProviderCache | Scope.Scope>) =>
  Effect.scoped(effect).pipe(Effect.provide(testLayer));

const hasMetricSnapshot = (
  snapshots: ReadonlyArray<Metric.Metric.Snapshot>,
  attributes: Readonly<Record<string, string>>,
) =>
  snapshots.some(
    (snapshot) =>
      snapshot.id === "t3_provider_api_cache_requests_total" &&
      Object.entries(attributes).every(([key, value]) => snapshot.attributes?.[key] === value),
  );

describe("ProviderCache", () => {
  it.effect("serves provider model lists from cache within TTL and refreshes after expiry", () =>
    runWithCache(
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        const calls = yield* Ref.make(0);
        const lookup = Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.map((count) => makeProvider(`2026-01-01T00:00:0${count}.000Z`)),
        );

        const first = yield* cache.getModelList(
          { instanceId: codexInstanceId, driverKind: codexDriver },
          lookup,
        );
        const second = yield* cache.getModelList(
          { instanceId: codexInstanceId, driverKind: codexDriver },
          lookup,
        );

        assert.equal(first.checkedAt, second.checkedAt);
        assert.equal(yield* Ref.get(calls), 1);

        yield* TestClock.adjust("1001 millis");
        const third = yield* cache.getModelList(
          { instanceId: codexInstanceId, driverKind: codexDriver },
          lookup,
        );

        assert.notEqual(third.checkedAt, first.checkedAt);
        assert.equal(yield* Ref.get(calls), 2);
      }),
    ),
  );

  it.effect("invalidates model and capabilities entries for one provider instance", () =>
    runWithCache(
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        const modelCalls = yield* Ref.make(0);
        const capabilityCalls = yield* Ref.make(0);
        const modelLookup = Ref.updateAndGet(modelCalls, (count) => count + 1).pipe(
          Effect.map((count) => makeProvider(`2026-01-01T00:00:0${count}.000Z`)),
        );
        const capabilityLookup = Ref.updateAndGet(capabilityCalls, (count) => count + 1).pipe(
          Effect.as({ sessionModelSwitch: "in-session" as const }),
        );

        yield* cache.getModelList(
          { instanceId: codexInstanceId, driverKind: codexDriver },
          modelLookup,
        );
        yield* cache.getCapabilities({ instanceId: codexInstanceId }, capabilityLookup);
        yield* cache.getModelList(
          { instanceId: codexInstanceId, driverKind: codexDriver },
          modelLookup,
        );
        yield* cache.getCapabilities({ instanceId: codexInstanceId }, capabilityLookup);

        assert.equal(yield* Ref.get(modelCalls), 1);
        assert.equal(yield* Ref.get(capabilityCalls), 1);

        yield* cache.invalidateProvider(codexInstanceId);
        yield* cache.getModelList(
          { instanceId: codexInstanceId, driverKind: codexDriver },
          modelLookup,
        );
        yield* cache.getCapabilities({ instanceId: codexInstanceId }, capabilityLookup);

        assert.equal(yield* Ref.get(modelCalls), 2);
        assert.equal(yield* Ref.get(capabilityCalls), 2);
      }),
    ),
  );

  it.effect("deduplicates concurrent model list misses through Effect.Cache", () =>
    runWithCache(
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        const calls = yield* Ref.make(0);
        const releaseLookup = yield* Deferred.make<void>();
        const lookup = Ref.update(calls, (count) => count + 1).pipe(
          Effect.andThen(Deferred.await(releaseLookup)),
          Effect.as(makeProvider("2026-01-01T00:00:01.000Z")),
        );

        const first = yield* cache
          .getModelList({ instanceId: codexInstanceId, driverKind: codexDriver }, lookup)
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        const second = yield* cache
          .getModelList({ instanceId: codexInstanceId, driverKind: codexDriver }, lookup)
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        assert.equal(yield* Ref.get(calls), 1);

        yield* Deferred.succeed(releaseLookup, undefined);
        const [firstProvider, secondProvider] = yield* Effect.all(
          [Fiber.join(first), Fiber.join(second)],
          { concurrency: "unbounded" },
        );

        assert.equal(firstProvider.checkedAt, secondProvider.checkedAt);
        assert.equal(yield* Ref.get(calls), 1);
      }),
    ),
  );

  it.effect("records cache hit and miss metrics", () =>
    runWithCache(
      Effect.gen(function* () {
        const cache = yield* ProviderCache;
        const lookup = Effect.succeed(makeProvider("2026-01-01T00:00:01.000Z"));

        yield* cache.getModelList({ instanceId: codexInstanceId, driverKind: codexDriver }, lookup);
        yield* cache.getModelList({ instanceId: codexInstanceId, driverKind: codexDriver }, lookup);

        const snapshots = yield* Metric.snapshot;
        assert.equal(
          hasMetricSnapshot(snapshots, {
            cache: "models",
            result: "miss",
            instanceId: String(codexInstanceId),
            provider: String(codexDriver),
          }),
          true,
        );
        assert.equal(
          hasMetricSnapshot(snapshots, {
            cache: "models",
            result: "hit",
            instanceId: String(codexInstanceId),
            provider: String(codexDriver),
          }),
          true,
        );
      }),
    ),
  );
});
