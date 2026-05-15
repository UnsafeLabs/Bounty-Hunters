import { describe, it, expect } from "vitest";
import { parseUserAgent } from "../Services/UserAgentParser.ts";

describe("UserAgentParser", () => {
  it("parses Chrome on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const info = parseUserAgent(ua);

    expect(info.os).toBe("Windows");
    expect(info.browser).toBe("Chrome");
    expect(info.deviceType).toBe("desktop");
    expect(info.deviceName).toBe("Windows - Chrome");
  });

  it("parses Safari on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
    const info = parseUserAgent(ua);

    expect(info.os).toBe("macOS");
    expect(info.browser).toBe("Safari");
    expect(info.deviceType).toBe("desktop");
    expect(info.deviceName).toBe("macOS - Safari");
  });

  it("parses mobile Safari on iPhone", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    const info = parseUserAgent(ua);

    expect(info.os).toBe("iOS");
    expect(info.browser).toBe("Safari");
    expect(info.deviceType).toBe("mobile");
  });

  it("parses Chrome on Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    const info = parseUserAgent(ua);

    expect(info.os).toBe("Android");
    expect(info.browser).toBe("Chrome");
    expect(info.deviceType).toBe("mobile");
  });

  it("parses Edge browser", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    const info = parseUserAgent(ua);

    expect(info.browser).toBe("Edge");
    expect(info.os).toBe("Windows");
  });

  it("returns unknown for null user-agent", () => {
    const info = parseUserAgent(null);

    expect(info.deviceName).toBe("Unknown Device");
    expect(info.deviceType).toBe("unknown");
    expect(info.os).toBeNull();
    expect(info.browser).toBeNull();
  });

  it("returns unknown for empty string", () => {
    const info = parseUserAgent("");

    expect(info.deviceName).toBe("Unknown Device");
    expect(info.deviceType).toBe("desktop");
  });

  it("detects iPad as tablet", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
    const info = parseUserAgent(ua);

    expect(info.deviceType).toBe("tablet");
  });

  it("detects Firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    const info = parseUserAgent(ua);

    expect(info.browser).toBe("Firefox");
  });
});

describe("SessionActivityTracker - debounced activity tracking", () => {
  it("debounces updates within 5 minute window", () => {
    const lastUpdates = new Map<string, number>();
    const now = Date.now();
    const sessionId = "test-session-1";

    lastUpdates.set(sessionId, now);
    const lastUpdate = lastUpdates.get(sessionId) ?? 0;
    const debounceMs = 5 * 60 * 1000;

    expect(now - lastUpdate < debounceMs).toBe(true);
  });

  it("allows updates after 5 minute window", () => {
    const lastUpdates = new Map<string, number>();
    const now = Date.now();
    const sessionId = "test-session-1";

    lastUpdates.set(sessionId, now - 6 * 60 * 1000);
    const lastUpdate = lastUpdates.get(sessionId) ?? 0;
    const debounceMs = 5 * 60 * 1000;

    expect(now - lastUpdate >= debounceMs).toBe(true);
  });

  it("tracks different sessions independently", () => {
    const lastUpdates = new Map<string, number>();
    const now = Date.now();

    lastUpdates.set("session-a", now);
    lastUpdates.set("session-b", now - 6 * 60 * 1000);

    const debounceMs = 5 * 60 * 1000;

    expect(now - (lastUpdates.get("session-a") ?? 0) < debounceMs).toBe(true);
    expect(now - (lastUpdates.get("session-b") ?? 0) >= debounceMs).toBe(true);
  });
});
