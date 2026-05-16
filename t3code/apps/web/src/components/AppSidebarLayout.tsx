import { useEffect, type ReactNode } from "react";
import {
  DEFAULT_MODEL,
  ProviderInstanceId,
  type DesktopDeepLinkPayload,
  type EnvironmentId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { readEnvironmentApi } from "../environmentApi";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/projectPaths";
import { newCommandId, newProjectId } from "../lib/utils";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
type ChatThreadDeepLinkPayload = Extract<DesktopDeepLinkPayload, { type: "chat-thread" }>;

function showDeepLinkError(description: string) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Could not open T3 Code link",
      description,
    }),
  );
}

function resolveEnvironmentForProjectOpen(): EnvironmentId | null {
  const state = useStore.getState();
  if (state.activeEnvironmentId && readEnvironmentApi(state.activeEnvironmentId)) {
    return state.activeEnvironmentId;
  }

  for (const project of selectProjectsAcrossEnvironments(state)) {
    if (readEnvironmentApi(project.environmentId)) {
      return project.environmentId;
    }
  }

  return null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();

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

    const openProject = async (path: string) => {
      const state = useStore.getState();
      const existingProject = findProjectByPath(selectProjectsAcrossEnvironments(state), path);
      if (existingProject) {
        await handleNewThread(scopeProjectRef(existingProject.environmentId, existingProject.id), {
          envMode: "local",
        });
        return;
      }

      const environmentId = resolveEnvironmentForProjectOpen();
      if (!environmentId) {
        showDeepLinkError("No connected environment is available to open this project.");
        return;
      }

      const api = readEnvironmentApi(environmentId);
      if (!api) {
        showDeepLinkError("The selected environment is not connected.");
        return;
      }

      const projectId = newProjectId();
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title: inferProjectTitleFromPath(path),
        workspaceRoot: path,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        createdAt: new Date().toISOString(),
      });
      await handleNewThread(scopeProjectRef(environmentId, projectId), { envMode: "local" });
    };

    const openChatThread = (threadLink: ChatThreadDeepLinkPayload) => {
      const state = useStore.getState();
      for (const [environmentId, environmentState] of Object.entries(state.environmentStateById)) {
        if (environmentState.threadShellById[threadLink.threadId]) {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(environmentId as EnvironmentId, threadLink.threadId),
            ),
          });
          return;
        }
      }
      showDeepLinkError("The requested chat thread was not found.");
    };

    const unsubscribe = onDeepLink((payload) => {
      if (payload.type === "settings") {
        void navigate({ to: "/settings" });
        return;
      }
      if (payload.type === "chat-thread") {
        openChatThread(payload);
        return;
      }
      if (payload.type === "open-project") {
        void openProject(payload.path).catch((error) => {
          showDeepLinkError(error instanceof Error ? error.message : "An error occurred.");
        });
        return;
      }
      showDeepLinkError(payload.message);
    });

    return () => {
      unsubscribe?.();
    };
  }, [handleNewThread, navigate]);

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
