Looking at the issue, I need to create a ProviderCache.ts file that implements Effect.Cache-based caching for provider API responses with TTL and cache invalidation. Let me analyze the requirements:

1. Create `t3code/apps/server/src/services/ProviderCache.ts`
2. Use Effect.Cache with 5-minute TTL for model lists, 15-minute TTL for capability queries
3. Implement cache invalidation on provider configuration changes via Effect.Hub
4. Add cache hit/miss metrics
5. Handle concurrent request deduplication
6. Bounded memory usage

```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,184 @@
+import { Cache, Effect, Duration, Layer, Metric, Hub, Queue, Context, pipe } from "effect";
+import type { ProviderId } from "../types/provider";
+
+// Define cache configuration
+interface CacheConfig {
+  modelListTTL: Duration.Duration;
+  capabilityTTL: Duration.Duration;
+  maxEntries: number;
+}
+
+// Default configuration
+const defaultConfig: CacheConfig = {
+  modelListTTL: Duration.minutes(5),
+  capabilityTTL: Duration.minutes(15),
+  maxEntries: 1000
+};
+
+// Cache keys
+type CacheKey = 
+  | { _tag: "modelList"; providerId: ProviderId }
+  | { _tag: "capability"; providerId: ProviderId; modelId: string };
+
+// Provider cache service
+interface ProviderCacheService {
+  readonly getModelList: (providerId: ProviderId) => Effect.Effect<unknown, unknown, never>;
+  readonly getCapability: (providerId: ProviderId, modelId: string) => Effect.Effect<unknown, unknown, never>;
+  readonly invalidateProvider: (providerId: ProviderId) => Effect.Effect<void, never, never>;
+  readonly invalidateAll: () => Effect.Effect<void, never, never>;
+}
+
+// Metrics
+const cacheHitMetric = Metric.counter("provider_cache_hits");
+const cacheMissMetric = Metric.counter("provider_cache_misses");
+
+// Create the ProviderCache service
+const makeProviderCache = Effect.gen(function* ($) {
+  const config = defaultConfig;
+  
+  // Create invalidation hub
+  const invalidationHub = yield* $(Hub.unsafeMake<void>(Number.MAX_SAFE_INTEGER));
+  
+  // Create model list cache
+  const modelListCache = yield* $(Cache.make({
+    capacity: config.maxEntries,
+    timeToLive: config.modelListTTL,
+    lookup: (key: CacheKey & { _tag: "modelList" }) => 
+      Effect.gen(function* ($) {
+        yield* $(Metric.increment(cacheMissMetric));
+        // Simulate API call - in real implementation this would call the actual provider API
+        return yield* $(Effect.promise(() => 
+          fetchModelListFromProvider(key.providerId)
+        ));
+      })
+  }));
+  
+  // Create capability cache
+  const capabilityCache = yield* $(Cache.make({
+    capacity: config.maxEntries,
+    timeToLive: config.capabilityTTL,
+    lookup: (key: CacheKey & { _tag: "capability" }) => 
+      Effect.gen(function* ($) {
+        yield* $(Metric.increment(cacheMissMetric));
+        // Simulate API call - in real implementation this would call the actual provider API
+        return yield* $(Effect.promise(() => 
+          fetchCapabilityFromProvider(key.providerId, key.modelId)
+        ));
+      })
+  }));
+  
+  // Subscribe to invalidation events
+  yield* $(Effect.forkDaemon(Queue.takeAll(invalidationHub).pipe(
+    Effect.flatMap(Effect.forEach((providerId: ProviderId) => 
+      invalidateProviderCaches(providerId, modelListCache, capabilityCache)
+    )),
+    Effect.forever
+  )));
+  
+  // Return the service
+  return {
+    getModelList: (providerId: ProviderId) => 
+      Effect.gen(function* ($) {
+        const key: CacheKey = { _tag: "modelList", providerId };
+        const result = yield* $(modelListCache.get(key));
+        yield* $(Metric.increment(cacheHitMetric));
+        return result;
+      }).pipe(
+        Effect.catchAll(() => 
+          modelListCache.get({ _tag: "modelList", providerId } as CacheKey & { _tag: "modelList" })
+        )
+      ),
+    
+    getCapability: (providerId: ProviderId, modelId: string) => 
+      Effect.gen(function* ($) {
+        const key: CacheKey = { _tag: "capability", providerId, modelId };
+        const result = yield* $(capabilityCache.get(key));
+        yield* $(Metric.increment(cacheHitMetric));
+        return result;
+      }).pipe(
+        Effect.catchAll(() => 
+          capabilityCache.get({ _tag: "capability", providerId, modelId } as CacheKey & { _tag: "capability" })
+        )
+      ),
+    
+    invalidateProvider: (providerId: ProviderId) => 
+      invalidateProviderCaches(providerId, modelListCache, capabilityCache),
+    
+    invalidateAll: () => 
+      Effect.gen(function* ($) {
+        yield* $(modelListCache.invalidateAll());
+        yield* $(capabilityCache.invalidateAll());
+      })
+  } satisfies ProviderCacheService;
+});
+
+// Helper function to invalidate all caches for a provider
+const invalidateProviderCaches = (
+  providerId: ProviderId,
+  modelListCache: Cache.Cache<CacheKey & { _tag: "modelList" }, unknown, unknown>,
+  capabilityCache: Cache.Cache<CacheKey & { _tag: "capability" }, unknown, unknown>
+) => 
+  Effect.gen(function* ($) {
+    // For simplicity, we're invalidating all entries for the provider
+    // In a more complex implementation, you might want to be more selective
+    yield* $(modelListCache.invalidateAll());
+    yield* $(capabilityCache.invalidateAll());
+  });
+
+// Simulated API calls - these would be replaced with actual provider API calls
+const fetchModelListFromProvider = async (providerId: ProviderId): Promise<unknown> => {
+  // Simulate network delay
+  await new Promise(resolve => setTimeout(resolve, 100));
+  return {
+    providerId,
+    models: [`model-1-${Date.now()}`, `model-2-${Date.now()}`],
+    timestamp: new Date().toISOString()
+  };
+};
+
+const fetchCapabilityFromProvider = async (providerId: ProviderId, modelId: string): Promise<unknown> => {
+  // Sim