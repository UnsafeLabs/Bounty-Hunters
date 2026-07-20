import {
  PrometheusRegistry,
  handleMetricsRequest,
  metricsAuthAllowed,
} from "./PrometheusMetrics.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const r = new PrometheusRegistry();
r.setActiveSessions(3);
r.incRpc("chat.send", 0.02);
r.incRpc("chat.send", 0.2);
r.incGit("push");
r.setMemory(1024);

const text = r.toExposition();
assert(text.includes("active_sessions 3"), "sessions");
assert(text.includes('rpc_requests_total{method="chat.send"} 2'), "counter");
assert(text.includes("rpc_duration_seconds_count 2"), "hist count");
assert(text.includes('git_operations_total{operation="push"} 1'), "git");
assert(text.includes("memory_usage_bytes 1024"), "mem");
assert(text.includes("# TYPE"), "types");

assert(metricsAuthAllowed(undefined, { METRICS_AUTH_DISABLED: "true" }) === true, "auth off");
assert(metricsAuthAllowed("Bearer secret", { METRICS_TOKEN: "secret" }) === true, "bearer ok");
assert(metricsAuthAllowed("Bearer wrong", { METRICS_TOKEN: "secret" }) === false, "bearer bad");

const res = handleMetricsRequest({ registry: r, env: { METRICS_AUTH_DISABLED: "true" } });
assert(res.status === 200 && res.body.includes("active_sessions"), "handler");

console.log("PrometheusMetrics tests: all passed");
