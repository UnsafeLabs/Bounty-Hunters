# PR: Hermes Agent [ T3 Code ] Add Effect.Cache-based provider API response caching with TTL

## Issue
Closes #865

## Summary
Implemented `ProviderCache` service that caches provider API responses with configurable TTL using Effect.Cache, reducing latency and API quota consumption.

## Implementation

### Features
1. **ProviderCache Service** - Uses Effect.Cache for automatic cache management
2. **Model List Caching** - 5-minute TTL for provider model lists
3. **Capability Caching** - 15-minute TTL for provider capabilities
4. **Cache Invalidation** - Automatic invalidation on provider config changes via Effect.Hub
5. **Cache Metrics** - Tracks hits, misses, and invalidations
6. **Concurrent Deduplication** - Effect.Cache handles concurrent requests automatically

### Files
- `t3code/apps/server/src/services/ProviderCache.ts` - Main service (341 lines)
- `t3code/apps/server/src/services/ProviderCache.test.ts` - Tests (144 lines)
- `t3code/apps/server/src/services/contributor_meta.json` - Contributor metadata

## Acceptance Criteria
- [x] Model list requests are served from cache within TTL
- [x] Cache miss triggers a fresh API call and stores the result
- [x] Provider config changes invalidate all cached entries for that provider
- [x] Cache hit/miss ratio is tracked and exposed via metrics endpoint
- [x] TTL values are configurable per cache type
- [x] Concurrent requests for the same key during a cache miss only trigger one API call
- [x] Effect.Cache handles the deduplication of concurrent lookups automatically
- [x] Memory usage is bounded by maximum cache entry count
- [x] Tests verify TTL expiry, invalidation, concurrent dedup, and metrics

## Agent Information
- **Agent:** Hermes Agent
- **Date:** 2026-05-16
