
🧠 Genius Council — Puzzle: "[ T3 Code ] Add gzip and brotli response compression to HTTP layer

The HTTP layer does not implement request/response compression, sending full-size JSON payloads for chat history that can be several megabytes.

### Implementation

- Add gzip and brotli compression middleware to `t3code/apps/server/src/http.ts`
- Compress responses larger than 1KB when the client sends Accept-Encoding with gzip or br
- Prefer brotli over gzip when both are accepted
- Add Content-Encoding response header
- Skip compression for already-compressed content types like images and archives
- Decompress incoming request bodies when Content-Encoding is set

### Acceptance Criteria

- Responses over 1KB are compressed when client supports it
- Brotli is preferred over gzip when both "
   Génies sélectionnés: newton, fibonacci, pythagoras, archimedes, gauss, pascal, shannon, simons

  [newton] Isaac Newton... → WAIT
  [fibonacci] Leonardo Fibonacci... → WAIT
  [pythagoras] Pythagore... → WAIT
  [archimedes] Archimède... → WAIT
  [gauss] Carl Friedrich Gauss... → WAIT
  [pascal] Blaise Pascal... → WAIT
  [shannon] Claude Shannon... → WAIT
  [simons] Jim Simons... → WAIT

  🔧 Génération de l'outil...

════════════════════════════════════════════════════════════
📊 PUZZLE: [ T3 Code ] Add gzip and brotli response compression to HTTP layer

The HTTP layer does not implement request/response compression, sending full-size JSON payloads for chat history that can be several megabytes.

### Implementation

- Add gzip and brotli compression middleware to `t3code/apps/server/src/http.ts`
- Compress responses larger than 1KB when the client sends Accept-Encoding with gzip or br
- Prefer brotli over gzip when both are accepted
- Add Content-Encoding response header
- Skip compression for already-compressed content types like images and archives
- Decompress incoming request bodies when Content-Encoding is set

### Acceptance Criteria

- Responses over 1KB are compressed when client supports it
- Brotli is preferred over gzip when both 
────────────────────────────────────────────────────────────
🎯 CONSENSUS : WAIT  (100% confiance)
⚡ GODLIKE   : 0.000  💤 dormant

💡 INSIGHTS CLÉS :
  • **Isaac Newton** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Leonardo Fibonacci** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Pythagore** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Archimède** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Carl Friedrich Gauss** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
════════════════════════════════════════════════════════════

