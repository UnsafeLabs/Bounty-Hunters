import {
  diagnosePeer,
  parsePingOutput,
  parseStatusForPeer,
  pushLatencyHistory,
} from "./PeerDiagnostics.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

// Direct ping parse
const direct = parsePingOutput(
  "pong from 100.64.0.2 via direct in 12.5ms\npong from 100.64.0.2 via direct in 11.0ms\n",
);
assert(direct.connectionType === "direct", "direct");
assert(direct.latencies.length === 2, "2 samples");
assert(direct.peerIp === "100.64.0.2", "ip");

// Relayed
const relay = parsePingOutput("pong from peer via DERP(nyc) in 45ms\n");
assert(relay.connectionType === "relayed", "relayed");
assert(relay.derpServer === "nyc", "derp");

// Status
const st = parseStatusForPeer(
  "100.64.0.2 peer-host active; relay nyc; last seen 2s ago\n",
  "peer-host",
);
assert(st.online === true, "online");
assert(st.derpRegion === "nyc", "region");
assert(st.lastSeen?.includes("2s") === true, "last seen");

// Latency history max 10
let h: number[] = [];
for (let i = 0; i < 15; i++) h = pushLatencyHistory(h, i, 10);
assert(h.length === 10 && h[0] === 5 && h[9] === 14, "history window");

// Mock diagnose
const diag = await diagnosePeer("alice", {
  runCommand: async (args) => {
    if (args[0] === "status") {
      return {
        stdout: "100.64.1.1 alice active; relay sea; last seen 1s ago\n",
        stderr: "",
        code: 0,
      };
    }
    return {
      stdout: "pong from 100.64.1.1 via direct in 8ms\npong from 100.64.1.1 via direct in 9ms\n",
      stderr: "",
      code: 0,
    };
  },
});
assert(diag.connectionType === "direct", "diag direct");
assert(diag.latencyHistory.length === 2, "history");
assert(diag.latencyMs !== null && diag.latencyMs! > 0, "avg latency");
assert(diag.error === null, "no error");

// Not installed
const missing = await diagnosePeer("bob", {
  runCommand: async () => {
    throw new Error("ENOENT: tailscale not found");
  },
});
assert(missing.error?.includes("not installed") === true, "missing cli");

// Unknown peer / failed ping
const fail = await diagnosePeer("ghost", {
  runCommand: async (args) => {
    if (args[0] === "status") return { stdout: "", stderr: "", code: 0 };
    return { stdout: "", stderr: "no such host", code: 1 };
  },
});
assert(fail.error !== null || fail.latencyMs === null, "failed peer handled");

console.log("PeerDiagnostics tests: all passed");
