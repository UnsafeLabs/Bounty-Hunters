/**
 * MetricsAggregator Service
 * 
 * Collects RPC metrics into 1-minute sliding windows and provides
 * aggregated metrics via Effect.Stream.
 */

import { Effect, Ref, Schedule, Stream, pipe, Duration, Array as Arr } from "effect"
import { createServer } from "http"

// Types
export interface RpcMetric {
  readonly method: string
  readonly latencyMs: number
  readonly isError: boolean
  readonly timestamp: number
}

export interface WindowMetrics {
  readonly windowStart: number
  readonly windowEnd: number
  readonly methods: Record<string, MethodMetrics>
  readonly totalRequests: number
  readonly totalErrors: number
  readonly errorRate: number
  readonly throughput: number
}

export interface MethodMetrics {
  readonly p50: number
  readonly p95: number
  readonly p99: number
  readonly errorRate: number
  readonly throughput: number
  readonly requestCount: number
  readonly errorCount: number
}

interface AggregatorState {
  readonly currentWindow: RpcMetric[]
  readonly windows: WindowMetrics[]
  readonly windowStart: number
}

// Percentile Calculation
export const calculatePercentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower
  if (lower === upper) return sorted[lower]
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

export const calculatePercentiles = (latencies: number[]): { p50: number; p95: number; p99: number } => {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0 }
  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
  }
}

// Window Aggregation
export const aggregateWindow = (metrics: RpcMetric[], windowStart: number, windowEnd: number): WindowMetrics => {
  const windowDurationSec = (windowEnd - windowStart) / 1000
  const totalRequests = metrics.length
  const totalErrors = metrics.filter((m) => m.isError).length
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0
  const throughput = windowDurationSec > 0 ? totalRequests / windowDurationSec : 0

  const methodGroups = new Map<string, RpcMetric[]>()
  for (const metric of metrics) {
    const group = methodGroups.get(metric.method) ?? []
    group.push(metric)
    methodGroups.set(metric.method, group)
  }

  const methods: Record<string, MethodMetrics> = {}
  for (const [method, groupMetrics] of methodGroups) {
    const latencies = groupMetrics.map((m) => m.latencyMs)
    const methodErrors = groupMetrics.filter((m) => m.isError).length
    const percentiles = calculatePercentiles(latencies)

    methods[method] = {
      p50: percentiles.p50,
      p95: percentiles.p95,
      p99: percentiles.p99,
      errorRate: groupMetrics.length > 0 ? (methodErrors / groupMetrics.length) * 100 : 0,
      throughput: windowDurationSec > 0 ? groupMetrics.length / windowDurationSec : 0,
      requestCount: groupMetrics.length,
      errorCount: methodErrors,
    }
  }

  return { windowStart, windowEnd, methods, totalRequests, totalErrors, errorRate, throughput }
}

// Circular Buffer
export const addToCircularBuffer = <T>(buffer: T[], item: T, capacity: number): T[] => {
  const newBuffer = [...buffer, item]
  if (newBuffer.length > capacity) return newBuffer.slice(newBuffer.length - capacity)
  return newBuffer
}

// MetricsAggregator Service
export class MetricsAggregator extends Effect.Service<MetricsAggregator>()("MetricsAggregator", {
  accessors: true,
  effect: Effect.gen(function* () {
    const stateRef = yield* Ref.make<AggregatorState>({
      currentWindow: [],
      windows: [],
      windowStart: Date.now(),
    })

    const WINDOW_DURATION_MS = 60 * 1000
    const MAX_WINDOWS = 60

    const record = (metric: RpcMetric) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        currentWindow: [...state.currentWindow, metric],
      }))

    const getState = Ref.get(stateRef)

    const rotateWindow = Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      const now = Date.now()
      const windowMetrics = aggregateWindow(state.currentWindow, state.windowStart, now)
      const newWindows = addToCircularBuffer(state.windows, windowMetrics, MAX_WINDOWS)
      yield* Ref.set(stateRef, { currentWindow: [], windows: newWindows, windowStart: now })
      return windowMetrics
    })

    const startRotation = pipe(
      rotateWindow,
      Effect.repeat(Schedule.fixed(Duration.minutes(1))),
      Effect.forkDaemon,
    )

    const getAggregatedMetrics = Ref.get(stateRef).pipe(Effect.map((state) => state.windows))

    const getMetricsJson = getAggregatedMetrics.pipe(Effect.map((windows) => JSON.stringify(windows, null, 2)))

    const startHttpServer = Effect.sync(() => {
      const server = createServer(async (req, res) => {
        if (req.url === "/metrics/aggregated" && req.method === "GET") {
          const json = await Effect.runPromise(getMetricsJson)
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(json)
        } else {
          res.writeHead(404)
          res.end("Not Found")
        }
      })
      server.listen(3000, () => {
        console.log("Metrics server listening on http://localhost:3000")
        console.log("Endpoint: GET http://localhost:3000/metrics/aggregated")
      })
      return server
    })

    return { record, getState, rotateWindow, startRotation, getAggregatedMetrics, getMetricsJson, startHttpServer } as const
  }),
}) {}
