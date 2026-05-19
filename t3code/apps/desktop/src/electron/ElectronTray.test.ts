import { describe, it, expect } from "vitest";
import { defaultTrayState } from "./ElectronTray";

describe("ElectronTray", () => {
  it("should default to disconnected status", () => {
    expect(defaultTrayState.connectionStatus).toBe("disconnected");
  });

  it("should start with empty recent projects", () => {
    expect(defaultTrayState.recentProjects).toEqual([]);
  });
});
