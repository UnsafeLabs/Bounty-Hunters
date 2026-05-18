import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { ElectronTray, defaultTrayState } from "./ElectronTray";

describe("ElectronTray", () => {
  const mockCallbacks = {
    onShowWindow: Effect.void,
    onHideWindow: Effect.void,
    onNewChat: Effect.void,
    onOpenRecent: (_projectName: string) => Effect.void,
    onQuit: Effect.void,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should default to disconnected status", () => {
    expect(defaultTrayState.connectionStatus).toBe("disconnected");
    expect(defaultTrayState.recentProjects).toEqual([]);
  });

  it("should allow adding recent projects", async () => {
    const state = await Ref.make(defaultTrayState);
    await Ref.update(state, (s) => ({
      ...s,
      recentProjects: ["project-a", ...s.recentProjects].slice(0, 5),
    })).pipe(Effect.runPromise);

    const result = await Ref.get(state).pipe(Effect.runPromise);
    expect(result.recentProjects).toContain("project-a");
  });

  it("should limit recent projects to 5", async () => {
    const state = await Ref.make(defaultTrayState);
    const projects = ["p1", "p2", "p3", "p4", "p5", "p6"];
    
    for (const p of projects) {
      await Ref.update(state, (s) => ({
        ...s,
        recentProjects: [p, ...s.recentProjects.filter((x) => x !== p)].slice(0, 5),
      })).pipe(Effect.runPromise);
    }

    const result = await Ref.get(state).pipe(Effect.runPromise);
    expect(result.recentProjects).toHaveLength(5);
    expect(result.recentProjects[0]).toBe("p6");
  });

  it("should update connection status", async () => {
    const state = await Ref.make(defaultTrayState);
    await Ref.update(state, (s) => ({ ...s, connectionStatus: "reconnecting" })).pipe(
      Effect.runPromise,
    );
    const result = await Ref.get(state).pipe(Effect.runPromise);
    expect(result.connectionStatus).toBe("reconnecting");
  });
});
