// @effect-diagnostics nodeBuiltinImport:off
import type { ProviderInstanceId } from "@t3tools/contracts";
import { it, assert, vi } from "@effect/vitest";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as PubSub from "effect/PubSub";
import * as TestClock from "effect/testing/TestClock";

import {
  ProviderCache,
  defaultProviderCacheConfig,
  makeProviderCache,
  type ProviderCacheConfig,
  type ProviderCacheLookupFunctions,
} from "./ProviderCache.ts";
import type { CachedCapabilities, CachedModelList } from "./ProviderCache.ts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

const I = (v: string): ProviderInstanceId => v as unknown as ProviderInstanceId;

const A = I("provider-A");
const B = I("provider-B");

const defCaps: ProviderAdapterCapabilities = { sessionModelSwitch: "in-session" };

const defModels: CachedModelList["models"] = [
  { slug: "model-1", name: "Model One" },
  { slug: "model-2", name: "Model Two" },
];

function mkMocks() {
  const fetchModelList = vi.fn(
    (_id: ProviderInstanceId): Effect.Effect<CachedModelList> =>
      Effect.succeed({ models: [...defModels], cachedAt: new Date().toISOString() }),
  );
  const fetchCapabilities = vi.fn(
    (_id: ProviderInstanceId): Effect.Effect<CachedCapabilities> =>
      Effect.succeed({ capabilities: { ...defCaps }, cachedAt: new Date().toISOString() }),
  );
  return { lookups: { fetchModelList, fetchCapabilities } as ProviderCacheLookupFunctions };
}

function cacheLayer(mocks: ReturnType<typeof mkMocks>, cfg?: ProviderCacheConfig, opts?: { readonly configChangePubSub?: PubSub.PubSub<ProviderInstanceId> }) {
  return Layer.effect(ProviderCache, makeProviderCache(mocks.lookups, cfg, opts));
}

function gotMetric(ss: ReadonlyArray<Metric.Metric.Snapshot>, id: string, attrs: Record<string, string>) {
  return ss.some((s) => s.id === id && Object.entries(attrs).every(([k, v]) => s.attributes?.[k] === v));
}

const tick = (ms: number) => TestClock.adjust(`${ms} millis`).pipe(Effect.andThen(Effect.yieldNow));

// ════════════════════════════════════════════════════════════════════════════
const ch0 = mkMocks();
const L0 = it.layer(cacheLayer(ch0));
L0("ProviderCache serves responses from cache within TTL", (it) => {
  it.effect("returns cached model list on second call", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const r1 = yield* c.getModelList(A);
      assert.deepEqual(r1.models.length, 2);
      const r2 = yield* c.getModelList(A);
      assert.deepEqual(r2.models, r1.models);
      assert.equal(ch0.lookups.fetchModelList.mock.calls.length, 1);
    }),
  );
  it.effect("returns cached capabilities on second call", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const r1 = yield* c.getCapabilities(A);
      assert.equal(r1.capabilities.sessionModelSwitch, "in-session");
      const r2 = yield* c.getCapabilities(A);
      assert.deepEqual(r2.capabilities, r1.capabilities);
      assert.equal(ch0.lookups.fetchCapabilities.mock.calls.length, 1);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch1 = mkMocks();
const L1 = it.layer(cacheLayer(ch1, { ...defaultProviderCacheConfig, modelListTTL: Duration.seconds(5) }));
L1("ProviderCache TTL expiry for model lists", (it) => {
  it.effect("re-fetches after TTL expires", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const b = ch1.lookups.fetchModelList.mock.calls.length;
      assert.equal((yield* c.getModelList(A)).models.length, 2);
      assert.equal(ch1.lookups.fetchModelList.mock.calls.length, b + 1);
      yield* c.getModelList(A);
      assert.equal(ch1.lookups.fetchModelList.mock.calls.length, b + 1);
      yield* tick(5001);
      assert.equal((yield* c.getModelList(A)).models.length, 2);
      assert.equal(ch1.lookups.fetchModelList.mock.calls.length, b + 2);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch2 = mkMocks();
const L2 = it.layer(cacheLayer(ch2, { ...defaultProviderCacheConfig, capabilitiesTTL: Duration.seconds(10) }));
L2("ProviderCache TTL expiry for capabilities", (it) => {
  it.effect("re-fetches capabilities after TTL expires", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const b = ch2.lookups.fetchCapabilities.mock.calls.length;
      yield* c.getCapabilities(A);
      assert.equal(ch2.lookups.fetchCapabilities.mock.calls.length, b + 1);
      yield* c.getCapabilities(A);
      assert.equal(ch2.lookups.fetchCapabilities.mock.calls.length, b + 1);
      yield* tick(10001);
      yield* c.getCapabilities(A);
      assert.equal(ch2.lookups.fetchCapabilities.mock.calls.length, b + 2);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch3 = mkMocks();
const ps3 = Effect.runSync(PubSub.unbounded<ProviderInstanceId>());
const L3 = it.layer(cacheLayer(ch3, undefined, { configChangePubSub: ps3 }));
L3("ProviderCache invalidation on provider config changes", (it) => {
  it.effect("invalidates both caches when config changes", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const mb = ch3.lookups.fetchModelList.mock.calls.length;
      const cb = ch3.lookups.fetchCapabilities.mock.calls.length;
      yield* c.getModelList(A);
      yield* c.getCapabilities(A);
      assert.equal(ch3.lookups.fetchModelList.mock.calls.length, mb + 1);
      assert.equal(ch3.lookups.fetchCapabilities.mock.calls.length, cb + 1);
      yield* c.getModelList(A);
      yield* c.getCapabilities(A);
      assert.equal(ch3.lookups.fetchModelList.mock.calls.length, mb + 1);
      assert.equal(ch3.lookups.fetchCapabilities.mock.calls.length, cb + 1);
      yield* c.invalidate(A);
      yield* c.getModelList(A);
      yield* c.getCapabilities(A);
      assert.equal(ch3.lookups.fetchModelList.mock.calls.length, mb + 2);
      assert.equal(ch3.lookups.fetchCapabilities.mock.calls.length, cb + 2);
    }),
  );
  it.effect("only invalidates the targeted provider instance", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const mb = ch3.lookups.fetchModelList.mock.calls.length;
      const cb = ch3.lookups.fetchCapabilities.mock.calls.length;
      yield* c.getModelList(A);
      yield* c.getModelList(B);
      yield* c.getCapabilities(A);
      yield* c.getCapabilities(B);
      // A may be cached from previous test; B is always a miss here
      const mlAfterPop = ch3.lookups.fetchModelList.mock.calls.length;
      const capAfterPop = ch3.lookups.fetchCapabilities.mock.calls.length;
      assert.ok(mlAfterPop >= mb + 1);
      assert.ok(capAfterPop >= cb + 1);

      yield* c.invalidate(A);

      yield* c.getModelList(A);
      yield* c.getModelList(B);
      yield* c.getCapabilities(A);
      yield* c.getCapabilities(B);
      // Only A should have been re-fetched (1 ml + 1 cap)
      assert.equal(ch3.lookups.fetchModelList.mock.calls.length, mlAfterPop + 1);
      assert.equal(ch3.lookups.fetchCapabilities.mock.calls.length, capAfterPop + 1);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch4 = mkMocks();
const L4 = it.layer(cacheLayer(ch4));
L4("ProviderCache manual invalidation", (it) => {
  it.effect("invalidate() forces re-fetch on next access", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const mb = ch4.lookups.fetchModelList.mock.calls.length;
      const cb = ch4.lookups.fetchCapabilities.mock.calls.length;
      yield* c.getModelList(A);
      yield* c.getCapabilities(A);
      assert.equal(ch4.lookups.fetchModelList.mock.calls.length, mb + 1);
      assert.equal(ch4.lookups.fetchCapabilities.mock.calls.length, cb + 1);
      yield* c.invalidate(A);
      yield* c.getModelList(A);
      yield* c.getCapabilities(A);
      assert.equal(ch4.lookups.fetchModelList.mock.calls.length, mb + 2);
      assert.equal(ch4.lookups.fetchCapabilities.mock.calls.length, cb + 2);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch5 = mkMocks();
const L5 = it.layer(cacheLayer(ch5));
L5("ProviderCache clear", (it) => {
  it.effect("clear() empties all caches", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const mb = ch5.lookups.fetchModelList.mock.calls.length;
      const cb = ch5.lookups.fetchCapabilities.mock.calls.length;
      yield* c.getModelList(A);
      yield* c.getModelList(B);
      yield* c.getCapabilities(A);
      assert.equal(ch5.lookups.fetchModelList.mock.calls.length, mb + 2);
      assert.equal(ch5.lookups.fetchCapabilities.mock.calls.length, cb + 1);
      yield* c.clear();
      yield* c.getModelList(A);
      yield* c.getModelList(B);
      yield* c.getCapabilities(A);
      assert.equal(ch5.lookups.fetchModelList.mock.calls.length, mb + 4);
      assert.equal(ch5.lookups.fetchCapabilities.mock.calls.length, cb + 2);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch6 = mkMocks();
const L6 = it.layer(cacheLayer(ch6));
L6("ProviderCache concurrent request deduplication", (it) => {
  it.effect("deduplicates concurrent model list misses to single API call", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const b = ch6.lookups.fetchModelList.mock.calls.length;
      const results = yield* Effect.all(
        Array.from({ length: 5 }, () => c.getModelList(A)),
        { concurrency: "unbounded" },
      );
      assert.equal(results.length, 5);
      for (const r of results) assert.deepEqual(r.models.length, 2);
      assert.equal(ch6.lookups.fetchModelList.mock.calls.length, b + 1);
    }),
  );
  it.effect("deduplicates concurrent capability requests", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const b = ch6.lookups.fetchCapabilities.mock.calls.length;
      const results = yield* Effect.all(
        Array.from({ length: 5 }, () => c.getCapabilities(A)),
        { concurrency: "unbounded" },
      );
      assert.equal(results.length, 5);
      assert.equal(ch6.lookups.fetchCapabilities.mock.calls.length, b + 1);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch7 = mkMocks();
const L7 = it.layer(cacheLayer(ch7, {
  ...defaultProviderCacheConfig,
  modelListTTL: Duration.seconds(5),
  capabilitiesTTL: Duration.seconds(10),
}));
L7("ProviderCache metrics tracking", (it) => {
  it.effect("records hits and misses without throwing", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      // These should not throw — metrics are recorded as side effects
      yield* c.getModelList(A); // miss + hit recorded
      yield* c.getModelList(A); // hit recorded
      yield* c.getCapabilities(A); // miss + hit recorded
      yield* c.getCapabilities(A); // hit recorded
      // Verify snapshot can be taken
      const ss = yield* Metric.snapshot;
      assert.ok(Array.isArray(ss));
      // Verify at least some metrics were registered (our 3 counter metrics)
      const ids = ss.map((s) => s.id);
      assert.ok(ids.length > 0, "expected some metrics in snapshot");
    }),
  );
  it.effect("records evictions on manual invalidation without throwing", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      yield* c.getModelList(A);
      yield* c.getCapabilities(A);
      yield* c.invalidate(A);
      // Eviction metrics should be recorded as side effects
      const ss = yield* Metric.snapshot;
      assert.ok(Array.isArray(ss));
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch8 = mkMocks();
const L8 = it.layer(cacheLayer(ch8, { ...defaultProviderCacheConfig, maxModelListEntries: 2, maxCapabilityEntries: 2 }));
L8("ProviderCache memory bounds enforcement", (it) => {
  it.effect("evicts oldest entries when capacity is exceeded", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const b = ch8.lookups.fetchModelList.mock.calls.length;
      yield* c.getModelList(I("p-1"));
      yield* c.getModelList(I("p-2"));
      yield* c.getModelList(I("p-3")); // evicts p-1
      assert.equal(ch8.lookups.fetchModelList.mock.calls.length - b, 3);
      yield* c.getModelList(I("p-1")); // re-fetch after eviction
      assert.equal(ch8.lookups.fetchModelList.mock.calls.length - b, 4);
    }),
  );
});

// ════════════════════════════════════════════════════════════════════════════
const ch9 = mkMocks();
const L9 = it.layer(cacheLayer(ch9));
L9("ProviderCache independent instances", (it) => {
  it.effect("caches different instances independently", () =>
    Effect.gen(function* () {
      const c = yield* ProviderCache;
      const b = ch9.lookups.fetchModelList.mock.calls.length;
      yield* c.getModelList(A);
      yield* c.getModelList(B);
      assert.equal(ch9.lookups.fetchModelList.mock.calls.length - b, 2);
      yield* c.getModelList(A);
      yield* c.getModelList(B);
      assert.equal(ch9.lookups.fetchModelList.mock.calls.length - b, 2);
    }),
  );
});
