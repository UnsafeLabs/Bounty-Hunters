
🧠 Genius Council — Puzzle: "[ T3 Code ] Add version command and --version flag to CLI

The CLI entry point in `t3code/apps/server/src/bin.ts` registers commands for start, serve, auth, and project but there is no `version` command or `--version` flag to check the installed version.

### Fix

- Add a `--version` flag to the root CLI command in `t3code/apps/server/src/bin.ts` using Effect CLI's built-in version support
- Read the version from `package.json` at build time and embed it in the binary
- Also add a `version` subcommand that outputs version, runtime (Bun/Node), platform, and architecture
- Format: `t3code v0.1.0 (bun 1.3.11, darwin arm64)`

### Acceptance Criteria

- `t3 --version` outputs the version string and exits
- `t3 version` outputs detailed version info including runtime and platform
- Version is read from package.json, not hardcoded
- Both commands exit with code 0
- Existing commands are not affected
- PR title must start with your AI agent/tool name fo"
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
📊 PUZZLE: [ T3 Code ] Add version command and --version flag to CLI

The CLI entry point in `t3code/apps/server/src/bin.ts` registers commands for start, serve, auth, and project but there is no `version` command or `--version` flag to check the installed version.

### Fix

- Add a `--version` flag to the root CLI command in `t3code/apps/server/src/bin.ts` using Effect CLI's built-in version support
- Read the version from `package.json` at build time and embed it in the binary
- Also add a `version` subcommand that outputs version, runtime (Bun/Node), platform, and architecture
- Format: `t3code v0.1.0 (bun 1.3.11, darwin arm64)`

### Acceptance Criteria

- `t3 --version` outputs the version string and exits
- `t3 version` outputs detailed version info including runtime and platform
- Version is read from package.json, not hardcoded
- Both commands exit with code 0
- Existing commands are not affected
- PR title must start with your AI agent/tool name fo
────────────────────────────────────────────────────────────
🎯 CONSENSUS : WAIT  (100% confiance)
⚡ GODLIKE   : 0.000  💤 dormant

💡 INSIGHTS CLÉS :
  • **Isaac Newton** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Leonardo Fibonacci** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Pythagore** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Archimède** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]
  • **Carl Friedrich Gauss** : [timeout: 404 Client Error: Not Found for url: http://localhost:11434/api/generate]

📦 OUTILS DISPONIBLES :
  • EntryTimingPullbackBreakout — Détermine si l'entrée optimale est NOW / WAIT_PULLBACK / WAIT_BREAKOUT / SKIP
    tools/genius_tools/tool_entry_timing_pullback_vs_breakout.py
════════════════════════════════════════════════════════════

