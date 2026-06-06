 ```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,256 @@
+import { Effect, Cache, Hub, Layer, pipe, Duration, Metric, MetricLabel, Ref, Option } from "effect"
+import * as Schema from "@effect/schema/Schema"
+
+// ============================================================================
+// Domain Types
+// ============================================================================
+
+export interface ProviderConfig {
+  readonly providerId: string
+  readonly apiKey: string
+  readonly baseUrl: string
+  readonly enabled: boolean
+}
+
+export interface Model {
+  readonly id: string
+  readonly name: string
+  readonly capabilities: ReadonlyArray<string>
+}
+
+export interface CapabilityQuery {
+  readonly modelId: string
+  readonly features: ReadonlyArray<string>
+}
+
+export interface ProviderCacheMetrics {
+  readonly modelListHits: number
+  readonly modelListMisses: number
+  readonly capabilityHits: number
+  readonly capabilityMisses: number
+  readonly invalidations: number
+}
+
+// ============================================================================
+// Cache Key Types
+// ============================================================================
+
+export interface ModelListKey {
+  readonly _tag: "ModelListKey"
+  readonly providerId: string
+}
+
+export interface CapabilityKey {
+  readonly _tag: "CapabilityKey"
+  readonly providerId: string
+  readonly modelId: string
+}
+
+export type CacheKey = ModelListKey | CapabilityKey
+
+// ============================================================================
+// Metrics
+// ============================================================================
+
+const modelListHitCounter = Metric.counter("provider_cache_model_list_hits", {
+  description: "Number of model list cache hits",
+})
+
+const modelListMissCounter = Metric.counter("provider_cache_model_list_misses", {
+  description: "Number of model list cache misses",
+})
+
+const capabilityHitCounter = Metric.counter("provider_cache_capability_hits", {
+  description: "Number of capability query cache hits",
+})
+
+const capabilityMissCounter = Metric.counter("provider_cache_capability_misses", {
+  description: "Number of capability query cache misses",
+})
+
+const invalidationCounter = Metric.counter("provider_cache_invalidations", {
+  description: "Number of cache invalidations triggered by provider config changes",
+})
+
+// ============================================================================
+// Provider API Service (interface for external calls)
+// ============================================================================
+
+export interface ProviderApiService {
+  readonly fetchModelList: (providerId: string) => Effect.Effect<ReadonlyArray<Model>, Error>
+  readonly fetchCapabilityQuery: (providerId: string, modelId: string) => Effect.Effect<CapabilityQuery, Error>
+}
+
+export const ProviderApiService = Effect.Tag<ProviderApiService>("ProviderApiService")
+
+// ============================================================================
+// Provider Cache Service
+// ============================================================================
+
+export interface ProviderCacheService {
+  readonly getModelList: (providerId: string) => Effect.Effect<ReadonlyArray<Model>, Error>
+  readonly getCapabilityQuery: (providerId: string, modelId: string) => Effect.Effect<CapabilityQuery, Error>
+  readonly invalidateProvider: (providerId: string) => Effect.Effect<void, never>
+  readonly getMetrics: Effect.Effect<ProviderCacheMetrics, never>
+}
+
+export const ProviderCacheService = Effect.Tag<ProviderCacheService>("ProviderCacheService")
+
+// ============================================================================
+// Configuration
+// ============================================================================
+
+export interface ProviderCacheConfig {
+  readonly modelListTtl: Duration.Duration
+  readonly capabilityTtl: Duration.Duration
+  readonly maxModelListEntries: number
+  readonly maxCapabilityEntries: number
+}
+
+export const defaultProviderCacheConfig: ProviderCacheConfig = {
+  modelListTtl: Duration.minutes(5),
+  capabilityTtl: Duration.minutes(15),
+  maxModelListEntries: 100,
+  maxCapabilityEntries: 500,
+}
+
+// ============================================================================
+// Implementation
+// ============================================================================
+
+export const makeProviderCacheService = Effect.gen(function* (_) {
+  const config = yield* _(Effect.succeed(defaultProviderCacheConfig))
+  const providerApi = yield* _(ProviderApiService)
+  
+  // Hub for provider configuration change events
+  const invalidationHub = yield* _(Hub.bounded<string>(100))
+  
+  // Model list cache with 5-minute TTL
+  const modelListCache = yield* _(
+    Cache.make({
+      capacity: config.maxModelListEntries,
+      timeToLive: config.modelListTtl,
+      lookup: (providerId: string) =>
+        pipe(
+          providerApi.fetchModelList(providerId),
+          Effect.tap(() => modelListMissCounter.pipe(Metric.increment)),
+          Effect.tapError(() => modelListMissCounter.pipe(Metric.increment))
+        ),
+    })
+  )
+  
+  // Capability query cache with 15-minute TTL
+  const capabilityCache = yield* _(
+    Cache.make({
+      capacity: config.maxCapabilityEntries,
+      timeToLive: config.capabilityTtl,
+      lookup: ([providerId, modelId]: [string, string]) =>
+        pipe(
+          providerApi.fetchCapabilityQuery(providerId, modelId),
+          Effect.tap(() => capabilityMissCounter.pipe(Metric.increment)),
+          Effect.tapError(() => capabilityMissCounter.pipe(Metric.increment))
+        ),
+    })
+  )
+  
+  // Subscribe to invalidation events
+  const invalidationSubscription = yield* _(Hub.subscribe(invalidationHub))
+  
+  // Process invalidation events
+  const invalidationFiber = yield* _(
+    pipe(
+      invalidationSubscription,
+      Effect.runFork
+    )
+  )
+  
+  const getModelList = (providerId: string): Effect.Effect<ReadonlyArray<Model>, Error> =>
+    pipe(
+      modelListCache.get(providerId),
+      Effect.tap(() => modelListHitCounter.pipe(Metric.increment)),
+      Effect.catchAll((error) =>
+        pipe(
+          providerApi.fetchModelList(providerId),
+          Effect.tap(() => modelListMissCounter.pipe(Metric.increment))
+        )
+      )
+    )
+  
+  const getCapabilityQuery = (providerId: string, modelId: string): Effect.Effect<CapabilityQuery, Error> =>
+    pipe(
+      capabilityCache.get([providerId, modelId]),
+      Effect.tap(() => capabilityHitCounter.pipe(Metric.increment)),
+      Effect.catchAll((error) =>
+        pipe(
+          providerApi.fetchCapabilityQuery(providerId, modelId),
+          Effect.tap(() => capabilityMissCounter.pipe(Metric.increment))
+        )
+      )
+    )
+  
+  const invalidateProvider = (providerId: string): Effect.Effect