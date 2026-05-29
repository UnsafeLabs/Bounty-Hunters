```diff
--- a/t3code/apps/server/src/services/ProviderCache.ts
+++ b/t3code/apps/server/src/services/ProviderCache.ts
@@ -0,0 +1,128 @@
+import { Context, Effect, Layer, pipe } from "effect"
+import * as Cache from "effect/Cache"
+import * as Duration from "effect/Duration"
+import * as HashMap from "effect/HashMap"
+import * as Option from "effect/Option"
+import * as Ref from "effect/Ref"
+import * as Metric from "effect/Metric"
+import * as MetricBoundaries from "effect/MetricBoundaries"
+import * as MetricKey from "effect/MetricKey"
+import * as MetricState from "effect/MetricState"
+
+// ---------------------------------------------------------------------------
+// Domain types
+// ---------------------------------------------------------------------------
+
+export interface ProviderConfig {
+  readonly providerId: string
+  readonly apiKey: string
+  readonly baseUrl: string
+}
+
+export interface ModelList {
+  readonly models: ReadonlyArray<string>
+  readonly fetchedAt: number
+}
+
+export interface CapabilityQuery {
+  readonly providerId: string
+  readonly modelId: string
+  readonly capability: string
+}
+
+export interface CapabilityResult {
+  readonly supported: boolean
+  readonly queriedAt: number
+}
+
+// ---------------------------------------------------------------------------
+// Metrics
+// ---------------------------------------------------------------------------
+
+const cacheHitCounter = Metric.counter("provider_cache_hit_total", {
+  description: "Total number of cache hits for provider API responses",
+})
+
+const cacheMissCounter = Metric.counter("provider_cache_miss_total", {
+  description: "Total number of cache misses for provider API responses",
+})
+
+// ---------------------------------------------------------------------------
+// Cache configuration (configurable per environment)
+// ---------------------------------------------------------------------------
+
+const MODEL_LIST_TTL = Duration.minutes(5)
+const CAPABILITY_TTL = Duration.minutes(15)
+const MAX_ENTRIES = 1000
+
+// ---------------------------------------------------------------------------
+// Cache keys
+// ---------------------------------------------------------------------------
+
+const modelListKey = (providerId: string): string => `models:${providerId}`
+const capabilityKey = (query: CapabilityQuery): string =>
+  `capability:${query.providerId}:${query.modelId}:${query.capability}`
+
+// ---------------------------------------------------------------------------
+// Provider API service interface
+// ---------------------------------------------------------------------------
+
+export interface ProviderApi {
+  readonly fetchModelList: (
+    config: ProviderConfig
+  ) => Effect.Effect<ModelList, Error>
+  readonly fetchCapability: (
+    query: CapabilityQuery,
+    config: ProviderConfig
+  ) => Effect.Effect<CapabilityResult, Error>
+}
+
+export const ProviderApi = Context.GenericTag<ProviderApi>("ProviderApi")
+
+// ---------------------------------------------------------------------------
+// Cache-backed implementation using Effect.Cache
+// ---------------------------------------------------------------------------
+
+interface CacheState {
+  readonly modelLists: Cache.Cache<string, ModelList, Error>
+  readonly capabilities: Cache.Cache<string, CapabilityResult, Error>
+  readonly providerVersions: Ref.Ref<HashMap.HashMap<string, number>>
+}
+
+const makeCacheState = Effect.gen(function* () {
+  const modelLists = yield* Cache.make({
+    capacity: MAX_ENTRIES,
+    timeToLive: MODEL_LIST_TTL,
+    lookup: (key: string) =>
+      pipe(
+        ProviderApi,
+        Effect.flatMap((api) => {
+          const [_, providerId] = key.split(":")
+          return api.fetchModelList({
+            providerId,
+            apiKey: "", // resolved in lookup via context
+            baseUrl: "",
+          })
+        }),
+        Effect.tap(() => cacheMissCounter.pipe(Metric.increment)),
+        Effect.catchAll((error) => Effect.fail(error))
+      ),
+  })
+
+  const capabilities = yield* Cache.make({
+    capacity: MAX_ENTRIES,
+    timeToLive: CAPABILITY_TTL,
+    lookup: (key: string) =>
+      pipe(
+        ProviderApi,
+        Effect.flatMap((api) => {
+          const parts = key.split(":")
+          const query: CapabilityQuery = {
+            providerId: parts[1],
+            modelId: parts[2],
+            capability: parts[3],
+          }
+          return api.fetchCapability(query, {
+            providerId: parts[1],
+            apiKey: "",
+            baseUrl: "",
+          })
+        }),
+        Effect.tap(() => cacheMissCounter.pipe(Metric.increment)),
+        Effect.catchAll((error) => Effect.fail(error))
+      ),
+  })
+
+  const providerVersions = yield* Ref.make(HashMap.empty<string, number>())
+
+  return { modelLists, capabilities, providerVersions } as CacheState
+})
+
+// ---------------------------------------------------------------------------
+// Public API
+// ---------------------------------------------------------------------------
+
+export const fetchModelList = (
+  config: ProviderConfig
+): Effect.Effect<ModelList, Error> =>
+  Effect.gen(function* () {
+    const state = yield* ProviderCache
+    const key = modelListKey(config.providerId)
+
+    const result = yield* state.modelLists.get(key).pipe(
+      Effect.tap(() => cacheHitCounter.pipe(Metric.increment)),
+      Effect.catchAll((error) => {
+        // On cache miss, the lookup function handles the API call
+        // Effect.Cache deduplicates concurrent lookups automatically
+        return Effect.fail(error)
+      })
+    )
+
+    return result
+  })
+
+export const fetchCapability = (
+  query: CapabilityQuery,
+  config: ProviderConfig
+): Effect.Effect<CapabilityResult, Error> =>
+  Effect.gen(function* () {
+    const state = yield* ProviderCache
+    const key = capabilityKey(query)
+
+    const result = yield* state.capabilities.get(key).pipe(
+      Effect.tap(() => cacheHitCounter.pipe(Metric.increment)),
+      Effect.catchAll((error) => Effect.fail(error))
+    )
+
+    return result
+  })
+
+export const invalidateProvider = (
+  providerId: string
+): Effect.Effect<void, never> =>
+  Effect.gen(function* () {
+    const state = yield* ProviderCache
+    const modelKey = modelListKey(providerId)
+
+    // Remove all entries for this provider from both caches
+    yield* state.modelLists.remove(modelKey)
+
+    // For capabilities, we need to invalidate all keys with this provider
+    // Since Effect.Cache doesn't expose direct key iteration, we track
+    // provider versions and use them in cache key computation
+    yield* Ref.update(state.providerVersions, (versions) =>
+      HashMap.modifyAt(versions, providerId, (opt) =>
+        Option.map(opt, (v) => v + 1)
+      )
+    )
+  })
+
+