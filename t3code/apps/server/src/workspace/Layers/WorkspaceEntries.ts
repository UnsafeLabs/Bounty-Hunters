// @effect-diagnostics nodeBuiltinImport:off
import { execFile } from "node:child_process";
import * as OS from "node:os";
import fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";
import { promisify } from "node:util";

import * as Cache from "effect/Cache";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  type FilesystemBrowseInput,
  type ProjectEntry,
  type ProjectGlobalSearchInput,
  type ProjectGlobalSearchResult,
} from "@t3tools/contracts";
import { isExplicitRelativePath, isWindowsAbsolutePath } from "@t3tools/shared/path";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@t3tools/shared/searchRanking";

import { VcsDriverRegistry } from "../../vcs/VcsDriverRegistry.ts";
import {
  WorkspaceEntries,
  WorkspaceEntriesBrowseError,
  WorkspaceEntriesError,
  type WorkspaceEntriesShape,
} from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

const WORKSPACE_CACHE_TTL_MS = 15_000;
const WORKSPACE_CACHE_MAX_KEYS = 4;
const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const GLOBAL_SEARCH_GIT_LOG_LIMIT = 500;
const GLOBAL_SEARCH_GIT_MAX_BUFFER = 8 * 1024 * 1024;
const GLOBAL_SEARCH_PREVIEW_MAX_LENGTH = 1_000;
const execFileAsync = promisify(execFile);
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

interface WorkspaceIndex {
  scannedAt: number;
  entries: SearchableWorkspaceEntry[];
  truncated: boolean;
}

interface SearchableWorkspaceEntry extends ProjectEntry {
  normalizedPath: string;
  normalizedName: string;
}

type RankedWorkspaceEntry = RankedSearchResult<SearchableWorkspaceEntry>;

interface GitProcessError extends Error {
  readonly code?: number | string;
  readonly stdout?: string;
  readonly stderr?: string;
}

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function toSearchableWorkspaceEntry(entry: ProjectEntry): SearchableWorkspaceEntry {
  const normalizedPath = entry.path.toLowerCase();
  return {
    ...entry,
    normalizedPath,
    normalizedName: basenameOf(normalizedPath),
  };
}

function scoreEntry(entry: SearchableWorkspaceEntry, query: string): number | null {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const { normalizedPath, normalizedName } = entry;

  const scores = [
    scoreQueryMatch({
      value: normalizedName,
      query,
      exactBase: 0,
      prefixBase: 2,
      includesBase: 5,
      fuzzyBase: 100,
    }),
    scoreQueryMatch({
      value: normalizedPath,
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 200,
      boundaryMarkers: ["/"],
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0];
  if (!firstSegment) return false;
  return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}

function normalizePreview(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, GLOBAL_SEARCH_PREVIEW_MAX_LENGTH);
}

function buildGlobalSearchMatcher(input: ProjectGlobalSearchInput): (value: string) => boolean {
  if (input.regex) {
    const matcher = new RegExp(input.query, input.caseSensitive ? "" : "i");
    return (value) => matcher.test(value);
  }

  if (input.caseSensitive) {
    return (value) => value.includes(input.query);
  }

  const normalizedQuery = input.query.toLowerCase();
  return (value) => value.toLowerCase().includes(normalizedQuery);
}

async function runGitForGlobalSearch(
  cwd: string,
  args: ReadonlyArray<string>,
  options?: { readonly allowNoMatches?: boolean; readonly allowNotRepository?: boolean },
): Promise<string> {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: GLOBAL_SEARCH_GIT_MAX_BUFFER,
    });
    return result.stdout;
  } catch (cause) {
    const error = cause as GitProcessError;
    if (options?.allowNoMatches && error.code === 1) {
      return error.stdout ?? "";
    }
    if (
      options?.allowNotRepository &&
      (error.code === 128 || error.stderr?.includes("not a git repository"))
    ) {
      return "";
    }
    throw cause;
  }
}

function parseGitGrepOutput(
  stdout: string,
  limit: number,
): ProjectGlobalSearchResult["fileMatches"] {
  const matches: Array<ProjectGlobalSearchResult["fileMatches"][number]> = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const firstSeparator = line.indexOf(":");
    const secondSeparator = firstSeparator === -1 ? -1 : line.indexOf(":", firstSeparator + 1);
    if (firstSeparator === -1 || secondSeparator === -1) {
      continue;
    }

    const lineNumber = Number.parseInt(line.slice(firstSeparator + 1, secondSeparator), 10);
    if (!Number.isSafeInteger(lineNumber) || lineNumber <= 0) {
      continue;
    }

    matches.push({
      path: line.slice(0, firstSeparator),
      lineNumber,
      preview: normalizePreview(line.slice(secondSeparator + 1)),
    });
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

function parseGitLogOutput(
  stdout: string,
  matcher: (value: string) => boolean,
  limit: number,
): ProjectGlobalSearchResult["gitMatches"] {
  const matches: Array<ProjectGlobalSearchResult["gitMatches"][number]> = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const [sha, author, committedAt, ...subjectParts] = line.split("\u001f");
    const subject = subjectParts.join("\u001f");
    if (!sha || !author || !committedAt || !subject || !matcher(subject)) {
      continue;
    }

    matches.push({
      sha,
      shortSha: sha.slice(0, 8),
      subject,
      author,
      committedAt,
    });
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];

  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

const resolveBrowseTarget = (
  input: FilesystemBrowseInput,
  pathService: Path.Path,
): Effect.Effect<string, WorkspaceEntriesBrowseError> =>
  Effect.gen(function* () {
    if (process.platform !== "win32" && isWindowsAbsolutePath(input.partialPath)) {
      return yield* new WorkspaceEntriesBrowseError({
        cwd: input.cwd,
        partialPath: input.partialPath,
        operation: "workspaceEntries.resolveBrowseTarget",
        detail: "Windows-style paths are only supported on Windows.",
      });
    }

    if (!isExplicitRelativePath(input.partialPath)) {
      return pathService.resolve(expandHomePath(input.partialPath, pathService));
    }

    if (!input.cwd) {
      return yield* new WorkspaceEntriesBrowseError({
        cwd: input.cwd,
        partialPath: input.partialPath,
        operation: "workspaceEntries.resolveBrowseTarget",
        detail: "Relative filesystem browse paths require a current project.",
      });
    }

    return pathService.resolve(expandHomePath(input.cwd, pathService), input.partialPath);
  });

export const makeWorkspaceEntries = Effect.gen(function* () {
  const path = yield* Path.Path;
  const vcsRegistry = yield* VcsDriverRegistry;
  const workspacePaths = yield* WorkspacePaths;

  const isInsideVcsWorkTree = (cwd: string): Effect.Effect<boolean> =>
    vcsRegistry.detect({ cwd }).pipe(
      Effect.map((handle) => handle !== null),
      Effect.catch(() => Effect.succeed(false)),
    );

  const filterVcsIgnoredPaths = (
    cwd: string,
    relativePaths: string[],
  ): Effect.Effect<string[], never> =>
    vcsRegistry.detect({ cwd }).pipe(
      Effect.flatMap((handle) =>
        handle
          ? handle.driver.filterIgnoredPaths(cwd, relativePaths).pipe(
              Effect.map((paths) => [...paths]),
              Effect.catch(() => Effect.succeed(relativePaths)),
            )
          : Effect.succeed(relativePaths),
      ),
      Effect.catch(() => Effect.succeed(relativePaths)),
    );

  const buildWorkspaceIndexFromVcs = Effect.fn("WorkspaceEntries.buildWorkspaceIndexFromVcs")(
    function* (cwd: string) {
      const vcs = yield* vcsRegistry.detect({ cwd }).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!vcs) {
        return null;
      }

      const listedFiles = yield* vcs.driver
        .listWorkspaceFiles(cwd)
        .pipe(Effect.catch(() => Effect.succeed(null)));

      if (!listedFiles) {
        return null;
      }

      const listedPaths = [...listedFiles.paths]
        .map((entry) => toPosixPath(entry))
        .filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry));
      const filePaths = yield* vcs.driver.filterIgnoredPaths(cwd, listedPaths).pipe(
        Effect.map((paths) => [...paths]),
        Effect.catch(() => filterVcsIgnoredPaths(cwd, listedPaths)),
      );

      const directorySet = new Set<string>();
      for (const filePath of filePaths) {
        for (const directoryPath of directoryAncestorsOf(filePath)) {
          if (!isPathInIgnoredDirectory(directoryPath)) {
            directorySet.add(directoryPath);
          }
        }
      }

      const directoryEntries = [...directorySet]
        .toSorted((left, right) => left.localeCompare(right))
        .map(
          (directoryPath): ProjectEntry => ({
            path: directoryPath,
            kind: "directory",
            parentPath: parentPathOf(directoryPath),
          }),
        )
        .map(toSearchableWorkspaceEntry);
      const fileEntries = [...new Set(filePaths)]
        .toSorted((left, right) => left.localeCompare(right))
        .map(
          (filePath): ProjectEntry => ({
            path: filePath,
            kind: "file",
            parentPath: parentPathOf(filePath),
          }),
        )
        .map(toSearchableWorkspaceEntry);

      const now = yield* DateTime.now;
      const entries = [...directoryEntries, ...fileEntries];
      return {
        scannedAt: now.epochMilliseconds,
        entries: entries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES),
        truncated: listedFiles.truncated || entries.length > WORKSPACE_INDEX_MAX_ENTRIES,
      };
    },
  );

  const readDirectoryEntries = Effect.fn("WorkspaceEntries.readDirectoryEntries")(function* (
    cwd: string,
    relativeDir: string,
  ): Effect.fn.Return<
    { readonly relativeDir: string; readonly dirents: Dirent[] | null },
    WorkspaceEntriesError
  > {
    return yield* Effect.tryPromise({
      try: async () => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        const dirents = await fsPromises.readdir(absoluteDir, { withFileTypes: true });
        return { relativeDir, dirents };
      },
      catch: (cause) =>
        new WorkspaceEntriesError({
          cwd,
          operation: "workspaceEntries.readDirectoryEntries",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }).pipe(
      Effect.catchIf(
        () => relativeDir.length > 0,
        () => Effect.succeed({ relativeDir, dirents: null }),
      ),
    );
  });

  const buildWorkspaceIndexFromFilesystem = Effect.fn(
    "WorkspaceEntries.buildWorkspaceIndexFromFilesystem",
  )(function* (cwd: string): Effect.fn.Return<WorkspaceIndex, WorkspaceEntriesError> {
    const shouldFilterWithGitIgnore = yield* isInsideVcsWorkTree(cwd);

    let pendingDirectories: string[] = [""];
    const entries: SearchableWorkspaceEntry[] = [];
    let truncated = false;

    while (pendingDirectories.length > 0 && !truncated) {
      const currentDirectories = pendingDirectories;
      pendingDirectories = [];

      const directoryEntries = yield* Effect.forEach(
        currentDirectories,
        (relativeDir) => readDirectoryEntries(cwd, relativeDir),
        { concurrency: WORKSPACE_SCAN_READDIR_CONCURRENCY },
      );

      const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
        const { relativeDir, dirents } = directoryEntry;
        if (!dirents) return [] as Array<{ dirent: Dirent; relativePath: string }>;

        dirents.sort((left, right) => left.name.localeCompare(right.name));
        const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
        for (const dirent of dirents) {
          if (!dirent.name || dirent.name === "." || dirent.name === "..") {
            continue;
          }
          if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
            continue;
          }
          if (!dirent.isDirectory() && !dirent.isFile()) {
            continue;
          }

          const relativePath = toPosixPath(
            relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
          );
          if (isPathInIgnoredDirectory(relativePath)) {
            continue;
          }
          candidates.push({ dirent, relativePath });
        }
        return candidates;
      });

      const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
        candidateEntries.map((entry) => entry.relativePath),
      );
      const allowedPathSet = shouldFilterWithGitIgnore
        ? new Set(yield* filterVcsIgnoredPaths(cwd, candidatePaths))
        : null;

      for (const candidateEntries of candidateEntriesByDirectory) {
        for (const candidate of candidateEntries) {
          if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
            continue;
          }

          const entry = toSearchableWorkspaceEntry({
            path: candidate.relativePath,
            kind: candidate.dirent.isDirectory() ? "directory" : "file",
            parentPath: parentPathOf(candidate.relativePath),
          });
          entries.push(entry);

          if (candidate.dirent.isDirectory()) {
            pendingDirectories.push(candidate.relativePath);
          }

          if (entries.length >= WORKSPACE_INDEX_MAX_ENTRIES) {
            truncated = true;
            break;
          }
        }

        if (truncated) {
          break;
        }
      }
    }

    const now = yield* DateTime.now;
    return {
      scannedAt: now.epochMilliseconds,
      entries,
      truncated,
    };
  });

  const buildWorkspaceIndex = Effect.fn("WorkspaceEntries.buildWorkspaceIndex")(function* (
    cwd: string,
  ): Effect.fn.Return<WorkspaceIndex, WorkspaceEntriesError> {
    const vcsIndexed = yield* buildWorkspaceIndexFromVcs(cwd);
    if (vcsIndexed) {
      return vcsIndexed;
    }
    return yield* buildWorkspaceIndexFromFilesystem(cwd);
  });

  const workspaceIndexCache = yield* Cache.makeWith<string, WorkspaceIndex, WorkspaceEntriesError>(
    buildWorkspaceIndex,
    {
      capacity: WORKSPACE_CACHE_MAX_KEYS,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.millis(WORKSPACE_CACHE_TTL_MS) : Duration.zero,
    },
  );

  const normalizeWorkspaceRoot = Effect.fn("WorkspaceEntries.normalizeWorkspaceRoot")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceEntriesError> {
    return yield* workspacePaths.normalizeWorkspaceRoot(cwd).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceEntriesError({
            cwd,
            operation: "workspaceEntries.normalizeWorkspaceRoot",
            detail: cause.message,
            cause,
          }),
      ),
    );
  });

  const invalidate: WorkspaceEntriesShape["invalidate"] = Effect.fn("WorkspaceEntries.invalidate")(
    function* (cwd) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(cwd).pipe(
        Effect.catch(() => Effect.succeed(cwd)),
      );
      yield* Cache.invalidate(workspaceIndexCache, cwd);
      if (normalizedCwd !== cwd) {
        yield* Cache.invalidate(workspaceIndexCache, normalizedCwd);
      }
    },
  );

  const browse: WorkspaceEntriesShape["browse"] = Effect.fn("WorkspaceEntries.browse")(
    function* (input) {
      const resolvedInputPath = yield* resolveBrowseTarget(input, path);
      const endsWithSeparator = /[\\/]$/.test(input.partialPath) || input.partialPath === "~";
      const parentPath = endsWithSeparator ? resolvedInputPath : path.dirname(resolvedInputPath);
      const prefix = endsWithSeparator ? "" : path.basename(resolvedInputPath);

      const dirents = yield* Effect.tryPromise({
        try: () => fsPromises.readdir(parentPath, { withFileTypes: true }),
        catch: (cause) =>
          new WorkspaceEntriesBrowseError({
            cwd: input.cwd,
            partialPath: input.partialPath,
            operation: "workspaceEntries.browse.readDirectory",
            detail: `Unable to browse '${parentPath}': ${cause instanceof Error ? cause.message : String(cause)}`,
            cause,
          }),
      });

      const showHidden = endsWithSeparator || prefix.startsWith(".");
      const lowerPrefix = prefix.toLowerCase();

      return {
        parentPath,
        entries: dirents
          .filter(
            (dirent) =>
              dirent.isDirectory() &&
              dirent.name.toLowerCase().startsWith(lowerPrefix) &&
              (showHidden || !dirent.name.startsWith(".")),
          )
          .map((dirent) => ({
            name: dirent.name,
            fullPath: path.join(parentPath, dirent.name),
          }))
          .toSorted((left, right) => left.name.localeCompare(right.name)),
      };
    },
  );

  const search: WorkspaceEntriesShape["search"] = Effect.fn("WorkspaceEntries.search")(
    function* (input) {
      const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
      return yield* Cache.get(workspaceIndexCache, normalizedCwd).pipe(
        Effect.map((index) => {
          const normalizedQuery = normalizeSearchQuery(input.query, {
            trimLeadingPattern: /^[@./]+/,
          });
          const limit = Math.max(0, Math.floor(input.limit));
          const rankedEntries: RankedWorkspaceEntry[] = [];
          let matchedEntryCount = 0;

          for (const entry of index.entries) {
            const score = scoreEntry(entry, normalizedQuery);
            if (score === null) {
              continue;
            }

            matchedEntryCount += 1;
            insertRankedSearchResult(
              rankedEntries,
              { item: entry, score, tieBreaker: entry.path },
              limit,
            );
          }

          return {
            entries: rankedEntries.map((candidate) => candidate.item),
            truncated: index.truncated || matchedEntryCount > limit,
          };
        }),
      );
    },
  );

  const globalSearch: WorkspaceEntriesShape["globalSearch"] = Effect.fn(
    "WorkspaceEntries.globalSearch",
  )(function* (input) {
    const normalizedCwd = yield* normalizeWorkspaceRoot(input.cwd);
    const limit = Math.max(0, Math.floor(input.limit));
    const matcher = yield* Effect.try({
      try: () => buildGlobalSearchMatcher(input),
      catch: (cause) =>
        new WorkspaceEntriesError({
          cwd: input.cwd,
          operation: "workspaceEntries.globalSearch.compileMatcher",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    return yield* Effect.tryPromise({
      try: async (): Promise<ProjectGlobalSearchResult> => {
        const grepArgs = [
          "grep",
          "-n",
          "-I",
          "--full-name",
          input.caseSensitive ? undefined : "-i",
          input.regex ? "-E" : "-F",
          "-e",
          input.query,
          "--",
          ".",
        ].filter((arg): arg is string => arg !== undefined);
        const [grepOutput, gitLogOutput] = await Promise.all([
          runGitForGlobalSearch(normalizedCwd, grepArgs, {
            allowNoMatches: true,
            allowNotRepository: true,
          }),
          runGitForGlobalSearch(
            normalizedCwd,
            [
              "log",
              "--all",
              `--max-count=${GLOBAL_SEARCH_GIT_LOG_LIMIT}`,
              "--format=%H%x1f%an%x1f%aI%x1f%s",
            ],
            {
              allowNotRepository: true,
            },
          ),
        ]);

        const fileMatches = parseGitGrepOutput(grepOutput, limit);
        const gitMatches = parseGitLogOutput(gitLogOutput, matcher, limit);
        return {
          fileMatches,
          gitMatches,
          filesTruncated:
            fileMatches.length >= limit && grepOutput.split(/\r?\n/).filter(Boolean).length > limit,
          gitTruncated: gitMatches.length >= limit,
        };
      },
      catch: (cause) =>
        new WorkspaceEntriesError({
          cwd: input.cwd,
          operation: "workspaceEntries.globalSearch",
          detail: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });

  return {
    browse,
    globalSearch,
    invalidate,
    search,
  } satisfies WorkspaceEntriesShape;
});

export const WorkspaceEntriesLive = Layer.effect(WorkspaceEntries, makeWorkspaceEntries);
