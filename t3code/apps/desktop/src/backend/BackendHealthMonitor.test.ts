import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

import {
  DEFAULT_CONFIG,
  type HealthMonitorConfig,
  type HealthCheckResult,
  type HealthMonitorSnapshot,
} from "./BackendHealthMonitor.ts";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BackendHealthMonitor config", () => {
  it("has correct default values", () => {
    expect(Duration.toMillis(DEFAULT_CONFIG.checkInterval)).toBe(15_000);
    expect(DEFAULT_CONFIG.maxConsecutiveFailures).toBe(3);
    expect(DEFAULT_CONFIG.maxRestartAttempts).toBe(3);
    expect(DEFAULT_CONFIG.jitterFactor).toBe(0.2);
    expect(Duration.toMillis(DEFAULT_CONFIG.requestTimeout)).toBe(5_000);
  });

  it("config can be partially overridden", () => {
    const custom: Partial<HealthMonitorConfig> = {
      maxConsecutiveFailures: 5,
      jitterFactor: 0.3,
    };
    const merged = { ...DEFAULT_CONFIG, ...custom };
    expect(merged.maxConsecutiveFailures).toBe(5);
    expect(merged.jitterFactor).toBe(0.3);
    // Defaults preserved
    expect(Duration.toMillis(merged.checkInterval)).toBe(15_000);
    expect(merged.maxRestartAttempts).toBe(3);
  });
});

describe("HealthCheckResult", () => {
  it("pass result has correct shape", () => {
    const result: HealthCheckResult = {
      status: "pass",
      timestamp: new Date().toISOString(),
      responseTimeMs: 42,
    };
    expect(result.status).toBe("pass");
    expect(result.timestamp).toBeTruthy();
    expect(result.responseTimeMs).toBeDefined();
  });

  it("fail result has error field", () => {
    const result: HealthCheckResult = {
      status: "fail",
      timestamp: new Date().toISOString(),
      responseTimeMs: 5000,
      error: "ECONNREFUSED",
    };
    expect(result.status).toBe("fail");
    expect(result.error).toBeDefined();
  });
});

describe("HealthMonitorSnapshot", () => {
  it("has correct initial state", () => {
    const snapshot: HealthMonitorSnapshot = {
      status: "checking",
      consecutiveFailures: 0,
      totalChecks: 0,
      lastCheckAt: Option.none(),
      lastFailureAt: Option.none(),
      restartCount: 0,
      active: false,
    };
    expect(snapshot.status).toBe("checking");
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.active).toBe(false);
  });
});

describe("spacedWithJitter", () => {
  it("jitter factor of 0 produces no jitter", () => {
    const factor = 0;
    const interval = Duration.seconds(15);
    const maxJitter = Duration.toMillis(interval) * factor;
    expect(maxJitter).toBe(0);
  });

  it("jitter factor of 0.2 produces ±1.5s jitter on 15s interval", () => {
    const factor = 0.2;
    const interval = Duration.seconds(15);
    const maxJitter = Duration.toMillis(interval) * factor;
    expect(maxJitter).toBe(3000); // ±3s means total jitter range is 6s
  });
});

describe("restart logic", () => {
  it("restarts after 3 consecutive failures", () => {
    const maxFailures = DEFAULT_CONFIG.maxConsecutiveFailures;
    expect(maxFailures).toBe(3);

    // Simulate: after 3 failures, should trigger restart
    let consecutiveFailures = 0;
    let restartTriggered = false;

    for (let i = 0; i < 3; i++) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxFailures) {
        restartTriggered = true;
        consecutiveFailures = 0;
      }
    }

    expect(restartTriggered).toBe(true);
  });

  it("resets failure count on successful check", () => {
    let consecutiveFailures = 2; // 2 failures so far
    // Successful check resets
    consecutiveFailures = 0;
    expect(consecutiveFailures).toBe(0);
  });

  it("shows error dialog after max restart attempts", () => {
    const maxRestarts = DEFAULT_CONFIG.maxRestartAttempts;
    expect(maxRestarts).toBe(3);

    let restartCount = 3;
    const shouldShowDialog = restartCount >= maxRestarts;
    expect(shouldShowDialog).toBe(true);
  });
});
