import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { KeyRotationService, DefaultKeyRotationConfig } from "./KeyRotationService";

describe("KeyRotationService", () => {
  it("should default to 3 max key versions", () => {
    expect(DefaultKeyRotationConfig.maxKeyVersions).toBe(3);
  });

  it("should default to 90 day rotation", () => {
    expect(DefaultKeyRotationConfig.rotationIntervalDays).toBe(90);
  });

  it("should default to 7 day grace period", () => {
    expect(DefaultKeyRotationConfig.gracePeriodDays).toBe(7);
  });

  it("should export as an Effect", () => {
    expect(Effect.isEffect(KeyRotationService)).toBe(true);
  });
});
