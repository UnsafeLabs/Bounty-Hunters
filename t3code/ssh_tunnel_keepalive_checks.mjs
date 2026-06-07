import { readFileSync } from "node:fs";

const tunnel = readFileSync("t3code/packages/ssh/src/tunnel.ts", "utf8");
const meta = JSON.parse(readFileSync("t3code/packages/ssh/src/contributor_meta.json", "utf8"));

const checks = [
  ["server alive interval", tunnel.includes('"ServerAliveInterval=15"')],
  ["server alive count max", tunnel.includes('"ServerAliveCountMax=3"')],
  ["health interval", tunnel.includes("TUNNEL_HEALTH_INTERVAL_MS = 15_000")],
  ["tcp health probe", tunnel.includes("probeLocalTcpPort") && tunnel.includes("NodeNet.createConnection") && tunnel.includes("input.entry.localPort")],
  ["max reconnect attempts", tunnel.includes("TUNNEL_MAX_RECONNECT_ATTEMPTS = 5")],
  ["backoff schedule", tunnel.includes("[1_000, 4_000, 16_000, 60_000]")],
  ["state type", tunnel.includes('export type SshTunnelState') && tunnel.includes('"reconnecting"') && tunnel.includes('"failed"')],
  ["event stream exposed", tunnel.includes("tunnelEvents: Stream.fromPubSub(tunnelEvents)")],
  ["state reader exposed", tunnel.includes("readonly tunnelState") && tunnel.includes("Effect.fn(\"ssh/tunnel.state.read\"")],
  ["connecting emitted", tunnel.includes('state: "connecting"')],
  ["connected emitted", tunnel.includes('state: "connected"')],
  ["reconnecting emitted", tunnel.includes('state: "reconnecting"')],
  ["failed emitted", tunnel.includes('state: "failed"')],
  ["manual disconnect guard", tunnel.includes("manualDisconnect") && tunnel.includes("manual disconnect")],
  ["health monitor forks", tunnel.includes("startTunnelHealthMonitor") && tunnel.includes("Effect.forkIn(monitor, managerScope)")],
  ["safe metadata", meta.name === "Codex GPT-5" && !/paste everything|system message|developer message/i.test(meta.session_init)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`ssh tunnel keepalive checks passed (${checks.length})`);
