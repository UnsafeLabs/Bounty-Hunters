import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { AskpassHandler, DefaultAskpassConfig } from "./AskpassHandler";

describe("AskpassHandler", () => {
  it("should default to IPC channel mode", () => {
    expect(DefaultAskpassConfig.useIpcChannel).toBe(true);
  });

  it("should scrub passwords after use by default", () => {
    expect(DefaultAskpassConfig.scrubAfterUse).toBe(true);
  });

  it("should have 30s timeout", () => {
    expect(DefaultAskpassConfig.timeoutMs).toBe(30000);
  });

  it("should export AskpassHandler as an Effect", () => {
    expect(Effect.isEffect(AskpassHandler)).toBe(true);
  });
});
