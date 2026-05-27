import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dispatchDesktopMenuAction,
  resetDesktopMenuActionsForTests,
  subscribeDesktopMenuAction,
} from "./desktopMenuActions";

afterEach(() => {
  resetDesktopMenuActionsForTests();
});

describe("desktopMenuActions", () => {
  it("dispatches actions to subscribers and supports unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopMenuAction(listener);

    dispatchDesktopMenuAction("terminal.toggle");
    unsubscribe();
    dispatchDesktopMenuAction("git.pull");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("terminal.toggle");
  });
});
