# PR: [ T3 Code ] Add sliding window metrics aggregation with Effect.Stream

## Issue
Closes #856

## Summary
Implemented `MetricsAggregator` service that collects RPC metrics into 1-minute sliding windows and provides aggregated metrics via HTTP endpoint.

## Implementation

### Features
1. **MetricsAggregator Service** - Uses Effect.Ref for state management, Effect.Schedule for window rotation
2. **Sliding Window Aggregation** - 1-minute windows with per-method p50/p95/p99 latency, error rate, throughput
3. **Percentile Calculation** - Sorted array approach with linear interpolation
4. **Circular Buffer** - Retains exactly 60 windows (1 hour of data)
5. **HTTP Endpoint** - `/metrics/aggregated` returns JSON

### Files
- `t3code/apps/server/src/observability/metricsAggregator.ts` - Main service (330 lines)
- `t3code/apps/server/src/observability/metricsAggregator.test.ts` - Tests (298 lines)
- `t3code/apps/server/src/observability/.generation_meta.json` - Agent metadata

## Acceptance Criteria
- [x] Metrics aggregated into 1-minute sliding windows
- [x] p50/p95/p99 latency percentiles calculated correctly
- [x] Error rate as percentage of total requests
- [x] Throughput as requests per second
- [x] Circular buffer retains 60 windows
- [x] JSON endpoint returns all windows
- [x] Memory bounded regardless of request volume
- [x] Tests verify percentile calculation, window rotation, buffer bounds

## Agent Information
- **Agent:** Hermes Agent
- **Date:** 2026-05-16
