Looking at the issue, I need to create a caching system for provider API responses using Effect.Cache with TTL functionality. Let me analyze what's needed:

1. Create a ProviderCache service with Effect.Cache
2. Cache model lists with 5-minute TTL
3. Cache capability queries with 15-minute TTL
4. Handle cache invalidation via Effect.Hub subscription
5. Add metrics tracking
6. Implement concurrent request deduplication

Let me create the ProviderCache.ts file:

```diff
--- /dev/null
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,269 @@
+import { Cache, Effect, Layer, Metric, Context, Hub, Duration, Option, pipe } from "@effect/effect"
+import type { ProviderModelList, ProviderCapability } from "../types/provider"
+
+// Cache configuration
+interface CacheConfig {
+  modelListTTL: Duration.Duration
+  capabilityQueryTTL: Duration.Duration
+  maxEntries: number
+}
+
+const defaultConfig: CacheConfig = {
+  modelListTTL: Duration.minutes(5),
+  capabilityQueryTTL: Duration.minutes(15),
+  maxEntries: 1000
+}
+
+// Metrics for cache performance tracking
+const CacheMetrics = {
+  hitCount: Metric.counter("provider_cache_hits", { description: "Number of cache hits" }),
+  missCount: Metric.counter("provider_cache_misses", { description: "Number of cache misses" }),
+  cacheSize: Metric.gauge("provider_cache_size", { description: "Current cache size" }),
+  cacheInvalidations: Metric.counter("provider_cache_invalidations", { description: "Number of cache invalidations" })
+}
+
+// Cache key types
+type CacheKey = 
+  | { _tag: "modelList"; providerId: string }
+  | { _tag: "capability"; providerId: string; modelId: string }
+
+// Create cache instances
+const modelListCache = Cache.make<ReadonlyArray<ProviderModelList>, CacheKey>({
+  lookup: (key: CacheKey) => {
+    if (key._tag === "modelList") {
+      return Effect.succeed([] as ReadonlyArray<ProviderModelList>)
+    }
+    return Effect.succeed({} as ProviderCapability)
+  },
+  capacity: defaultConfig.maxEntries,
+  timeToLive: (key: CacheKey) => {
+    if (key._tag === "modelList") {
+      return defaultConfig.modelListTTL
+    }
+    return defaultConfig.capabilityQueryTTL
+  }
+})
+
+// Capability cache
+const capabilityCache = Cache.make<ProviderCapability, CacheKey>({
+  lookup: () => Effect.succeed({} as ProviderCapability),
+  capacity: defaultConfig.maxEntries,
+  timeToLive: defaultConfig.capabilityQueryTTL
+})
+
+// Cache service context
+export interface ProviderCacheService {
+  readonly modelListCache: Cache.Cache<ReadonlyArray<ProviderModelList>, CacheKey>
+  readonly capabilityCache: Cache.Cache<ProviderCapability, CacheKey>
+  readonly cacheMetrics: typeof CacheMetrics
+  readonly config: CacheConfig
+}
+
+export const ProviderCacheService = Context.GenericTag<ProviderCacheService>("@services/ProviderCacheService")
+
+// Effect to get model list with caching
+export const getModelListWithCache = (providerId: string) => 
+  Effect.gen(function*(_) {
+    const service = yield* _(ProviderCacheService)
+    const key: CacheKey = { _tag: "modelList", providerId }
+    
+    // Check if we have a cached value
+    const cached = yield* _(Cache.get(service.modelListCache, key))
+    if (Option.isSome(cached)) {
+      yield* _(CacheMetrics.hitCount)
+      return cached.value
+    }
+    
+    // Cache miss - increment metric and fetch
+    yield* _(CacheMetrics.missCount)
+    // Simulate API call - in real implementation this would call the actual provider API
+    const result = [] as ReadonlyArray<ProviderModelList>
+    yield* _(Cache.set(service.modelListCache, key, result))
+    return result
+  })
+
+// Effect to get capability with caching
+export const getCapabilityWithCache = (providerId: string, modelId: string) => 
+  Effect.gen(function*(_) {
+    const service = yield* _(ProviderCacheService)
+    const key: CacheKey = { _tag: "capability", providerId, modelId }
+    
+    // Check if we have a cached value
+    const cached = yield* _(Cache.get(service.capabilityCache, key))
+    if (Option.isSome(cached)) {
+      yield* _(CacheMetrics.hitCount)
+      return cached.value
+    }
+    
+    // Cache miss - increment metric and fetch
+    yield* _(CacheMetrics.missCount)
+    // Simulate API call - in real implementation this would call the actual provider API
+    const result = {} as ProviderCapability
+    yield* _(Cache.set(service.capabilityCache, key, result))
+    return result
+  })
+
+// Cache invalidation hub for provider config changes
+export const ProviderConfigChange = Hub.unsafeMake<{ providerId: string } | "all">("provider-config-change")
+
+// Effect to invalidate cache entries for a provider
+export const invalidateProviderCache = (providerId: string) => 
+  Effect.gen(function*(_) {
+    const service = yield* _(ProviderCacheService)
+    yield* _(CacheMetrics.cacheInvalidations)
+    
+    // Invalidate specific provider or all entries
+    if (providerId === "all") {
+      yield* _(Cache.invalidateAll(service.modelListCache))
+      yield* _(Cache.invalidateAll(service.capabilityCache))
+    } else {
+      // Find and remove entries for specific provider
+      const modelListKey: CacheKey = { _tag: "modelList", providerId: providerId as string }
+      const entries = yield* _(Cache.entries(service.modelListCache))
+      for (const [key, _value] of entries) {
+        if (key._tag === "modelList" && key.providerId === providerId) {
+          yield* _(Cache.remove(service.modelListCache, key))
+        }
+      }
+    }
+  })
+
+// Listen for provider config changes and invalidate cache
+export const cacheInvalidationListener = Effect.gen(function*(_) {
+  const changes = yield* _(ProviderConfigChange)
+  yield* _(Hub.subscribe(changes, (update) => 
+    Effect.gen(function*(__) {
+      if (update === "all") {
+        yield* __(ProviderCacheService)
+        yield* __(Cache.invalidateAll(modelListCache))
+       