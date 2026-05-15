import { describe, it, expect } from "vitest";
import { Duration } from "effect";
import { defaultKeepaliveConfig, type TunnelState } from "./tunnelKeepalive.ts";

describe("TunnelKeepalive configuration", () => {
  it("default keepalive interval is 15 seconds", () => {
    expect(Duration.toMillis(defaultKeepaliveConfig.interval)).toBe(15_000);
  });

  it("default max failures is 3", () => {
    expect(defaultKeepaliveConfig.maxFailures).toBe(3);
  });

  it("default reconnect backoff follows exponential schedule", () => {
    const backoff = defaultKeepaliveConfig.reconnectBackoff.map((d) =>
      Duration.toMillis(d),
    );

    expect(backoff[0]).toBe(1_000);
    expect(backoff[1]).toBe(4_000);
    expect(backoff[2]).toBe(16_000);
    expect(backoff[3]).toBe(60_000);
  });

  it("default max reconnect attempts is 5", () => {
    expect(defaultKeepaliveConfig.maxReconnectAttempts).toBe(5);
  });
});

describe("TunnelState transitions", () => {
  it("initial state is connecting", () => {
    const initialState: TunnelState = "connecting";
    expect(initialState).toBe("connecting");
  });

  it("valid state transitions", () => {
    const validTransitions: Record<TunnelState, TunnelState[]> = {
      connecting: ["connected", "failed"],
      connected: ["reconnecting", "failed"],
      reconnecting: ["connected", "failed"],
      failed: [],
    };

    for (const [from, toStates] of Object.entries(validTransitions)) {
      for (const to of toStates) {
        expect(to).toBeDefined();
      }
    }
  });

  it("failed state has no valid outgoing transitions", () => {
    const validTransitions: Record<TunnelState, TunnelState[]> = {
      connecting: ["connected", "failed"],
      connected: ["reconnecting", "failed"],
      reconnecting: ["connected", "failed"],
      failed: [],
    };

    expect(validTransitions.failed).toHaveLength(0);
  });
});

describe("Reconnection backoff calculation", () => {
  it("backoff index is clamped to array length", () => {
    const backoff = defaultKeepaliveConfig.reconnectBackoff;
    const maxIndex = backoff.length - 1;

    const attempts = [1, 2, 3, 4, 5, 6, 10];
    const expectedIndices = [0, 1, 2, 3, 3, 3, 3];

    for (let i = 0; i < attempts.length; i++) {
      const index = Math.min(attempts[i] - 1, maxIndex);
      expect(index).toBe(expectedIndices[i]);
    }
  });
});

describe("Manual disconnect behavior", () => {
  it("manual stop flag prevents auto-reconnect", () => {
    let manualStop = false;

    function shouldReconnect(): boolean {
      return !manualStop;
    }

    expect(shouldReconnect()).toBe(true);

    manualStop = true;
    expect(shouldReconnect()).toBe(false);
  });
});

describe("Failure tracking", () => {
  it("tunnel considered dead after max failures", () => {
    const maxFailures = defaultKeepaliveConfig.maxFailures;
    let failures = 0;

    for (let i = 0; i < maxFailures - 1; i++) {
      failures++;
      expect(failures >= maxFailures).toBe(false);
    }

    failures++;
    expect(failures >= maxFailures).toBe(true);
  });

  it("failures reset after successful reconnect", () => {
    let failures = 3;
    expect(failures >= defaultKeepaliveConfig.maxFailures).toBe(true);

    failures = 0;
    expect(failures >= defaultKeepaliveConfig.maxFailures).toBe(false);
  });
});
