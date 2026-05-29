
🧠 Genius Council — Puzzle: "[ T3 Code ] Add Effect.Cache-based provider API response caching with TTL

The server makes repeated calls to external provider APIs for model listing and capability queries without caching, causing unnecessary latency and API quota consumption.

### Implementation

- Create `t3code/apps/server/src/services/ProviderCache.ts` using Effect.Cache with configurable TTL
- Cache provider model lists with a 5-minute TTL
- Cache capability queries with a 15-minute TTL
- Implement cache invalidation on provider configuration changes via Effect.Hub subscription
- Add cache hit/miss metrics exposed through the observability layer
- Use Effect.Cache.make with lookup function that calls the provider API on cache miss

### Acceptance Criteria

- Model list requests are served fr"
   Génies sélectionnés: newton, gauss, pascal, shannon, simons, taleb, poincare

  [newton] Isaac Newton... → WAIT
  [gauss] Carl Friedrich Gauss... → WAIT
  [pascal] Blaise Pascal... → WAIT
  [shannon] Claude Shannon... → WAIT
  [simons] Jim Simons... → WAIT
  [taleb] Nassim Nicholas Taleb... → WAIT
  [poincare] Henri Poincaré... → WAIT

  🔧 Génération de l'outil...

════════════════════════════════════════════════════════════
📊 PUZZLE: [ T3 Code ] Add Effect.Cache-based provider API response caching with TTL

The server makes repeated calls to external provider APIs for model listing and capability queries without caching, causing unnecessary latency and API quota consumption.

### Implementation

- Create `t3code/apps/server/src/services/ProviderCache.ts` using Effect.Cache with configurable TTL
- Cache provider model lists with a 5-minute TTL
- Cache capability queries with a 15-minute TTL
- Implement cache invalidation on provider configuration changes via Effect.Hub subscription
- Add cache hit/miss metrics exposed through the observability layer
- Use Effect.Cache.make with lookup function that calls the provider API on cache miss

### Acceptance Criteria

- Model list requests are served fr
────────────────────────────────────────────────────────────
🎯 CONSENSUS : WAIT  (100% confiance)
⚡ GODLIKE   : 0.000  💤 dormant

💡 INSIGHTS CLÉS :
  • **Isaac Newton** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Carl Friedrich Gauss** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Blaise Pascal** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Claude Shannon** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Jim Simons** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
════════════════════════════════════════════════════════════

