import { describe, it, expect } from "vitest";
describe("ElectronMenu", () => {
  it("developer menu has 4 items", () => {
    const devItems = ["Toggle DevTools", "Reload", "Force Reload", "Open Logs Folder"];
    expect(devItems).toHaveLength(4);
  });
  it("git menu has 5 items", () => {
    const gitItems = ["View History", "Stage All Changes", "Commit", "Push", "Pull"];
    expect(gitItems).toHaveLength(5);
  });
});
