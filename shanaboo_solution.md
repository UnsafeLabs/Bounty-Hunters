```diff
--- /dev/null
+++ b/t3code/apps/server/src/observability/MetricsAggregator.ts
@@ -0,0 +1,296 @@
+import { Effect, Ref, Schedule, Stream, Chunk, Option, pipe } from "effect";
+import * as HttpRouter from "@effect/platform/HttpRouter";
+import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
+
+// ============================================================================
+// Types
+// ============================================================================
+
+export interface RpcMetric {
+  readonly method: string;
+  readonly latencyMs: number;
+  readonly error: boolean;
+  readonly timestamp: number;
+}
+
+export interface MethodMetrics {
+  readonly p50: number;
+  readonly p95: number;
+  readonly p99: number;
+  readonly errorRate: number;
+  readonly throughput: number;
+}
+
+export interface WindowMetrics {
+  readonly windowStart: number;
+  readonly windowEnd: number;
+  readonly methods: Record<string, MethodMetrics>;
+}
+
+export interface MetricsAggregatorState {
+  readonly windows: ReadonlyArray<WindowMetrics>;
+  readonly currentWindow: Option.Option<{
+    readonly startTime: number;
+    readonly metrics: Map<string, Array<{ latencyMs: number; error: boolean }>>;
+  }>;
+}
+
+// ============================================================================
+// Circular Buffer Configuration
+// ============================================================================
+
+const WINDOW_SIZE_MS = 60_000; // 1 minute
+const MAX_WINDOWS = 60; // 60 windows = 1 hour
+
+// ============================================================================
+// Percentile Calculation
+// ============================================================================
+
+const calculatePercentile = (sortedArray: ReadonlyArray<number>, percentile: number): number => {
+  if (sortedArray.length === 0) return 0;
+  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
+  const clampedIndex = Math.max(0, Math.min(index, sortedArray.length - 1));
+  return sortedArray[clampedIndex];
+};
+
+const computeMethodMetrics = (
+  entries: ReadonlyArray<{ latencyMs: number; error: boolean }>
+): MethodMetrics => {
+  const latencies = entries.map((e) => e.latencyMs).sort((a, b) => a - b);
+  const totalRequests = entries.length;
+  const errorCount = entries.filter((e) => e.error).length;
+  const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;
+  const throughput = totalRequests / (WINDOW_SIZE_MS / 1000); // requests per second
+
+  return {
+    p50: calculatePercentile(latencies, 50),
+    p95: calculatePercentile(latencies, 95),
+    p99: calculatePercentile(latencies, 99),
+    errorRate,
+    throughput,
+  };
+};
+
+// ============================================================================
+// Window Management
+// ============================================================================
+
+const createEmptyWindow = (startTime: number): MetricsAggregatorState["currentWindow"] =>
+  Option.some({
+    startTime,
+    metrics: new Map(),
+  });
+
+const closeWindow = (
+  currentWindow: NonNullable<MetricsAggregatorState["currentWindow"]>
+): WindowMetrics => {
+  const methods: Record<string, MethodMetrics> = {};
+
+  for (const [method, entries] of currentWindow.metrics.entries()) {
+    methods[method] = computeMethodMetrics(entries);
+  }
+
+  return {
+    windowStart: currentWindow.startTime,
+    windowEnd: currentWindow.startTime + WINDOW_SIZE_MS,
+    methods,
+  };
+};
+
+const addMetricToWindow = (
+  window: NonNullable<MetricsAggregatorState["currentWindow"]>,
+  metric: RpcMetric
+): NonNullable<MetricsAggregatorState["currentWindow"]> => {
+  const existing = window.metrics.get(metric.method) ?? [];
+  window.metrics.set(metric.method, [...existing, { latencyMs: metric.latencyMs, error: metric.error }]);
+  return window;
+};
+
+// ============================================================================
+// Metrics Aggregator Service
+// ============================================================================
+
+export interface MetricsAggregator {
+  readonly record: (metric: RpcMetric) => Effect.Effect<void>;
+  readonly getWindows: () => Effect.Effect<ReadonlyArray<WindowMetrics>>;
+  readonly getCurrentWindow: () => Effect.Effect<Option.Option<WindowMetrics>>;
+}
+
+export const MetricsAggregator = Effect.Tag<MetricsAggregator>("MetricsAggregator");
+
+export const makeMetricsAggregator = Effect.gen(function* () {
+  const stateRef = yield* Ref.make<MetricsAggregatorState>({
+    windows: [],
+    currentWindow: Option.none(),
+  });
+
+  const record = (metric: RpcMetric): Effect.Effect<void> =>
+    Ref.update(stateRef, (state) => {
+      const now = metric.timestamp;
+      const windowStart = Math.floor(now / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;
+
+      if (Option.isNone(state.currentWindow)) {
+        return {
+          ...state,
+          currentWindow: createEmptyWindow(windowStart),
+        };
+      }
+
+      const current = state.currentWindow.value;
+
+      // Check if we need to rotate to a new window
+      if (now >= current.startTime + WINDOW_SIZE_MS) {
+        const closedWindow = closeWindow(current);
+        const newWindows = [...state.windows, closedWindow].slice(-MAX_WINDOWS);
+
+        return {
+          windows: newWindows,
+          currentWindow: createEmptyWindow(windowStart),
+        };
+      }
+
+      return {
+        ...state,
+        currentWindow: Option.some(addMetricToWindow(current, metric)),
+      };
+    });
+
+  const getWindows = (): Effect.Effect<ReadonlyArray<WindowMetrics>> =>
+    Ref.get(stateRef).pipe(Effect.map((state) => state.windows));
+
+  const getCurrentWindow = (): Effect.Effect<Option.Option<WindowMetrics>> =>
+    Ref.get(stateRef).pipe(
+      Effect.map((state) =>
+        Option.map(state.currentWindow, (cw) => ({
+          windowStart: cw.startTime,
+          windowEnd: cw.startTime + WINDOW_SIZE_MS,
+          methods: Object.fromEntries(
+            Array.from(cw.metrics.entries()).map(([method, entries]) => [
+              method,
+              computeMethodMetrics(entries),
+            ])
+          ),
+        }))
+      )
+    );
+
+  return {
+    record,
+    getWindows,
+    getCurrentWindow,
+  } satisfies MetricsAggregator;
+});
+
+// ============================================================================
+// Sliding Window Stream (using Effect.Stream.sliding)
+// ============================================================================
+
+export const createSlidingWindowStream = (
+  windows: ReadonlyArray<WindowMetrics>,
+