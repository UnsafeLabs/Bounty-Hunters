 ```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,268 @@
+import { Effect, Cache, Hub, Duration, Metric, MetricLabel, Ref, Option } from "effect"
+import * as Schema from "@effect/schema/Schema"
+
+// ============================================================================
+// Types
+// ============================================================================
+
+export interface ProviderConfig {
+  readonly id: string
+  readonly baseUrl: string
+  readonly apiKey: string
+}
+
+export interface ModelInfo {
+  readonly id: string
+  readonly name: string
+  readonly capabilities: ReadonlyArray<string>
+}
+
+export interface CapabilityQuery {
+  readonly modelId: string
+  readonly feature: string
+}
+
+export interface CapabilityResult {
+  readonly supported: boolean
+  readonly details: Record<string, unknown>
+}
+
+export interface CacheMetrics {
+  readonly hits: number
+  readonly misses: number
+  readonly evictions: number
+  readonly size: number
+}
+
+export interface ProviderCacheConfig {
+  readonly modelListTtl: Duration.Duration
+  readonly capabilityQueryTtl: Duration.Duration
+  readonly maxModelListEntries: number
+  readonly maxCapabilityEntries: number
+}
+
+// ============================================================================
+// Default Config
+// ============================================================================
+
+export const defaultConfig: ProviderCacheConfig = {
+  modelListTtl: Duration.minutes(5),
+  capabilityQueryTtl: Duration.minutes(15),
+  maxModelListEntries: 1000,
+  maxCapabilityEntries: 5000,
+}
+
+// ============================================================================
+// Metrics
+// ============================================================================
+
+const cacheHits = Metric.counter("provider_cache_hits_total", "Number of cache hits")
+const cacheMisses = Metric.counter("provider_cache_misses_total", "Number of cache misses")
+const cacheSize = Metric.gauge("provider_cache_size", "Current number of entries in cache")
+
+const trackHit = Effect.gen(function* () {
+  yield* cacheHits.pipe(Metric.increment)
+})
+
+const trackMiss = Effect.gen(function* () {
+  yield* cacheMisses.pipe(Metric.increment)
+})
+
+// ============================================================================
+// Cache Key Types
+// ============================================================================
+
+interface ModelListKey {
+  readonly _tag: "ModelListKey"
+  readonly providerId: string
+}
+
+interface CapabilityKey {
+  readonly _tag: "CapabilityKey"
+  readonly providerId: string
+  readonly modelId: string
+  readonly feature: string
+}
+
+type CacheKey = ModelListKey | CapabilityKey
+
+const makeModelListKey = (providerId: string): ModelListKey => ({
+  _tag: "ModelListKey",
+  providerId,
+})
+
+const makeCapabilityKey = (providerId: string, modelId: string, feature: string): CapabilityKey => ({
+  _tag: "CapabilityKey",
+  providerId,
+  modelId,
+  feature,
+})
+
+// ============================================================================
+// ProviderCache Service
+// ============================================================================
+
+export interface ProviderCache {
+  readonly getModelList: (providerId: string) => Effect.Effect<ReadonlyArray<ModelInfo>, never, never>
+  readonly getCapability: (providerId: string, modelId: string, feature: string) => Effect.Effect<CapabilityResult, never, never>
+  readonly invalidateProvider: (providerId: string) => Effect.Effect<void, never, never>
+  readonly getMetrics: Effect.Effect<CacheMetrics, never, never>
+}
+
+// ============================================================================
+// Provider API Interface (to be provided by consumer)
+// ============================================================================
+
+export interface ProviderApi {
+  readonly fetchModelList: (providerId: string) => Effect.Effect<ReadonlyArray<ModelInfo>, Error, never>
+  readonly fetchCapability: (query: CapabilityQuery) => Effect.Effect<CapabilityResult, Error, never>
+}
+
+// ============================================================================
+// Implementation
+// ============================================================================
+
+export const makeProviderCache = (
+  providerApi: ProviderApi,
+  config: Partial<ProviderCacheConfig> = {}
+): Effect.Effect<ProviderCache, never, never> =>
+  Effect.gen(function* () {
+    const fullConfig = { ...defaultConfig, ...config }
+    
+    // Create a Hub for cache invalidation events
+    const invalidationHub = yield* Hub.unbounded<string>()
+    
+    // Model list cache with 5-minute TTL
+    const modelListCache = yield* Cache.make({
+      capacity: fullConfig.maxModelListEntries cached,
+      timeToLive: fullConfig.modelListTtl,
+      lookup: (key: ModelListKey) =>
+        Effect.gen(function* () {
+          yield* trackMiss
+          return yield* providerApi.fetchModelList(key.providerId)
+        }),
+    })
+    
+    // Capability query cache with 15-minute TTL
+    const capabilityCache = yield* Cache.make({
+      capacity: fullConfig.maxCapabilityEntries,
+      timeToLive: fullConfig.capabilityQueryTtl,
+      lookup: (key: CapabilityKey) =>
+        Effect.gen(function* () {
+          yield* trackMiss
+          return yield* providerApi.fetchCapability({
+            modelId: key.modelId,
+            feature: key.feature,
+          })
+        }),
+    })
+    
+    // Metrics tracking
+    const metricsRef = yield* Ref.make<CacheMetrics>({
+      hits: 0,
+      misses: 0,
+      evictions: 0,
+      size: 0,
+    })
+    
+    const updateMetrics = (update: Partial<CacheMetrics>) =>
+      Ref.update(metricsRef, (current) => ({
+        ...current,
+        ...update,
+      }))
+    
+    const getMetrics = Ref.get(metricsRef)
+    
+    // Subscribe to invalidation events
+    yield* Hub.subscribe(invalidationHub).pipe(
+      Effect.flatMap((subscription) =>
+        Effect.forkDaemon(
+          Effect.forever(
+            Effect.gen(function* () {
+              const providerId = yield* subscription
+              // Invalidate all entries for this provider
+              // Note: Effect.Cache doesn't expose direct invalidation by key pattern,
+              // so we track invalidations via the Hub and handle at lookup time
+              yield* updateMetrics({ evictions: (yield* getMetrics).evictions + 1 })
+            })
+          )
+        )
+      )
+    )
+    
+    const getModelList = (providerId: string): Effect.Effect<ReadonlyArray<ModelInfo>, never, never> =>
+      Effect.gen(function* () {
+        const key = makeModelListKey(providerId)
+       