import { describe, it, assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import {
  ProviderCache,
  ProviderId,
  type ModelListResponse,
  type CapabilityQueryResponse,
  DEFAULT_PROVIDER_CACHE_CONFIG,
} from "./ProviderCache.ts";

describe("ProviderCache", () => {
  const testProviderId = new ProviderId({ value: "test-provider" });

  const mockModelList: ModelListResponse = {
    models: [
      { id: "model-1", name: "Test Model 1", capabilities: ["chat", "completion"] },
      { id: "model-2", name: "Test Model 2", capabilities: ["chat"] },
    ],
    fetchedAt: Date.now(),
  };

  const mockCapability: CapabilityQueryResponse = {
    capability: "chat",
    supported: true,
    details: Option.some({ maxTokens: 4096 }),
    fetchedAt: Date.now(),
  };

  describe("getModelList", () => {
    it("should fetch and cache model list on first call", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        const result1 = yield* cacheInstance.getModelList(testProviderId);
        const result2 = yield* cacheInstance.getModelList(testProviderId);

        assert.deepEqual(result1, mockModelList);
        assert.deepEqual(result2, mockModelList);
        assert.strictEqual(fetchCount, 1, "Should only fetch once due to caching");
      }).pipe(Effect.runPromise));

    it("should return cached result within TTL", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          { ...DEFAULT_PROVIDER_CACHE_CONFIG, modelListTtlMs: 5000 },
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(testProviderId);
        yield* cacheInstance.getModelList(testProviderId);
        yield* cacheInstance.getModelList(testProviderId);

        assert.strictEqual(fetchCount, 1, "Should use cache for subsequent calls");
      }).pipe(Effect.runPromise));

    it("should fetch again after TTL expires", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          { ...DEFAULT_PROVIDER_CACHE_CONFIG, modelListTtlMs: 100 },
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(testProviderId);
        yield* TestClock.adjust(150); // Wait for TTL to expire
        yield* cacheInstance.getModelList(testProviderId);

        assert.strictEqual(fetchCount, 2, "Should fetch again after TTL expires");
      }).pipe(Effect.runPromise));

    it("should cache different providers separately", () =>
      Effect.gen(function* () {
        const provider1 = new ProviderId({ value: "provider-1" });
        const provider2 = new ProviderId({ value: "provider-2" });
        let fetchCount = 0;

        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(provider1);
        yield* cacheInstance.getModelList(provider2);
        yield* cacheInstance.getModelList(provider1);

        assert.strictEqual(fetchCount, 2, "Should fetch once per provider");
      }).pipe(Effect.runPromise));
  });

  describe("getCapability", () => {
    it("should fetch and cache capability query", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchCapability = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockCapability;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          () => Effect.succeed(mockModelList),
          fetchCapability,
        );

        const cacheInstance = yield* cache;
        const result1 = yield* cacheInstance.getCapability(testProviderId, "chat");
        const result2 = yield* cacheInstance.getCapability(testProviderId, "chat");

        assert.deepEqual(result1, mockCapability);
        assert.deepEqual(result2, mockCapability);
        assert.strictEqual(fetchCount, 1, "Should only fetch once due to caching");
      }).pipe(Effect.runPromise));

    it("should cache different capabilities separately", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchCapability = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockCapability;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          () => Effect.succeed(mockModelList),
          fetchCapability,
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getCapability(testProviderId, "chat");
        yield* cacheInstance.getCapability(testProviderId, "completion");
        yield* cacheInstance.getCapability(testProviderId, "chat");

        assert.strictEqual(fetchCount, 2, "Should fetch once per capability");
      }).pipe(Effect.runPromise));
  });

  describe("invalidateProvider", () => {
    it("should invalidate all cache entries for a provider", () =>
      Effect.gen(function* () {
        let modelListFetchCount = 0;
        let capabilityFetchCount = 0;

        const fetchModelList = () =>
          Effect.sync(() => {
            modelListFetchCount++;
            return mockModelList;
          });

        const fetchCapability = () =>
          Effect.sync(() => {
            capabilityFetchCount++;
            return mockCapability;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          fetchCapability,
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(testProviderId);
        yield* cacheInstance.getCapability(testProviderId, "chat");
        yield* cacheInstance.invalidateProvider(testProviderId);
        yield* cacheInstance.getModelList(testProviderId);
        yield* cacheInstance.getCapability(testProviderId, "chat");

        assert.strictEqual(modelListFetchCount, 2, "Should fetch model list again after invalidation");
        assert.strictEqual(capabilityFetchCount, 2, "Should fetch capability again after invalidation");
      }).pipe(Effect.runPromise));

    it("should not affect other providers", () =>
      Effect.gen(function* () {
        const provider1 = new ProviderId({ value: "provider-1" });
        const provider2 = new ProviderId({ value: "provider-2" });
        let fetchCount = 0;

        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(provider1);
        yield* cacheInstance.getModelList(provider2);
        yield* cacheInstance.invalidateProvider(provider1);
        yield* cacheInstance.getModelList(provider1);
        yield* cacheInstance.getModelList(provider2);

        assert.strictEqual(fetchCount, 3, "Should only refetch invalidated provider");
      }).pipe(Effect.runPromise));
  });

  describe("invalidateAll", () => {
    it("should invalidate all cache entries", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(testProviderId);
        yield* cacheInstance.invalidateAll();
        yield* cacheInstance.getModelList(testProviderId);

        assert.strictEqual(fetchCount, 2, "Should fetch again after invalidateAll");
      }).pipe(Effect.runPromise));
  });

  describe("onProviderConfigChange", () => {
    it("should invalidate cache when provider config changes", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchModelList = () =>
          Effect.sync(() => {
            fetchCount++;
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(testProviderId);
        yield* cacheInstance.onProviderConfigChange(testProviderId);
        yield* cacheInstance.getModelList(testProviderId);

        assert.strictEqual(fetchCount, 2, "Should fetch again after config change");
      }).pipe(Effect.runPromise));
  });

  describe("getMetrics", () => {
    it("should track cache hits and misses", () =>
      Effect.gen(function* () {
        const fetchModelList = () => Effect.succeed(mockModelList);
        const fetchCapability = () => Effect.succeed(mockCapability);

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          fetchCapability,
        );

        const cacheInstance = yield* cache;
        yield* cacheInstance.getModelList(testProviderId); // miss
        yield* cacheInstance.getModelList(testProviderId); // hit
        yield* cacheInstance.getCapability(testProviderId, "chat"); // miss
        yield* cacheInstance.getCapability(testProviderId, "chat"); // hit

        const metrics = yield* cacheInstance.getMetrics();
        assert.strictEqual(metrics.modelListHits, 1);
        assert.strictEqual(metrics.modelListMisses, 1);
        assert.strictEqual(metrics.capabilityQueryHits, 1);
        assert.strictEqual(metrics.capabilityQueryMisses, 1);
      }).pipe(Effect.runPromise));
  });

  describe("concurrent requests", () => {
    it("should deduplicate concurrent requests for same key", () =>
      Effect.gen(function* () {
        let fetchCount = 0;
        const fetchModelList = () =>
          Effect.gen(function* () {
            fetchCount++;
            yield* Effect.sleep(100); // Simulate slow API call
            return mockModelList;
          });

        const cache = yield* ProviderCache.layer(
          DEFAULT_PROVIDER_CACHE_CONFIG,
          fetchModelList,
          () => Effect.succeed(mockCapability),
        );

        const cacheInstance = yield* cache;

        // Make concurrent requests
        const [result1, result2, result3] = yield* Effect.all([
          cacheInstance.getModelList(testProviderId),
          cacheInstance.getModelList(testProviderId),
          cacheInstance.getModelList(testProviderId),
        ]);

        assert.deepEqual(result1, mockModelList);
        assert.deepEqual(result2, mockModelList);
        assert.deepEqual(result3, mockModelList);
        assert.strictEqual(fetchCount, 1, "Should only fetch once for concurrent requests");
      }).pipe(Effect.runPromise));
  });
});
