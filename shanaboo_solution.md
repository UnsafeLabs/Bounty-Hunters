Looking at the issue, I need to create a ProviderCache.ts file that implements Effect.Cache-based caching for provider API responses with TTL functionality. Let me analyze the requirements:

1. Create `t3code/apps/server/src/services/ProviderCache.ts`
2. Use Effect.Cache with configurable TTL (5min for models, 15min for capabilities)
3. Cache invalidation on provider config changes via Effect.Hub
4. Cache hit/miss metrics
5. Deduplication of concurrent lookups

Let me create the implementation:

```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,184 @@
+import { Cache, Effect, Duration, Layer, Context, Ref, Hub, Queue, Metric, pipe } from "effect"
+import type { ProviderId } from "../types/provider"
+
+// Service interface
+export interface ProviderCacheService {
+  readonly getModelList: (providerId: ProviderId) => Effect.Effect<unknown, unknown, unknown>
+  readonly getCapabilities: (providerId: ProviderId, modelId: string) => Effect.Effect<unknown, unknown, unknown>
+  readonly invalidateProvider: (providerId: ProviderId) => Effect.Effect<void, never, never>
+  readonly getStats: () => Effect.Effect<{
+    modelListHits: number
+    modelListMisses: number
+    capabilityHits: number
+    capabilityMisses: number
+  }, never, never>
+}
+
+// Configuration
+interface ProviderCacheConfig {
+  modelListTTL: Duration.Duration
+  capabilitiesTTL: Duration.Duration
+  maxEntries: number
+}
+
+const defaultConfig: ProviderCacheConfig = {
+  modelListTTL: Duration.minutes(5),
+  capabilitiesTTL: Duration.minutes(15),
+  maxEntries: 1000
+}
+
+// Metrics
+const modelListHits = Metric.counter("provider_cache_model_list_hits")
+const modelListMisses = Metric.counter("provider_cache_model_list_misses")
+const capabilityHits = Metric.counter("provider_cache_capability_hits")
+const capabilityMisses = Metric.counter("provider_cache_capability_misses")
+
+// Context tag for the service
+export class ProviderCache extends Context.Tag("ProviderCache")<
+  ProviderCache,
+  ProviderCacheService
+>() {}
+
+// Internal cache keys
+type ModelListKey = `model-list:${ProviderId}`
+type CapabilityKey = `capability:${ProviderId}:${string}`
+type CacheKey = ModelListKey | CapabilityKey
+
+// Create the cache layer
+export const makeLayer = (config?: Partial<ProviderCacheConfig>) => 
+  Layer.effect(
+    ProviderCache,
+    Effect.gen(function* (_) {
+      const fullConfig = { ...defaultConfig, ...config }
+      
+      // Stats tracking
+      const stats = yield* _(Ref.make({
+        modelListHits: 0,
+        modelListMisses: 0,
+        capabilityHits: 0,
+        capabilityMisses: 0
+      }))
+      
+      // Create caches with TTL
+      const modelListCache = yield* _(Cache.make({
+        capacity: fullConfig.maxEntries,
+        timeToLive: fullConfig.modelListTTL,
+        lookup: (key: ModelListKey) => 
+          pipe(
+            Effect.sync(() => {
+              const providerId = key.split(":")[1] as ProviderId
+              return providerId
+            }),
+            Effect.flatMap(fetchModelListFromProvider),
+            Effect.tap(() => 
+              Ref.update(stats, s => ({ ...s, modelListMisses: s.modelListMisses + 1 }))
+            ),
+            Effect.tapError(() => 
+              Ref.update(stats, s => ({ ...s, modelListMisses: s.modelListMisses + 1 }))
+            )
+          )
+      }))
+      
+      const capabilitiesCache = yield* _(Cache.make({
+        capacity: fullConfig.maxEntries,
+        timeToLive: fullConfig.capabilitiesTTL,
+        lookup: (key: CapabilityKey) => 
+          pipe(
+            Effect.sync(() => {
+              const parts = key.split(":")
+              const providerId = parts[1] as ProviderId
+              const modelId = parts[2]
+              return { providerId, modelId }
+            }),
+            Effect.flatMap(({ providerId, modelId }) => 
+              fetchCapabilitiesFromProvider(providerId, modelId)
+            ),
+            Effect.tap(() => 
+              Ref.update(stats, s => ({ ...s, capabilityMisses: s.capabilityMisses + 1 }))
+            ),
+            Effect.tapError(() => 
+              Ref.update(stats, s => ({ ...s, capabilityMisses: s.capabilityMisses + 1 }))
+            )
+          )
+      }))
+      
+      // Subscribe to config changes for invalidation
+      const hub = yield* _(Hub.make<void>())
+      const queue = yield* _(Queue.unbounded<ProviderId>())
+      yield* _(Hub.subscribe(hub, queue))
+      
+      // Process invalidation events
+      yield* _(
+        Queue.take(queue),
+        Effect.flatMap((providerId) => 
+          Effect.all([
+            Cache.invalidateWhen(modelListCache, (key: CacheKey) => 
+              key.startsWith(`model-list:${providerId}`)
+            ),
+            Cache.invalidateWhen(capabilitiesCache, (key: CacheKey) => 
+              key.startsWith(`capability:${providerId}`)
+            )
+          ])
+        ),
+        Effect.forever,
+        Effect.fork
+      )
+      
+      // Service implementation
+      const service: ProviderCacheService = {
+        getModelList: (providerId) => 
+          pipe(
+            Cache.get(modelListCache, `model-list:${providerId}` as ModelListKey),
+            Effect.tap(() => 
+              Ref.update(stats, s => ({ ...s, modelListHits: s.modelListHits + 1 }))
+            ),
+            Effect.orElse(() => 
+              pipe(
+                Ref.update(stats, s => ({ ...s, modelListMisses: s.modelListMisses + 1 })),
+                Effect.zipRight(Effect.fail("Cache miss"))
+              )
+            )
+          ),
+          
+        getCapabilities: (providerId, modelId) => 
+          pipe(
+            Cache.get(capabilitiesCache, `capability:${providerId}:${modelId}` as CapabilityKey),
+            Effect.tap(() => 
+              Ref.update(stats, s => ({ ...s, capabilityHits: s.capabilityHits + 1 }))
+            ),
+            Effect.orElse(() => 
+              pipe(
+                Ref.update(stats, s => ({ ...s, capabilityMisses: s.capabilityMisses + 1 })),
+                Effect.zipRight(Effect