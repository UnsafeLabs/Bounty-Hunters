```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,204 @@
+import { Effect, Layer, Cache, Hub, Duration, Ref, Metric, pipe } from "@effect/io"
+import { pipe as fpPipe } from "fp-ts/function"
+
+// Define types for our cache keys and values
+interface ProviderModelListKey {
+  readonly _tag: "ModelList"
+  readonly providerId: string
+}
+
+interface ProviderCapabilitiesKey {
+  readonly _tag: "Capabilities"
+  readonly providerId: string
+  readonly modelId: string
+}
+
+type CacheKey = ProviderModelListKey | ProviderCapabilitiesKey
+type CacheValue = unknown
+
+// Configuration interface
+interface ProviderCacheConfig {
+  readonly modelListTTL: Duration.Duration
+  readonly capabilitiesTTL: Duration.Duration
+  readonly maxEntries: number
+}
+
+// Default configuration
+const defaultConfig: ProviderCacheConfig = {
+  modelListTTL: Duration.minutes(5),
+  capabilitiesTTL: Duration.minutes(15),
+  maxEntries: 1000
+}
+
+// Metrics
+const cacheHitMetric = Metric.counter("provider_cache_hit")
+const cacheMissMetric = Metric.counter("provider_cache_miss")
+
+// Create our cache service
+class ProviderCacheService extends Effect.Tag("@services/ProviderCacheService")<
+  ProviderCacheService,
+  {
+    readonly getModelList: (providerId: string) => Effect.Effect<never, unknown, unknown[]>
+    readonly getCapabilities: (providerId: string, modelId: string) => Effect.Effect<never, unknown, unknown>
+    readonly invalidateProvider: (providerId: string) => Effect.Effect<never, never, void>
+    readonly invalidateAll: () => Effect.Effect<never, never, void>
+  }
+>() {}
+
+// Create the cache layer
+const makeLayer = (config: Partial<ProviderCacheConfig> = {}) => {
+  const fullConfig: ProviderCacheConfig = { ...defaultConfig, ...config }
+  
+  return Layer.effect(
+    ProviderCacheService,
+    Effect.gen(function* ($) {
+      // Create a hub for provider config changes
+      const providerConfigHub = yield* $(Hub.unbounded<string>())
+      
+      // Ref to track invalidated providers
+      const invalidatedProviders = yield* $(Ref.make<ReadonlySet<string>>(new Set()))
+      
+      // Create the cache
+      const cache = yield* $(
+        Cache.make({
+          capacity: fullConfig.maxEntries,
+          timeToLive: (key: CacheKey) => {
+            switch (key._tag) {
+              case "ModelList":
+                return fullConfig.modelListTTL
+              case "Capabilities":
+                return fullConfig.capabilitiesTTL
+            }
+          },
+          lookup: (key: CacheKey) => {
+            return pipe(
+              Effect.gen(function* ($) {
+                // Check if provider was invalidated
+                const isInvalidated = yield* $(Ref.get(invalidatedProviders))
+                const shouldInvalidate = 
+                  (key._tag === "ModelList" && isInvalidated.has(key.providerId)) ||
+                  (key._tag === "Capabilities" && isInvalidated.has(key.providerId))
+                
+                if (shouldInvalidate) {
+                  // Clear the invalidation flag for this provider
+                  yield* $(Ref.update(invalidatedProviders, set => {
+                    const newSet = new Set(set)
+                    newSet.delete(key.providerId)
+                  }))
+                  
+                  // Return a failure to force cache miss
+                  return yield* $(Effect.fail(new Error("Provider invalidated")))
+                }
+                
+                // Record cache miss
+                yield* $(Metric.increment(cacheMissMetric))
+                
+                // Call the actual provider API based on key type
+                switch (key._tag) {
+                  case "ModelList":
+                    // TODO: Replace with actual API call to fetch model list
+                    return yield* $(Effect.succeed([]))
+                  case "Capabilities":
+                    // TODO: Replace with actual API call to fetch capabilities
+                    return yield* $(Effect.succeed({}))
+                }
+              }),
+              Effect.catchAll(() => Effect.never) // This will force a cache miss
+            )
+          }
+        })
+      )
+      
+      // Subscribe to provider config changes
+      yield* $(
+        Hub.subscribe(providerConfigHub),
+        Effect.flatMap(subscription => 
+          pipe(
+            subscription,
+            Effect.tap(providerId => 
+              pipe(
+                Ref.update(invalidatedProviders, set => {
+                  const newSet = new Set(set)
+                  newSet.add(providerId)
+                  return newSet
+                }),
+                Effect.zipRight(Cache.invalidateWhen(cache, (key: CacheKey) => key.providerId === providerId))
+              )
+            ),
+            Effect.forever
+          )
+        ),
+        Effect.fork
+      )
+      
+      // Return the service implementation
+      return ProviderCacheService.of({
+        getModelList: (providerId: string) => 
+          pipe(
+            Cache.get(cache, { _tag: "ModelList", providerId }),
+            Effect.tapBoth(
+              () => Metric.increment(cacheHitMetric),
+              () => Metric.increment(cacheMissMetric)
+            ),
+            Effect.orElse(() => 
+              Cache.get(cache, { _tag: "ModelList", providerId })
+            )
+          ),
+          
+        getCapabilities: (providerId: string, modelId: string) => 
+          pipe(
+            Cache.get(cache, { _tag: "Capabilities", providerId, modelId }),
+            Effect.tapBoth(
+              () => Metric.increment(cacheHitMetric),
+              () => Metric.increment(cacheMissMetric)
+            ),
+            Effect.orElse(() => 
+              Cache.get(cache, { _tag: "Capabilities", providerId, modelId })
+            )
+          ),
+          
+        invalidateProvider: (providerId: string) => 
+          pipe(
+            Ref.update(invalidatedProviders, set => {
+              const newSet = new Set(set)
+              newSet.add(providerId)
+              return newSet
+            }),
+            Effect.zipRight(Cache.invalidateWhen(cache, (key: CacheKey) => key.providerId === providerId))
+          ),
+          
+        invalidateAll: () => 
+          pipe(
+            Ref.set(invalidatedProviders, new Set()),
+            Effect.zipRight(Cache.invalidateAll(cache))
+          )
+      })
+    })
+  )
+}
+
+// Export the layer with default config
+export const ProviderCacheLive = makeLayer()
+
+// Export a function to create a layer with