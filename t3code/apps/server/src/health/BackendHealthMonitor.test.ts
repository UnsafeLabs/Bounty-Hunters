import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { BackendHealthMonitor } from "./BackendHealthMonitor";

describe("BackendHealthMonitor", () => {
  it("should export as an Effect", () => {
    expect(Effect.isEffect(BackendHealthMonitor)).toBe(true);
  });
});
