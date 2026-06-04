import type { DesktopMenuAction, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";

export const DEEP_LINK_SCHEME = "t3code";

export type DeepLinkMenuAction = DesktopMenuAction;

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizePathCandidate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed === "/") {
    return "/";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function hasParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/).some((segment) => segment === "..");
}

function splitCommandAndPayload(url: URL): [string, readonly string[]] {
  const normalizedPath = safeDecode(url.pathname).replace(/\\+/g, "/");
  const explicitSegments = normalizedPath
    .split("/")
    .map((segment) => safeDecode(segment))
    .filter((segment) => segment.length > 0);

  const command = safeDecode(url.host).toLowerCase();
  return [command, explicitSegments];
}

function parsePathSegmentsForProject(segments: readonly string[]): {
  environmentId?: string;
  projectId?: string;
  path?: string;
} {
  const parsed: { environmentId?: string; projectId?: string; path?: string } = {};
  if (segments.length < 2) {
    if (segments.length > 0) {
      const normalizedPath = normalizePathCandidate(segments.join("/"));
      if (normalizedPath.length > 0) parsed.path = normalizedPath;
    }
    return parsed;
  }

  const environmentId = segments[0];
  const projectId = segments[1];
  const pathSegments = segments.slice(2);
  if (environmentId === undefined || projectId === undefined) {
    return parsed;
  }
  if (hasParentTraversal(environmentId) || hasParentTraversal(projectId)) {
    return parsed;
  }
  if (environmentId !== undefined) {
    parsed.environmentId = environmentId;
  }
  if (projectId !== undefined) {
    parsed.projectId = projectId;
  }
  const pathFromSegments =
    pathSegments.length > 0 ? normalizePathCandidate(pathSegments.join("/")) : undefined;
  if (pathFromSegments && pathFromSegments.length > 0) {
    parsed.path = pathFromSegments;
  }
  return parsed;
}

function parseOpenProjectAction(
  command: string,
  payloadSegments: readonly string[],
  searchParams: URLSearchParams,
): Option.Option<DeepLinkMenuAction> {
  if (command !== "open-project" && command !== "project") {
    return Option.none();
  }

  const environmentId = searchParams.get("environmentId")?.trim();
  const projectId = searchParams.get("projectId")?.trim();
  const pathFromQuery = searchParams.get("path")?.trim();
  const pathSegments = parsePathSegmentsForProject(payloadSegments);
  const environmentIdFromPath = pathSegments.environmentId?.trim();
  const projectIdFromPath = pathSegments.projectId?.trim();

  const pathFromSegments = pathSegments.path ?? "";

  const path = (() => {
    if (pathFromQuery && pathFromQuery.length > 0) {
      if (hasParentTraversal(pathFromQuery)) {
        return undefined;
      }
      return normalizePathCandidate(pathFromQuery);
    }
    if (pathFromSegments.length > 0 && !hasParentTraversal(pathFromSegments)) {
      return pathFromSegments;
    }
    return undefined;
  })();

  const hasValidSegmentIds =
    (environmentId?.length ?? 0) > 0 ||
    (projectId?.length ?? 0) > 0 ||
    (environmentIdFromPath?.length ?? 0) > 0 ||
    (projectIdFromPath?.length ?? 0) > 0;
  if (!hasValidSegmentIds && !path) {
    return Option.none();
  }

  return Option.some({
    kind: "open-project",
    ...(environmentId && { environmentId: environmentId as EnvironmentId }),
    ...(projectId && { projectId: projectId as ProjectId }),
    ...(environmentIdFromPath &&
      !environmentId && { environmentId: environmentIdFromPath as EnvironmentId }),
    ...(projectIdFromPath && !projectId && { projectId: projectIdFromPath as ProjectId }),
    ...(path && { path }),
  });
}

function parseOpenThreadAction(
  command: string,
  payloadSegments: readonly string[],
  searchParams: URLSearchParams,
): Option.Option<DeepLinkMenuAction> {
  const normalizedCommand = command.toLowerCase();
  if (
    normalizedCommand !== "open-thread" &&
    normalizedCommand !== "thread" &&
    normalizedCommand !== "chat"
  ) {
    return Option.none();
  }

  if (normalizedCommand === "chat" && payloadSegments[0] !== "thread") {
    return Option.none();
  }

  const queryEnvironmentId = searchParams.get("environmentId")?.trim();
  const queryThreadId = searchParams.get("threadId")?.trim() ?? searchParams.get("id")?.trim();
  const routeSegments = normalizedCommand === "chat" ? payloadSegments.slice(1) : payloadSegments;

  const threadIdCandidate =
    queryThreadId ?? (routeSegments.length >= 2 ? routeSegments[1] : routeSegments[0]);
  const threadId = threadIdCandidate?.trim();
  const environmentId =
    queryEnvironmentId ?? (routeSegments.length >= 2 ? routeSegments[0] : undefined);

  if (!threadId) {
    return Option.none();
  }

  return Option.some({
    kind: "open-thread",
    ...(environmentId ? { environmentId: environmentId as EnvironmentId } : {}),
    threadId: threadId as ThreadId,
  });
}

function parseOpenCommandAction(
  payloadSegments: readonly string[],
  searchParams: URLSearchParams,
): Option.Option<DeepLinkMenuAction> {
  if (payloadSegments.length === 0 || payloadSegments[0] === "") {
    return Option.none();
  }

  if (payloadSegments[0] === "project") {
    return parseOpenProjectAction("open-project", payloadSegments.slice(1), searchParams);
  }

  if (payloadSegments[0] === "thread") {
    return parseOpenThreadAction("thread", payloadSegments.slice(1), searchParams);
  }

  return Option.none();
}

export function isDeepLinkArg(value: string): boolean {
  return value.startsWith(`${DEEP_LINK_SCHEME}://`);
}

export function findDeepLinkArg(args: Iterable<string>): Option.Option<string> {
  for (const arg of args) {
    if (isDeepLinkArg(arg)) {
      return Option.some(arg);
    }
  }
  return Option.none();
}

export function parseDeepLinkAction(rawUrl: string): Option.Option<DeepLinkMenuAction> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return Option.none();
  }

  if (parsedUrl.protocol.replace(":", "") !== DEEP_LINK_SCHEME) {
    return Option.none();
  }

  const [command, payloadSegments] = splitCommandAndPayload(parsedUrl);

  if (command === "settings" || command === "open-settings") {
    return Option.some({ kind: "open-settings" });
  }

  if (command === "open") {
    const openCommandAction = parseOpenCommandAction(payloadSegments, parsedUrl.searchParams);
    if (Option.isSome(openCommandAction)) {
      return openCommandAction;
    }
  }

  const openProjectAction = parseOpenProjectAction(
    command,
    payloadSegments,
    parsedUrl.searchParams,
  );
  if (Option.isSome(openProjectAction)) {
    return openProjectAction;
  }

  const openThreadAction = parseOpenThreadAction(command, payloadSegments, parsedUrl.searchParams);
  if (Option.isSome(openThreadAction)) {
    return openThreadAction;
  }

  return Option.none();
}

export function parseDeepLinkFromArguments(
  args: Iterable<string>,
): Option.Option<DeepLinkMenuAction> {
  const candidate = findDeepLinkArg(args);
  if (Option.isNone(candidate)) {
    return Option.none();
  }
  return parseDeepLinkAction(candidate.value);
}
