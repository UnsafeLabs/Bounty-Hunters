```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,256 @@
+import { Effect, Cache, Hub, Duration, Metric, MetricState, Ref, Option } from "effect"
+import * as Schema from "@effect/schema/Schema"
+
+// ============================================================================
+// Configuration
+// ============================================================================
+
+export interface ProviderCacheConfig {
+  readonly modelListTtl: Duration.Duration
+  readonly capabilityQueryTtl: Duration.Duration
+  readonly maxModelListEntries: number
+  readonly maxCapabilityQueryEntries: number
+}
+
+export const defaultProviderCacheConfig: ProviderCacheConfig = {
+  modelListTtl: Duration.minutes(5),
+  capabilityQueryTtl: Duration.minutes(15),
+  maxModelListEntries: 1000,
+  maxCapabilityQueryEntries: 5000,
+}
+
+// ============================================================================
+// Domain Types
+// ============================================================================
+
+export interface ProviderId {
+  readonly _tag: "ProviderId"
+  readonly value: string
+}
+
+export const ProviderId = (value: string): ProviderId => ({
+  _tag: "ProviderId",
+  value,
+})
+
+export interface ModelListKey {
+  readonly _tag: "ModelListKey"
+  readonly providerId: ProviderId
+}
+
+export const ModelListKey = (providerId: ProviderId): ModelListKey => ({
+  _tag: "ModelListKey",
+  providerId,
+})
+
+export interface CapabilityQueryKey {
+  readonly _tag: "CapabilityQueryKey"
+  readonly providerId: ProviderId
+  readonly modelId: string
+}
+
+export const CapabilityQueryKey = (
+  providerId: ProviderId,
+  modelId: string
+): CapabilityQueryKey => ({
+  _tag: "CapabilityQueryKey",
+  providerId,
+  modelId,
+})
+
+export type CacheKey =
+  | { readonly _tag: "ModelListKey"; readonly providerId: ProviderId }
+  | { readonly _tag: "CapabilityQueryKey"; readonly providerId: ProviderId; readonly modelId: string }
+
+export const cacheKeyString = (key: CacheKey): string => {
+  switch (key._tag) {
+    case "ModelListKey":
+      return `model-list:${key.providerId.value}`
+    case "CapabilityQueryKey":
+      return `capability:${key.providerId.value}:${key.modelId}`
+  }
+}
+
+// ============================================================================
+// Metrics
+// ============================================================================
+
+export interface CacheMetrics {
+  readonly hits: Metric.Metric<number>
+  readonly misses: Metric.Metric<number>
+  readonly evictions: Metric.Metric<number>
+}
+
+export const makeCacheMetrics = (): CacheMetrics => ({
+  hits: Metric.counter("provider_cache_hits_total"),
+  misses: Metric.counter("provider_cache_misses_total"),
+  evictions: Metric.counter("provider_cache_evictions_total"),
+})
+
+// ============================================================================
+// Provider Change Events
+// ============================================================================
+
+export interface ProviderConfigChanged {
+  readonly _tag: "ProviderConfigChanged"
+  readonly providerId: ProviderId
+}
+
+export const ProviderConfigChanged = (
+  providerId: ProviderId
+): ProviderConfigChanged => ({
+  _tag: "ProviderConfigChanged",
+  providerId,
+})
+
+// ============================================================================
+// Provider Cache Service
+// ============================================================================
+
+export interface ProviderCache {
+  readonly _tag: "ProviderCache"
+  readonly modelListCache: Cache.Cache<CacheKey, ReadonlyArray<unknown>>
+  readonly capabilityCache: Cache.Cache<CacheKey, unknown>
+  readonly configHub: Hub.Hub<ProviderConfigChanged>
+  readonly metrics: CacheMetrics
+  readonly config: ProviderCacheConfig
+}
+
+export const ProviderCache = Effect.Tag<ProviderCache>("ProviderCache")
+
+// ============================================================================
+// Cache Creation
+// ============================================================================
+
+export const makeProviderCache = (
+  config: ProviderCacheConfig = defaultProviderCacheConfig
+): Effect.Effect<ProviderCache, never, never> =>
+  Effect.gen(function* (_) {
+    const modelListCache = yield* Cache.make({
+      capacity: config.maxModelListEntries,
+      timeToLive: config.modelListTtl,
+      lookup: (key: CacheKey) => Effect.succeed([] as ReadonlyArray<unknown>),
+    })
+
+    const capabilityCache = yield* Cache.make({
+      capacity: config.maxCapabilityQueryEntries,
+      timeToLive: config.capabilityQueryTtl,
+      lookup: (key: CacheKey) => Effect.succeed({} as unknown),
+    })
+
+    const configHub = yield* Hub.unbounded<ProviderConfigChanged>()
+
+    const metrics = makeCacheMetrics()
+
+    return {
+      _tag: "ProviderCache",
+      modelListCache,
+      capabilityCache,
+      configHub,
+      metrics,
+      config,
+    } as ProviderCache
+  })
+
+// ============================================================================
+// Cache Operations
+// ============================================================================
+
+export const getModelList = (
+  providerId: ProviderId,
+  fetchModels: (providerId: ProviderId) => Effect.Effect<ReadonlyArray<unknown>, never, never>
+): Effect.Effect<ReadonlyArray<unknown>, never, ProviderCache> =>
+  Effect.gen(function* (_) {
+    const cache = yield* ProviderCache
+    const key: CacheKey = { _tag: "ModelListKey", providerId }
+
+    const result = yield* Effect.orElse(
+      Effect.gen(function* () {
+        const cached = yield* cache.modelListCache.get(key)
+        yield* cache.metrics.hits.pipe(Effect.tap(() => Effect.unit))
+        return cached
+      }),
+      () =>
+        Effect.gen(function* () {
+          yield* cache.metrics.misses.pipe(Effect.tap(() => Effect.unit))
+          const fresh = yield* fetchModels(providerId)
+          yield* cache.modelListCache.set(key, fresh)
+          return fresh
+        })
+    )
+
+    return result
+  })
+
+export const getCapability = (
+  providerId: ProviderId,
+  modelId: string,
+  fetchCapability: (
+    providerId: ProviderId,
+    modelId: string
+  ) => Effect.Effect<unknown, never, never>
+): Effect.Effect<unknown, never, ProviderCache> =>
+  Effect.gen(function* (_) {
+    const cache = yield* ProviderCache
+    const key: CacheKey = { _tag: "CapabilityQueryKey", providerId, modelId }
+
+    const result = yield* Effect.orElse(
+      Effect.gen(function* () {
+        const cached = yield* cache