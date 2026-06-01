import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { DEFAULT_MODEL, ProviderInstanceId, type DesktopDeepLinkPayload } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { readEnvironmentApi } from "../environmentApi";
import { readPrimaryEnvironmentDescriptor, usePrimaryEnvironmentId } from "../environments/primary";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings } from "../hooks/useSettings";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { getLatestThreadForProject } from "../lib/threadSort";
import { newCommandId, newProjectId } from "../lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { buildThreadRouteParams } from "../threadRoutes";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

function showDeepLinkError(description: string): void {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Unable to open deep link",
      description,
    }),
  );
}

function getEnvironmentBrowsePlatform(os: string | null | undefined): string {
  if (os === "windows") {
    return "Win32";
  }
  if (os === "darwin") {
    return "MacIntel";
  }
  if (os === "linux") {
    return "Linux";
  }
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);
  const sidebarThreadSortOrder = useSettings((settings) => settings.sidebarThreadSortOrder);
  const { handleNewThread } = useHandleNewThread();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projectsInPrimaryEnvironment = useMemo(
    () =>
      primaryEnvironmentId
        ? projects.filter((project) => project.environmentId === primaryEnvironmentId)
        : [],
    [primaryEnvironmentId, projects],
  );
  const threadsByEnvironment = useMemo(() => {
    const nextThreads = new Map<string, Array<(typeof threads)[number]>>();
    for (const thread of threads) {
      const environmentThreads = nextThreads.get(thread.environmentId);
      if (environmentThreads) {
        environmentThreads.push(thread);
      } else {
        nextThreads.set(thread.environmentId, [thread]);
      }
    }
    return nextThreads;
  }, [threads]);
  const threadById = useMemo(
    () => new Map<string, (typeof threads)[number]>(threads.map((thread) => [thread.id, thread])),
    [threads],
  );

  const openProjectDeepLink = useCallback(
    async (rawPath: string) => {
      if (!primaryEnvironmentId) {
        showDeepLinkError("No local environment is available.");
        return;
      }

      const api = readEnvironmentApi(primaryEnvironmentId);
      if (!api) {
        showDeepLinkError("The local environment API is not available yet.");
        return;
      }

      const platform = getEnvironmentBrowsePlatform(
        readPrimaryEnvironmentDescriptor()?.platform.os ?? null,
      );
      if (isUnsupportedWindowsProjectPath(rawPath, platform)) {
        showDeepLinkError("Windows-style project paths are only supported on Windows.");
        return;
      }

      const cwd = resolveProjectPathForDispatch(rawPath);
      if (cwd.length === 0) {
        showDeepLinkError("Project path is empty.");
        return;
      }

      const existing = findProjectByPath(projectsInPrimaryEnvironment, cwd);
      if (existing) {
        const latestThread = getLatestThreadForProject(
          threadsByEnvironment.get(existing.environmentId) ?? [],
          existing.id,
          sidebarThreadSortOrder,
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

        await handleNewThread(scopeProjectRef(existing.environmentId, existing.id), {
          envMode: defaultThreadEnvMode,
        }).catch(() => undefined);
        return;
      }

      try {
        const projectId = newProjectId();
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
          createdAt: new Date().toISOString(),
        });
        await handleNewThread(scopeProjectRef(primaryEnvironmentId, projectId), {
          envMode: defaultThreadEnvMode,
        }).catch(() => undefined);
      } catch (error) {
        showDeepLinkError(error instanceof Error ? error.message : "Project could not be opened.");
      }
    },
    [
      defaultThreadEnvMode,
      handleNewThread,
      navigate,
      primaryEnvironmentId,
      projectsInPrimaryEnvironment,
      sidebarThreadSortOrder,
      threadsByEnvironment,
    ],
  );

  const handleDeepLink = useCallback(
    async (payload: DesktopDeepLinkPayload) => {
      if (payload.kind === "error") {
        showDeepLinkError(payload.message);
        return;
      }

      if (payload.kind === "settings") {
        await navigate({ to: "/settings" });
        return;
      }

      if (payload.kind === "chat-thread") {
        const thread = threadById.get(payload.threadId);
        if (!thread) {
          showDeepLinkError(`Thread ${payload.threadId} was not found.`);
          return;
        }
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
        });
        return;
      }

      await openProjectDeepLink(payload.path);
    },
    [navigate, openProjectDeepLink, threadById],
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
      void handleDeepLink(payload);
    });

    return () => {
      unsubscribe?.();
    };
  }, [handleDeepLink]);

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
