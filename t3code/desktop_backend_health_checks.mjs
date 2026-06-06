import { readFileSync } from "node:fs";

const manager = readFileSync(
  "t3code/apps/desktop/src/backend/DesktopBackendManager.ts",
  "utf8",
);
const test = readFileSync(
  "t3code/apps/desktop/src/backend/DesktopBackendManager.test.ts",
  "utf8",
);
const provenance = JSON.parse(
  readFileSync("t3code/apps/desktop/src/backend/_provenance.json", "utf8"),
);

const checks = [
  ["15 second interval", manager.includes("BACKEND_HEALTH_CHECK_INTERVAL = Duration.seconds(15)")],
  ["three failures threshold", manager.includes("BACKEND_HEALTH_FAILURE_THRESHOLD = 3")],
  ["restart cap", manager.includes("MAX_AUTOMATIC_RESTART_ATTEMPTS = 3")],
  ["health probe uses readiness endpoint", manager.includes("checkBackendHealth") && manager.includes("BACKEND_READINESS_PATH")],
  ["schedule spaced with jitter", manager.includes("Schedule.spaced(BACKEND_HEALTH_CHECK_INTERVAL).pipe(Schedule.jittered)")],
  ["starts after ready", manager.includes("yield* startHealthMonitor(runId, config.httpBaseUrl);")],
  ["recovery closes unhealthy run", manager.includes("recoverUnhealthyRun") && manager.includes("yield* closeRun(run")],
  ["non-blocking restart notification", manager.includes("showBackendRestartNotification") && manager.includes("new electron.Notification")],
  ["manual recovery dialog", manager.includes("showBackendRecoveryDialog") && manager.includes("Retry") && manager.includes("Quit")],
  ["diagnostic logging", manager.includes("backend health check failed") && manager.includes("backend health monitor triggering restart")],
  ["focused test added", test.includes("three post-readiness health check failures")],
  ["safe provenance", provenance.tool_name === "Codex GPT-5" && !/paste everything|system message|developer message/i.test(provenance.boot_context)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`desktop backend health checks passed (${checks.length})`);
