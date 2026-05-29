import { Effect, Layer, Ref, Schedule, Stream } from "effect";
import * as Duration from "effect/Duration";
import * as Array from "effect/Array";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";

// Types for our metrics
interface RPCCallMetric {
  readonly method: string;
  readonly timestamp: number;
  readonly duration: number;
  readonly error: boolean;
}

interface AggregatedWindow {
  readonly timestamp: number;
  readonly metrics: Record<string, {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly errorRate: number;
    readonly throughput: number;
  }>;
}

// Circular buffer for storing windows
class CircularBuffer<A> {
  private buffer: Array<A> = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  push(item: A): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  getBuffer(): Array<A> {
    return this.buffer;
  }

  getLength(): number {
    return this.buffer.length;
  }
}

// Metrics aggregator service
export class MetricsAggregator extends Effect.Service<MetricsAggregator>()(
  "MetricsAggregator",
  {
    accessible: true,
    effect: Effect.gen(function* () {
      // Create a queue for incoming metrics
      const queue = yield* Queue.unbounded<RPCCallMetric>();
      
      // Create circular buffer for 60 windows (1 hour of 1-minute windows)
      const buffer = new CircularBuffer<AggregatedWindow>(60);
      const bufferRef = yield* Ref.make(buffer);
      
      // Start the aggregation stream
      yield* Stream.fromQueue(queue)
        .pipe(
          // Group metrics into 1-minute sliding windows
          Stream.groupAdjacentBy((metric) => Math.floor(metric.timestamp / 60000)),
          Stream.mapEffect(({ tuple: [windowKey, metrics] }) => 
            Effect.gen(function* () {
              // Group metrics by method
              const grouped = metrics.reduce((acc, metric) => {
                if (!acc[metric.method]) {
                  acc[metric.method] = [];
                }
                acc[metric.method].push(metric);
                return acc;
              }, {} as Record<string, RPCCallMetric[]>);
              
              // Calculate aggregated metrics per method
              const aggregatedMetrics: AggregatedWindow["metrics"] = {};
              
              for (const [method, methodMetrics] of Object.entries(grouped)) {
                // Sort by duration for percentile calculation
                const sortedDurations = methodMetrics
                  .map(m => m.duration)
                  .sort((a, b) => a - b);
                
                // Calculate percentiles
                const p50 = calculatePercentile(sortedDurations, 50);
                const p95 = calculatePercentile(sortedDurations, 95);
                const p99 = calculatePercentile(sortedDurations, 99);
                
                // Calculate error rate
                const totalRequests = methodMetrics.length;
                const errorCount = methodMetrics.filter(m => m.error).length;
                const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;
                
                // Calculate throughput (requests per second)
                const windowStart = windowKey * 60000;
                const windowEnd = windowStart + 60000;
                const windowDurationSeconds = 60;
                const throughput = totalRequests / windowDurationSeconds;
                
                aggregatedMetrics[method] = {
                  p50,
                  p95,
                  p99,
                  errorRate,
                  throughput
                };
              }
              
              // Create window object
              const window: AggregatedWindow = {
                timestamp: windowKey * 60000,
                metrics: aggregatedMetrics
              };
              
              // Update buffer
              yield* Ref.update(bufferRef, (buf) => {
                buf.push(window);
                return buf;
              });
              
              return window;
            })
          ),
          // Run every minute
          Stream.schedule(Schedule.spaced(Duration.minutes(1)))
        )
        .runDrain
        .pipe(
          Effect.forkDaemon
        );
      
      return {
        recordMetric: (metric: RPCCallMetric) =>
          Effect.gen(function* () {
            yield* Queue.offer(queue, metric);
          }),
        getAggregatedMetrics: Effect.gen(function* () {
          const buf = yield* Ref.get(bufferRef);
          return buf.getBuffer();
        })
      };
    })
  }
);

// Helper function to calculate percentiles
function calculatePercentile(sortedArray: number[], percentile: number): number {
  if (sortedArray.length === 0) return 0;
  
  const index = (percentile / 100) * (sortedArray.length - 1);
  
  if (Number.isInteger(index)) {
    return sortedArray[index as number];
  } else {
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }
}

// Export the layer for the service
export const MetricsAggregatorLive = Layer.effect(MetricsAggregator, MetricsAggregator.Default);