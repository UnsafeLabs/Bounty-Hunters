import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { DesktopBackendConnectionState } from "@t3tools/contracts";
import {
  desktopBackendConnectionQueryKeys,
  desktopBackendConnectionStateQueryOptions,
  setDesktopBackendConnectionStateQueryData,
} from "./desktopBackendConnectionReactQuery";

describe("desktopBackendConnectionStateQueryOptions", () => {
  it("always refetches on mount so the UI does not reuse a stale backend connection state", () => {
    const options = desktopBackendConnectionStateQueryOptions();

    expect(options.staleTime).toBe(Infinity);
    expect(options.refetchOnMount).toBe("always");
  });
});

describe("setDesktopBackendConnectionStateQueryData", () => {
  it("writes the backend connection state into the shared cache key", () => {
    const queryClient = new QueryClient();
    const nextState: DesktopBackendConnectionState = "reconnecting";

    setDesktopBackendConnectionStateQueryData(queryClient, nextState);

    expect(queryClient.getQueryData(desktopBackendConnectionQueryKeys.state())).toBe(nextState);
  });
});
