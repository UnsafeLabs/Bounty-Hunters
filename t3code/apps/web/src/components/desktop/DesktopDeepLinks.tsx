import { useEffect, useEffectEvent, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { DesktopDeepLink } from "@t3tools/contracts";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { handleDesktopDeepLink } from "../../lib/desktopDeepLinks";
import { toastManager } from "../ui/toast";

export function DesktopDeepLinks() {
  const navigate = useNavigate();
  const { handleNewThread } = useNewThreadHandler();
  const queue = useRef(Promise.resolve());
  const handleLink = useEffectEvent((link: DesktopDeepLink) =>
    handleDesktopDeepLink(link, {
      openSettings: () => navigate({ to: "/settings" }),
      openThread: (ref) =>
        navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: ref.environmentId, threadId: ref.threadId },
        }),
      openProject: (ref) => handleNewThread(ref, { envMode: "local" }),
    }),
  );

  useEffect(
    () =>
      window.desktopBridge?.onDeepLink?.((link) => {
        queue.current = queue.current
          .then(() => handleLink(link))
          .catch((error: unknown) => {
            toastManager.add({
              type: "error",
              title: "Unable to open link",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            });
          });
      }),
    [],
  );

  return null;
}
