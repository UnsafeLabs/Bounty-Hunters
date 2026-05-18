import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { SessionManager, DefaultSessionPolicy } from "./SessionManager";

describe("SessionManager", () => {
  it("should have default policy of max 5 sessions", () => {
    expect(DefaultSessionPolicy.maxSessionsPerUser).toBe(5);
  });

  it("should have default 60 min timeout", () => {
    expect(DefaultSessionPolicy.sessionTimeoutMinutes).toBe(60);
  });

  it("should have default max 3 devices", () => {
    expect(DefaultSessionPolicy.maxDevicesPerUser).toBe(3);
  });

  it("should export SessionManager as an Effect", () => {
    expect(Effect.isEffect(SessionManager)).toBe(true);
  });
});
