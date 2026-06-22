import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DesktopBackendConnectionState } from "@t3tools/contracts";

export const desktopBackendConnectionQueryKeys = {
  all: ["desktop", "backend-connection"] as const,
  state: () => ["desktop", "backend-connection", "state"] as const,
};

export const setDesktopBackendConnectionStateQueryData = (
  queryClient: QueryClient,
  state: DesktopBackendConnectionState | null,
) => queryClient.setQueryData(desktopBackendConnectionQueryKeys.state(), state);

export function desktopBackendConnectionStateQueryOptions() {
  return queryOptions({
    queryKey: desktopBackendConnectionQueryKeys.state(),
    queryFn: async () => {
      const bridge = window.desktopBridge;
      if (!bridge || typeof bridge.getBackendConnectionState !== "function") return null;
      return bridge.getBackendConnectionState();
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useDesktopBackendConnectionState() {
  const queryClient = useQueryClient();
  const query = useQuery(desktopBackendConnectionStateQueryOptions());

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge || typeof bridge.onBackendConnectionState !== "function") return;

    return bridge.onBackendConnectionState((nextState) => {
      setDesktopBackendConnectionStateQueryData(queryClient, nextState);
    });
  }, [queryClient]);

  return query;
}
