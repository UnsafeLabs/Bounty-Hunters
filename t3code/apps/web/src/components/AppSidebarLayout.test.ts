import { scopeProjectRef } from "@t3tools/client-runtime";
import { describe, expect, it } from "vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { resolveMenuProjectRef } from "./AppSidebarLayout";
import type { Project } from "../types";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");
const defaultProjectRef = scopeProjectRef(localEnvironmentId, ProjectId.make("project-2"));

const projectOne: Project = {
  id: ProjectId.make("project-1"),
  environmentId: localEnvironmentId,
  name: "Local project",
  cwd: "/Users/jane/projects/project-one",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
};

const projectTwo: Project = {
  id: ProjectId.make("project-2"),
  environmentId: localEnvironmentId,
  name: "Default project",
  cwd: "/Users/jane/projects/project-two",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
};

const projectThree: Project = {
  id: ProjectId.make("project-3"),
  environmentId: remoteEnvironmentId,
  name: "Remote project",
  cwd: "C:\\Users\\kate\\projects\\project-three",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
};

const projects: Project[] = [projectOne, projectTwo, projectThree];

describe("resolveMenuProjectRef", () => {
  it("resolves project from path for path-only deep links", () => {
    expect(
      resolveMenuProjectRef(
        { kind: "open-project", path: "/Users/jane/projects/project-one/" },
        projects,
        null,
      ),
    ).toEqual(scopeProjectRef(localEnvironmentId, projectOne.id));
  });

  it("uses environment filtering when resolving path-only deep links", () => {
    expect(
      resolveMenuProjectRef(
        {
          kind: "open-project",
          environmentId: remoteEnvironmentId,
          path: "C:/Users/kate/projects/project-three",
        },
        projects,
        null,
      ),
    ).toEqual(scopeProjectRef(projectThree.environmentId, projectThree.id));
  });

  it("keeps projectId resolution working when no path is provided", () => {
    expect(
      resolveMenuProjectRef(
        { kind: "open-project", environmentId: localEnvironmentId, projectId: projectOne.id },
        projects,
        defaultProjectRef,
      ),
    ).toEqual(scopeProjectRef(localEnvironmentId, projectOne.id));
  });

  it("returns null when a path-only project cannot be resolved", () => {
    expect(
      resolveMenuProjectRef(
        { kind: "open-project", path: "/Users/jane/projects/missing-project" },
        projects,
        defaultProjectRef,
      ),
    ).toBeNull();
  });
});
