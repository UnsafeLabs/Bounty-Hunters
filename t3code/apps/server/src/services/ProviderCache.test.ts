import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { makeProviderCache, type CacheMetrics } from "./ProviderCache.ts";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import type { ServerProviderModel } from "@t3tools/contracts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const makeId = (n: number): ProviderInstanceId =>
  `provider-${n}` as ProviderInstanceId;

const sampleModels: ReadonlyArray<ServerProviderModel> = [
  { id: "gpt-4o" } as ServerProviderModel,
];

const sampleCapabilities: ProviderAdapterCapabilities = {
  streaming: true,
  functionCalling: true,
} as unknown as ProviderAdapterCapabilities;

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("ProviderCache", () => {
  describe("getModels", () => {
    it.effect("should return cached models on repeated calls", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const cache = yield* makeProviderCache({
          fetchModels: () =>
            Effect.sync(() => {
              callCount++;
              return sampleModels;
            }),
          fetchCapabilities: () => Effect.succeed(sampleCapabilities),
          modelListTTL: Duration.minutes(5),
        });

        const r1 = yield* cache.getModels(makeId(1));
        assert.deepStrictEqual(r1, sampleModels);
        assert.strictEqual(callCount, 1);

        const r2 = yield* cache.getModels(makeId(1));
        assert.deepStrictEqual(r2, sampleModels);
        assert.strictEqual(callCount, 1);
      }),
    );

    it.effect("should call fetch again after TTL expiry", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const cache = yield* makeProviderCache({
          fetchModels: () =>
            Effect.sync(() => {
              callCount++;
              return sampleModels;
            }),
          fetchCapabilities: () => Effect.succeed(sampleCapabilities),
          modelListTTL: Duration.minutes(5),
        });

        yield* cache.getModels(makeId(1));
        assert.strictEqual(callCount, 1);

        yield* TestClock.adjust(Duration.minutes(6));
        yield* cache.getModels(makeId(1));
        assert.strictEqual(callCount, 2);
      }),
    );

    it.effect("should cache different provider IDs separately", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const cache = yield* makeProviderCache({
          fetchModels: (id) =>
            Effect.sync(() => {
              callCount++;
              return [{ id: `model-${id}` }] as unknown as ServerProviderModel[];
            }),
          fetchCapabilities: () => Effect.succeed(sampleCapabilities),
        });

        yield* cache.getModels(makeId(1));
        yield* cache.getModels(makeId(2));
        assert.strictEqual(callCount, 2);

        yield* cache.getModels(makeId(1));
        yield* cache.getModels(makeId(2));
        assert.strictEqual(callCount, 2);
      }),
    );
  });

  describe("getCapabilities", () => {
    it.effect("should cache capabilities and respect TTL", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const cache = yield* makeProviderCache({
          fetchModels: () => Effect.succeed(sampleModels),
          fetchCapabilities: () =>
            Effect.sync(() => {
              callCount++;
              return sampleCapabilities;
            }),
          capabilityTTL: Duration.minutes(10),
        });

        yield* cache.getCapabilities(makeId(1));
        assert.strictEqual(callCount, 1);

        yield* cache.getCapabilities(makeId(1));
        assert.strictEqual(callCount, 1);

        yield* TestClock.adjust(Duration.minutes(11));
        yield* cache.getCapabilities(makeId(1));
        assert.strictEqual(callCount, 2);
      }),
    );
  });

  describe("invalidateProvider", () => {
    it.effect("should clear both caches for a given provider", () =>
      Effect.gen(function* () {
        let modelCalls = 0;
        let capCalls = 0;
        const cache = yield* makeProviderCache({
          fetchModels: () =>
            Effect.sync(() => {
              modelCalls++;
              return sampleModels;
            }),
          fetchCapabilities: () =>
            Effect.sync(() => {
              capCalls++;
              return sampleCapabilities;
            }),
        });

        yield* cache.getModels(makeId(1));
        yield* cache.getCapabilities(makeId(1));
        assert.strictEqual(modelCalls, 1);
        assert.strictEqual(capCalls, 1);

        yield* cache.invalidateProvider(makeId(1));

        yield* cache.getModels(makeId(1));
        yield* cache.getCapabilities(makeId(1));
        assert.strictEqual(modelCalls, 2);
        assert.strictEqual(capCalls, 2);
      }),
    );

    it.effect("should not invalidate other providers", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const cache = yield* makeProviderCache({
          fetchModels: () =>
            Effect.sync(() => {
              callCount++;
              return sampleModels;
            }),
          fetchCapabilities: () => Effect.succeed(sampleCapabilities),
        });

        yield* cache.getModels(makeId(1));
        yield* cache.getModels(makeId(2));
        assert.strictEqual(callCount, 2);

        yield* cache.invalidateProvider(makeId(1));

        yield* cache.getModels(makeId(2));
        assert.strictEqual(callCount, 2);

        yield* cache.getModels(makeId(1));
        assert.strictEqual(callCount, 3);
      }),
    );
  });

  describe("invalidateAll", () => {
    it.effect("should clear all cached entries", () =>
      Effect.gen(function* () {
        let callCount = 0;
        const cache = yield* makeProviderCache({
          fetchModels: () =>
            Effect.sync(() => {
              callCount++;
              return sampleModels;
            }),
          fetchCapabilities: () => Effect.succeed(sampleCapabilities),
        });

        yield* cache.getModels(makeId(1));
        yield* cache.getModels(makeId(2));
        assert.strictEqual(callCount, 2);

        yield* cache.invalidateAll;

        yield* cache.getModels(makeId(1));
        yield* cache.getModels(makeId(2));
        assert.strictEqual(callCount, 4);
      }),
    );
  });

  describe("getMetrics", () => {
    it.effect("should report cache hits and misses", () =>
      Effect.gen(function* () {
        const cache = yield* makeProviderCache({
          fetchModels: () => Effect.succeed(sampleModels),
          fetchCapabilities: () => Effect.succeed(sampleCapabilities),
        });

        // miss + set
        yield* cache.getModels(makeId(1));
        let m = yield* cache.getMetrics;
        assert.deepStrictEqual(m, { hits: 0, misses: 1 } satisfies CacheMetrics);

        // hit
        yield* cache.getModels(makeId(1));
        m = yield* cache.getMetrics;
        assert.deepStrictEqual(m, { hits: 1, misses: 1 } satisfies CacheMetrics);

        // miss for a new provider
        yield* cache.getModels(makeId(2));
        m = yield* cache.getMetrics;
        assert.deepStrictEqual(m, { hits: 1, misses: 2 } satisfies CacheMetrics);
      }),
    );
  });
});
