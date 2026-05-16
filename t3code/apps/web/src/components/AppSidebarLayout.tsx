import {
  DESKTOP_TRAY_NEW_CHAT_ACTION,
  decodeDesktopTrayOpenProjectAction,
  type DesktopTrayConnectionStatus,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import ThreadSidebar from "./Sidebar";
import { Sidebar, SidebarProvider, SidebarRail } from "./ui/sidebar";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import {
  clearShortcutModifierState,
  syncShortcutModifierStateFromKeyboardEvent,
} from "../shortcutModifierState";
import { selectEnvironmentState, selectProjectsAcrossEnvironments, useStore } from "../store";

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;
export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const openAddProject = useCommandPaletteStore((state) => state.openAddProject);
  const projects = useStore(selectProjectsAcrossEnvironments);
  const connectionStatus = useStore((state): DesktopTrayConnectionStatus => {
    if (!state.activeEnvironmentId) {
      return "disconnected";
    }
    return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete
      ? "connected"
      : "reconnecting";
  });

  useEffect(() => {
    const setTrayState = window.desktopBridge?.setTrayState;
    if (typeof setTrayState !== "function") {
      return;
    }

    const activeProject =
      projects.find((project) =>
        activeThread
          ? project.environmentId === activeThread.environmentId &&
            project.id === activeThread.projectId
          : activeDraftThread
            ? project.environmentId === activeDraftThread.environmentId &&
              project.id === activeDraftThread.projectId
            : false,
      ) ?? null;

    void setTrayState({
      connectionStatus,
      activeProject: activeProject
        ? {
            environmentId: activeProject.environmentId,
            id: activeProject.id,
            name: activeProject.name,
            cwd: activeProject.cwd,
          }
        : null,
      recentProjects: [...projects]
        .sort((left, right) => {
          const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "");
          const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "");
          return (
            (Number.isFinite(rightTime) ? rightTime : 0) -
            (Number.isFinite(leftTime) ? leftTime : 0)
          );
        })
        .slice(0, 5)
        .map((project) => ({
          environmentId: project.environmentId,
          id: project.id,
          name: project.name,
          cwd: project.cwd,
        })),
    }).catch(() => undefined);
  }, [activeDraftThread, activeThread, connectionStatus, projects]);

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
        return;
      }
      if (action === DESKTOP_TRAY_NEW_CHAT_ACTION) {
        if (defaultProjectRef) {
          void handleNewThread(defaultProjectRef);
        } else {
          void navigate({ to: "/" });
        }
        return;
      }
      const projectAction = decodeDesktopTrayOpenProjectAction(action);
      if (projectAction) {
        const project = projects.find(
          (candidate) =>
            candidate.environmentId === projectAction.environmentId &&
            candidate.id === projectAction.projectId,
        );
        if (project) {
          void handleNewThread(scopeProjectRef(project.environmentId, project.id));
        } else {
          void navigate({ to: "/" });
          openAddProject();
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [defaultProjectRef, handleNewThread, navigate, openAddProject, projects]);

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
