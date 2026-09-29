import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import {
  DEFAULT_MODEL,
  ProviderInstanceId,
  type DesktopDeepLink,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { readEnvironmentApi } from "../environmentApi";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { findProjectByPath, inferProjectTitleFromPath } from "./projectPaths";
import { newCommandId, newProjectId } from "./utils";

export interface DeepLinkNavigation {
  openSettings: () => Promise<void>;
  openThread: (ref: ScopedThreadRef) => Promise<void>;
  openProject: (ref: ScopedProjectRef) => Promise<void>;
}

export async function handleDesktopDeepLink(link: DesktopDeepLink, navigation: DeepLinkNavigation) {
  if (link.type === "error") throw new Error(link.message);
  if (link.type === "settings") return navigation.openSettings();

  // External links always refer to this desktop's local backend, even when a
  // remote environment is currently selected in the UI.
  const connection = getPrimaryEnvironmentConnection();
  await connection.ensureBootstrapped();
  const environmentId = connection.environmentId;
  const state = useStore.getState();
  const threads = selectSidebarThreadsAcrossEnvironments(state).filter(
    (thread) => thread.environmentId === environmentId,
  );
  if (link.type === "thread") {
    const thread = threads.find((candidate) => candidate.id === link.id);
    if (!thread) throw new Error("The linked chat thread could not be found on this desktop.");
    return navigation.openThread(scopeThreadRef(environmentId, thread.id));
  }

  const projects = selectProjectsAcrossEnvironments(state).filter(
    (project) => project.environmentId === environmentId,
  );
  const existing = findProjectByPath(projects, link.path);
  const projectId = existing?.id ?? newProjectId();
  if (!existing) {
    const api = readEnvironmentApi(environmentId);
    if (!api) throw new Error("The local environment is unavailable.");
    await api.orchestration.dispatchCommand({
      type: "project.create",
      commandId: newCommandId(),
      projectId,
      title: inferProjectTitleFromPath(link.path),
      workspaceRoot: link.path,
      createWorkspaceRootIfMissing: false,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: DEFAULT_MODEL },
      createdAt: new Date().toISOString(),
    });
  }
  const thread = threads
    .filter((candidate) => candidate.projectId === projectId && !candidate.archivedAt)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (thread) return navigation.openThread(scopeThreadRef(environmentId, thread.id));
  return navigation.openProject(scopeProjectRef(environmentId, projectId));
}
