import "../../index.css";

import type { LocalApi, PeerDiagnostics } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { TailscalePeerDiagnosticsSection } from "./TailscalePeerDiagnostics";

function makeDirectDiagnostics(overrides?: Partial<PeerDiagnostics>): PeerDiagnostics {
  return {
    peer: "runner-direct",
    hostName: "runner-direct",
    online: true,
    connectionType: "direct",
    peerIp: "100.64.0.5",
    directEndpoint: "198.51.100.7:41641",
    relay: null,
    latencyMs: 9,
    latencySamples: [12, 9, 11, 8, 10, 7, 9, 8, 10, 9],
    lastSeen: "2026-06-23T10:00:00Z",
    tailnetIpv4Addresses: ["100.64.0.50"],
    ...overrides,
  };
}

let mounted:
  | (Awaited<ReturnType<typeof render>> & {
      cleanup?: () => Promise<void>;
      unmount?: () => Promise<void>;
    })
  | null = null;

describe("TailscalePeerDiagnosticsSection", () => {
  beforeEach(async () => {
    await __resetLocalApiForTests();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    await __resetLocalApiForTests();
    vi.restoreAllMocks();
  });

  it("runs diagnostics for the selected runner and plots the latency graph", async () => {
    const diagnoseTailscalePeer = vi
      .fn<LocalApi["server"]["diagnoseTailscalePeer"]>()
      .mockResolvedValue(makeDirectDiagnostics());
    window.nativeApi = {
      server: { diagnoseTailscalePeer },
    } as unknown as LocalApi;

    mounted = await render(
      <AppAtomRegistryProvider>
        <TailscalePeerDiagnosticsSection />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Runner peer hostname or IP").fill("runner-direct");
    await page.getByRole("button", { name: "Run diagnostics" }).click();

    expect(diagnoseTailscalePeer).toHaveBeenCalledWith({ peer: "runner-direct", pingCount: 10 });

    await expect.element(page.getByText("Direct", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("100.64.0.5", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("198.51.100.7:41641")).toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Latency graph for the last 10 pings"))
      .toBeInTheDocument();
  });

  it("surfaces a diagnostics error without crashing", async () => {
    const diagnoseTailscalePeer = vi
      .fn<LocalApi["server"]["diagnoseTailscalePeer"]>()
      .mockRejectedValue(new Error("Tailscale peer not found: ghost"));
    window.nativeApi = {
      server: { diagnoseTailscalePeer },
    } as unknown as LocalApi;

    mounted = await render(
      <AppAtomRegistryProvider>
        <TailscalePeerDiagnosticsSection />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Runner peer hostname or IP").fill("ghost");
    await page.getByRole("button", { name: "Run diagnostics" }).click();

    await expect.element(page.getByText("Tailscale peer not found: ghost")).toBeInTheDocument();
  });
});
