import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { SnapshotPruningService, DefaultPruningConfig } from "./SnapshotPruningService";

describe("SnapshotPruningService", () => {
  it("should have default retention of 7 days", () => {
    expect(DefaultPruningConfig.retentionDays).toBe(7);
  });

  it("should keep minimum 3 snapshots per session", () => {
    expect(DefaultPruningConfig.keepMinimum).toBe(3);
  });

  it("should export pruning service as an Effect", () => {
    expect(Effect.isEffect(SnapshotPruningService)).toBe(true);
  });
});
