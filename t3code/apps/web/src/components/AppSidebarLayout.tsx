import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { type DesktopMenuAction, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useCallback, type ReactNode } from "react";

import { getLatestThreadForProject } from "../lib/threadSort";
import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { buildThreadRouteParams } from "../threadRoutes";
import { useSettings } from "../hooks/useSettings";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

type UseHandleNewThreadResult = ReturnType<typeof useHandleNewThread>;

function resolveMenuProjectRef(
  action: Extract<DesktopMenuAction, { kind: "open-project" }>,
  projects: ReturnType<typeof selectProjectsAcrossEnvironments>,
  defaultProjectRef: UseHandleNewThreadResult["defaultProjectRef"],
): ReturnType<typeof scopeProjectRef> | null {
  if (action.projectId === undefined) {
    return null;
  }

  const candidates = projects.filter((project) => {
    if (project.id !== action.projectId) return false;
    if (action.environmentId === undefined) return true;
    return project.environmentId === action.environmentId;
  });

  if (candidates.length === 0) {
    return null;
  }

  const firstCandidate = candidates[0];
  if (firstCandidate === undefined) {
    return null;
  }

  if (action.environmentId) {
    return scopeProjectRef(action.environmentId, action.projectId);
  }

  if (candidates.length === 1) {
    return scopeProjectRef(firstCandidate.environmentId, firstCandidate.id);
  }

  if (defaultProjectRef && defaultProjectRef.projectId === action.projectId) {
    return defaultProjectRef;
  }

  return scopeProjectRef(firstCandidate.environmentId, firstCandidate.id);
}

function getProjectThreads(
  threads: ReturnType<typeof selectSidebarThreadsAcrossEnvironments>,
  projectRef: ReturnType<typeof scopeProjectRef>,
) {
  return threads.filter(
    (thread) =>
      thread.environmentId === projectRef.environmentId &&
      thread.projectId === projectRef.projectId,
  );
}

function resolveThreadEnvironmentIdFromState(
  threadId: Parameters<typeof scopeThreadRef>[1],
  threads: ReturnType<typeof selectSidebarThreadsAcrossEnvironments>,
): EnvironmentId | null {
  const foundThread = threads.find((thread) => thread.id === threadId);
  return foundThread ? foundThread.environmentId : null;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const projects = useStore(selectProjectsAcrossEnvironments);
  const threads = useStore(selectSidebarThreadsAcrossEnvironments);
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();

  const openProject = useCallback(
    async (action: Extract<DesktopMenuAction, { kind: "open-project" }>) => {
      const projectRef = resolveMenuProjectRef(action, projects, defaultProjectRef);
      if (!projectRef) {
        return;
      }

      const projectThreads = getProjectThreads(threads, projectRef);
      const latestThread = getLatestThreadForProject(
        projectThreads,
        projectRef.projectId,
        settings.sidebarThreadSortOrder,
      );
      if (latestThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return;
      }

      await handleNewThread(projectRef, {
        envMode: settings.defaultThreadEnvMode,
        ...(action.path === undefined ? {} : { worktreePath: action.path }),
      });
    },
    [
      defaultProjectRef,
      handleNewThread,
      navigate,
      projects,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const openThread = useCallback(
    async (action: Extract<DesktopMenuAction, { kind: "open-thread" }>) => {
      if (!action.threadId) {
        return;
      }

      const environmentId = action.environmentId
        ? action.environmentId
        : resolveThreadEnvironmentIdFromState(action.threadId, threads);
      if (environmentId === null) {
        return;
      }

      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, action.threadId)),
      });
    },
    [navigate, threads],
  );

  const openSettings = useCallback(async () => {
    await navigate({ to: "/settings" });
  }, [navigate]);

  const handleMenuAction = useCallback(
    (action: DesktopMenuAction) => {
      switch (action.kind) {
        case "open-settings": {
          void openSettings();
          return;
        }
        case "open-project": {
          void openProject(action);
          return;
        }
        case "open-thread": {
          void openThread(action);
          return;
        }
      }
    },
    [openSettings, openProject, openThread],
  );

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
      handleMenuAction(action);
    });

    return () => {
      unsubscribe?.();
    };
  }, [handleMenuAction]);

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
