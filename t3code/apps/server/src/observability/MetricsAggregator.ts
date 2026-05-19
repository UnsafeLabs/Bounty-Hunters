import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Stream from 'effect/Stream'
import * as Chunk from 'effect/Chunk'
import * as Context from 'effect/Context'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

export interface CallMetric {
  method: string
  latencyMs: number
  isError: boolean
}

export interface WindowMetrics {
  timestamp: number
  methods: Record<string, {
    p50: number
    p95: number
    p99: number
    errorRate: number
    throughput: number
  }>
}

export interface MetricsAggregatorShape {
  readonly recordCall: (metric: CallMetric) => Effect.Effect<void>
  readonly getAggregatedMetrics: () => Effect.Effect<WindowMetrics[]>
}

export class MetricsAggregator extends Context.Service<MetricsAggregator, MetricsAggregatorShape>()(
  "@services/MetricsAggregator"
) {}

export const MetricsAggregatorLive = Layer.effect(
  MetricsAggregator,
  Effect.gen(function* () {
    const callQueue = yield* Queue.unbounded<CallMetric>()
    const aggregatedWindows = yield* Ref.make<WindowMetrics[]>([])

    const aggregateStream = Stream.fromQueue(callQueue).pipe(
      Stream.groupedWithin(Number.MAX_SAFE_INTEGER, "1 minute"),
      Stream.map(chunk => {
        const calls = Chunk.toArray(chunk)
        if (calls.length === 0) return null

        const byMethod = calls.reduce((acc, call) => {
          if (!acc[call.method]) acc[call.method] = { latencies: [], errorCount: 0 }
          acc[call.method].latencies.push(call.latencyMs)
          if (call.isError) acc[call.method].errorCount++
          return acc
        }, {} as Record<string, { latencies: number[], errorCount: number }>)

        const methodMetrics: WindowMetrics['methods'] = {}
        for (const [method, data] of Object.entries(byMethod)) {
          data.latencies.sort((a, b) => a - b)
          const count = data.latencies.length
          methodMetrics[method] = {
            p50: data.latencies[Math.floor(count * 0.50)] || 0,
            p95: data.latencies[Math.floor(count * 0.95)] || 0,
            p99: data.latencies[Math.floor(count * 0.99)] || 0,
            errorRate: (data.errorCount / count) * 100,
            throughput: count / 60
          }
        }

        return { timestamp: Date.now(), methods: methodMetrics }
      }),
      Stream.sliding(60),
      Stream.runForEach(windows => {
        const validWindows = Chunk.toArray(windows).filter(w => w !== null) as WindowMetrics[]
        return Ref.set(aggregatedWindows, validWindows)
      })
    )

    const scope = yield* Effect.acquireRelease(Scope.make(), scope => Scope.close(scope, { _tag: "Void" } as any))
    yield* Effect.forkIn(aggregateStream, scope)

    return {
      recordCall: (metric) => Effect.asVoid(Queue.offer(callQueue, metric)),
      getAggregatedMetrics: () => Ref.get(aggregatedWindows)
    }
  })
)
