import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import ThreadSidebar from "./Sidebar";
import { toastManager } from "./ui/toast";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { useCommandPaletteStore } from "../commandPaletteStore";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { useStore } from "../store";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowKeyUp = (event: KeyboardEvent) => {
      syncShortcutModifierStateFromKeyboardEvent(event);
    };
    const onWindowBlur = () => {
      clearShortcutModifierState();
    };

    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("keyup", onWindowKeyUp, true);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("keyup", onWindowKeyUp, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        void navigate({ to: "/settings" });
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  useEffect(() => {
    const onDeepLink = window.desktopBridge?.onDeepLink;
    if (typeof onDeepLink !== "function") {
      return;
    }

    const unsubscribe = onDeepLink((payload) => {
      if (payload.kind === "settings") {
        void navigate({ to: "/settings" });
        return;
      }
      if (payload.kind === "open-project") {
        openAddProject(payload.path);
        return;
      }
      if (payload.kind === "chat-thread") {
        const threadId = ThreadId.make(payload.threadId);
        const state = useStore.getState();
        for (const [rawEnvironmentId, environmentState] of Object.entries(
          state.environmentStateById,
        )) {
          if (environmentState.threadIds.includes(threadId)) {
            const environmentId = EnvironmentId.make(rawEnvironmentId);
            void navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId },
            });
            return;
          }
        }
        toastManager.add({
          type: "error",
          title: "Unable to open deep link",
          description: `Thread ${payload.threadId} was not found.`,
        });
        return;
      }
      toastManager.add({
        type: "error",
        title: "Unable to open deep link",
        description: payload.message,
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, openAddProject]);

  return (
    <SidebarProvider className="h-dvh! min-h-0!" defaultOpen>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
