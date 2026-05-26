import { type KeybindingCommand, type FilesystemBrowseEntry } from "@t3tools/contracts";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import { type ReactNode } from "react";
import { sortThreads } from "../lib/threadSort";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type SidebarThreadSummary, type Thread } from "../types";

export const RECENT_THREAD_LIMIT = 12;
export const ITEM_ICON_CLASS = "size-4 text-muted-foreground/80";
export const ADDON_ICON_CLASS = "size-4";

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly titleMatchIndices?: ReadonlyArray<number>;
  readonly description?: string;
  readonly timestamp?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export function filterBrowseEntries(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseFilterQuery: string;
  highlightedItemValue: string | null;
}): {
  filteredEntries: FilesystemBrowseEntry[];
  highlightedEntry: FilesystemBrowseEntry | null;
  exactEntry: FilesystemBrowseEntry | null;
} {
  const lowerFilter = input.browseFilterQuery.toLowerCase();
  const showHidden = input.browseFilterQuery.startsWith(".");

  const filteredEntries = input.browseEntries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerFilter) &&
      (showHidden || !entry.name.startsWith(".")),
  );

  let highlightedEntry: FilesystemBrowseEntry | null = null;
  if (input.highlightedItemValue?.startsWith("browse:")) {
    const highlightedPath = input.highlightedItemValue.slice("browse:".length);
    highlightedEntry = filteredEntries.find((entry) => entry.fullPath === highlightedPath) ?? null;
  }

  const exactEntry =
    input.browseFilterQuery.length > 0
      ? (filteredEntries.find((entry) => entry.name === input.browseFilterQuery) ?? null)
      : null;

  return { filteredEntries, highlightedEntry, exactEntry };
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface CommandPaletteFuzzyMatch {
  readonly score: number;
  readonly indices: ReadonlyArray<number>;
}

function isWordBoundary(value: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  const previous = value[index - 1] ?? "";
  const current = value[index] ?? "";

  return (
    /[\s/_\-.:]/.test(previous) ||
    (previous.toLowerCase() === previous &&
      previous.toUpperCase() !== previous &&
      current.toUpperCase() === current &&
      current.toLowerCase() !== current)
  );
}

export function fuzzyMatchCommandPaletteText(
  field: string,
  query: string,
): CommandPaletteFuzzyMatch | null {
  const normalizedField = normalizeSearchText(field);
  const normalizedQuery = normalizeSearchText(query);
  const queryCharacters = normalizedQuery.replace(/\s+/g, "");

  if (queryCharacters.length === 0) {
    return { score: 0, indices: [] };
  }
  if (normalizedField.length === 0) {
    return null;
  }

  const indices: number[] = [];
  let queryIndex = 0;
  let score = 1_000;
  let previousMatchIndex = -1;

  for (
    let fieldIndex = 0;
    fieldIndex < field.length && queryIndex < queryCharacters.length;
    fieldIndex += 1
  ) {
    if (field[fieldIndex]?.toLowerCase() !== queryCharacters[queryIndex]) {
      continue;
    }

    indices.push(fieldIndex);
    score += 40;

    if (previousMatchIndex === fieldIndex - 1) {
      score += 30;
    } else if (isWordBoundary(field, fieldIndex)) {
      score += 20;
    }

    previousMatchIndex = fieldIndex;
    queryIndex += 1;
  }

  if (queryIndex !== queryCharacters.length) {
    return null;
  }

  if (normalizedField === normalizedQuery) {
    score += 500;
  } else if (normalizedField.startsWith(normalizedQuery)) {
    score += 250;
  } else if (normalizedField.includes(normalizedQuery)) {
    score += 100;
  }

  const compactnessGap = indices.at(-1)! - indices[0]! + 1 - indices.length;
  score -= compactnessGap * 2;
  score -= field.length * 0.01;

  return { score, indices };
}

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<Project>;
  valuePrefix: string;
  icon: (project: Project) => ReactNode;
  runProject: (project: Project) => Promise<void>;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [project.name, project.cwd],
    title: project.name,
    description: project.cwd,
    icon: input.icon(project),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

export type BuildThreadActionItemsThread = Pick<
  SidebarThreadSummary,
  "archivedAt" | "branch" | "createdAt" | "environmentId" | "id" | "projectId" | "title"
> & {
  updatedAt?: string | undefined;
  latestUserMessageAt?: string | null;
};

export function buildThreadActionItems<TThread extends BuildThreadActionItemsThread>(input: {
  threads: ReadonlyArray<TThread>;
  activeThreadId?: Thread["id"];
  projectTitleById: ReadonlyMap<Project["id"], string>;
  sortOrder: SidebarThreadSortOrder;
  icon: ReactNode;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: TThread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: TThread) => ReactNode;
  runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>;
  limit?: number;
}): CommandPaletteActionItem[] {
  const sortedThreads = sortThreads(
    input.threads.filter((thread) => thread.archivedAt === null),
    input.sortOrder,
  );
  const visibleThreads =
    input.limit === undefined ? sortedThreads : sortedThreads.slice(0, input.limit);

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${thread.id}`,
        searchTerms: [thread.title, projectTitle ?? ``, thread.branch ?? ``],
        title: thread.title,
        description: descriptionParts.join(` · `),
        timestamp: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
}

interface CommandPaletteItemMatch {
  readonly rank: number;
  readonly titleMatchIndices?: ReadonlyArray<number>;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  normalizedQuery: string,
): CommandPaletteItemMatch | null {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  if (terms.length === 0) {
    return null;
  }

  let bestMatch: CommandPaletteItemMatch | null = null;
  const titleMatch =
    typeof item.title === "string"
      ? fuzzyMatchCommandPaletteText(item.title, normalizedQuery)
      : null;

  for (const [index, field] of terms.entries()) {
    const fieldMatch = fuzzyMatchCommandPaletteText(field, normalizedQuery);
    if (!fieldMatch) {
      continue;
    }

    const isTitleField =
      typeof item.title === "string" &&
      normalizeSearchText(field) === normalizeSearchText(item.title);
    const rank = 10_000 - index * 500 + fieldMatch.score + (isTitleField ? 250 : 0);
    const candidate: CommandPaletteItemMatch = {
      rank,
      ...(isTitleField
        ? { titleMatchIndices: fieldMatch.indices }
        : titleMatch
          ? { titleMatchIndices: titleMatch.indices }
          : {}),
    };

    if (!bestMatch || candidate.rank > bestMatch.rank) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith(">");
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === "actions");
    }
    return [...input.activeGroups];
  }

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === "actions");
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== "recent-threads");
  }

  const searchableGroups = [...baseGroups];
  if (!input.isInSubmenu && !isActionsFilter) {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
  }

  return searchableGroups.flatMap((group) => {
    const items = group.items
      .map((item, index) => {
        const match = rankCommandPaletteItemMatch(item, normalizedQuery);
        if (!match) {
          return null;
        }

        return {
          item:
            match.titleMatchIndices && match.titleMatchIndices.length > 0
              ? { ...item, titleMatchIndices: match.titleMatchIndices }
              : item,
          index,
          rank: match.rank,
        };
      })
      .filter(
        (entry): entry is { item: (typeof group.items)[number]; index: number; rank: number } =>
          entry !== null,
      )
      .toSorted((left, right) => right.rank - left.rank || left.index - right.index)
      .map((entry) => entry.item);

    if (items.length === 0) {
      return [];
    }

    return [{ value: group.value, label: group.label, items }];
  });
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void;
  browseTo: (name: string) => void;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.actionItems.length > 0) {
    groups.push({ value: "actions", label: "Actions", items: input.actionItems });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent Threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search commands, projects, and threads...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}
