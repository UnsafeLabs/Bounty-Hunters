import { EventEmitter } from "node:events";
import type { DesktopBridge, DesktopDeepLink } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: Object.assign(new EventEmitter(), { send: vi.fn() }),
  };
});

import { contextBridge, ipcRenderer } from "electron";
import { DEEP_LINK_CHANNEL, DEEP_LINK_READY_CHANNEL } from "./ipc/channels.ts";
import "./preload.ts";

describe("deep-link preload bridge", () => {
  it("subscribes before signaling readiness, forwards only the payload, and cleans up", () => {
    const bridge = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0]![1] as DesktopBridge;
    const link: DesktopDeepLink = { type: "settings" };
    const events = ipcRenderer as unknown as EventEmitter;
    vi.mocked(ipcRenderer.send).mockImplementation((channel, ready) => {
      if (channel === DEEP_LINK_READY_CHANNEL && ready === true) {
        events.emit(DEEP_LINK_CHANNEL, { sender: "private Electron event" }, link);
      }
    });
    const listener = vi.fn();
    const unsubscribe = bridge.onDeepLink!(listener);
    expect(listener).toHaveBeenCalledExactlyOnceWith(link);
    unsubscribe();
    expect(ipcRenderer.send).toHaveBeenLastCalledWith(DEEP_LINK_READY_CHANNEL, false);
    events.emit(DEEP_LINK_CHANNEL, {}, link);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(events.listenerCount(DEEP_LINK_CHANNEL)).toBe(0);
  });
});
