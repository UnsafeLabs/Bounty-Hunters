import { type TurnId, type EnvironmentId } from "@t3tools/contracts";
import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { type TurnDiffFileChange } from "../../types";
import {
  buildTurnDiffTree,
  type TurnDiffTreeNode,
  type TurnDiffTreeDirectoryNode,
  type TurnDiffTreeFileNode,
  summarizeTurnDiffStats,
} from "../../lib/turnDiffTree";
import { ChevronRightIcon, FolderIcon, FolderClosedIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { VscodeEntryIcon } from "./VscodeEntryIcon";
import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { readEnvironmentApi } from "~/environmentApi";
import { stackedThreadToast, toastManager } from "../ui/toast";

const EMPTY_DIRECTORY_OVERRIDES: Record<string, boolean> = {};

function FileNode(props: {
  node: TurnDiffTreeFileNode;
  depth: number;
  turnId: TurnId;
  isSelected: boolean;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onClick: (path: string, event: React.MouseEvent) => void;
  resolvedTheme: "light" | "dark";
}) {
  const { node, depth, turnId, isSelected, onClick, resolvedTheme } = props;
  const leftPadding = 8 + depth * 14;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `file:${node.path}`,
    data: { path: node.path, kind: "file" },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 9999 : undefined,
      }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      style={{ paddingLeft: `${leftPadding}px`, ...style }}
      {...listeners}
      {...attributes}
      type="button"
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80 select-none",
        isSelected && "bg-primary/10 text-primary-foreground",
        isDragging && "shadow-lg cursor-grabbing bg-background/90",
      )}
      onClick={(e) => onClick(node.path, e)}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <VscodeEntryIcon
        pathValue={node.path}
        kind="file"
        theme={resolvedTheme}
        className="size-3.5 text-muted-foreground/70"
      />
      <span className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
        {node.name}
      </span>
      {node.stat && (
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
          <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
        </span>
      )}
    </button>
  );
}

function DirectoryNode(props: {
  node: TurnDiffTreeDirectoryNode;
  depth: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  activeDragFiles: string[];
}) {
  const { node, depth, isExpanded, onToggle, children, activeDragFiles } = props;
  const leftPadding = 8 + depth * 14;

  const { isOver, setNodeRef } = useDroppable({
    id: `dir:${node.path}`,
    data: { path: node.path, kind: "directory" },
  });

  const isValidTarget = useMemo(() => {
    if (activeDragFiles.length === 0) return false;
    return activeDragFiles.every((filePath) => {
      const fileParent = filePath.split("/").slice(0, -1).join("/");
      return fileParent !== node.path && filePath !== node.path;
    });
  }, [activeDragFiles, node.path]);

  return (
    <div ref={setNodeRef} className="relative">
      <button
        type="button"
        data-scroll-anchor-ignore
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80 relative transition-all",
          isOver && isValidTarget && "bg-primary/20",
          isOver && !isValidTarget && "bg-destructive/10 cursor-not-allowed",
        )}
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={onToggle}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
            isExpanded && "rotate-90",
          )}
        />
        {isExpanded ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        ) : (
          <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
          {node.name}
        </span>
        {hasNonZeroStat(node.stat) && (
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
            <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
          </span>
        )}

        {isOver && isValidTarget && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500 animate-pulse" />
        )}
        {isOver && !isValidTarget && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-destructive" />
        )}
      </button>
      {isExpanded && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

export const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  turnId: TurnId;
  files: ReadonlyArray<TurnDiffFileChange>;
  allDirectoriesExpanded: boolean;
  resolvedTheme: "light" | "dark";
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  workspaceRoot?: string | undefined;
  environmentId?: EnvironmentId | undefined;
}) {
  const { files, allDirectoriesExpanded, onOpenTurnDiff, resolvedTheme, turnId, workspaceRoot, environmentId } = props;
  const treeNodes = useMemo(() => buildTurnDiffTree(files), [files]);
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join("\u0000"),
    [treeNodes],
  );
  const expansionStateKey = `${allDirectoriesExpanded ? "expanded" : "collapsed"}\u0000${directoryPathsKey}`;
  const [directoryExpansionState, setDirectoryExpansionState] = useState<{
    key: string;
    overrides: Record<string, boolean>;
  }>(() => ({
    key: expansionStateKey,
    overrides: {},
  }));
  const expandedDirectories =
    directoryExpansionState.key === expansionStateKey
      ? directoryExpansionState.overrides
      : EMPTY_DIRECTORY_OVERRIDES;

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activeDragFiles, setActiveDragFiles] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<Array<{
    cwd: string;
    movedPaths: Array<{ sourceRelativePath: string; destinationRelativePath: string }>;
  }>>([]);

  const toggleDirectory = useCallback(
    (pathValue: string) => {
      setDirectoryExpansionState((current) => {
        const nextOverrides = current.key === expansionStateKey ? current.overrides : {};
        return {
          key: expansionStateKey,
          overrides: {
            ...nextOverrides,
            [pathValue]: !(nextOverrides[pathValue] ?? allDirectoriesExpanded),
          },
        };
      });
    },
    [allDirectoriesExpanded, expansionStateKey],
  );

  const handleFileClick = useCallback((pathValue: string, event: React.MouseEvent) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        if (next.has(pathValue)) {
          next.delete(pathValue);
        } else {
          next.add(pathValue);
        }
      } else {
        next.clear();
        next.add(pathValue);
      }
      return next;
    });
    onOpenTurnDiff(turnId, pathValue);
  }, [turnId, onOpenTurnDiff]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const dragPath = active.data.current?.path;
    if (dragPath) {
      if (selectedPaths.has(dragPath)) {
        setActiveDragFiles(Array.from(selectedPaths));
      } else {
        setActiveDragFiles([dragPath]);
      }
    }
  }, [selectedPaths]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragFiles([]);
    if (!over) return;

    const dragPath = active.data.current?.path;
    if (!dragPath) return;

    const sourcePaths = selectedPaths.has(dragPath)
      ? Array.from(selectedPaths)
      : [dragPath];

    const targetDirectory = over.data.current?.path as string;

    const validSourcePaths = sourcePaths.filter((filePath) => {
      const fileParent = filePath.split("/").slice(0, -1).join("/");
      return fileParent !== targetDirectory && filePath !== targetDirectory;
    });

    if (validSourcePaths.length === 0) return;

    const api = environmentId ? readEnvironmentApi(environmentId) : undefined;
    if (!api || !workspaceRoot) return;

    api.projects
      .moveFile({
        cwd: workspaceRoot,
        sourceRelativePaths: validSourcePaths,
        destinationDirectoryRelativePath: targetDirectory,
      })
      .then((result) => {
        const undoMove = {
          cwd: workspaceRoot,
          movedPaths: result.movedPaths.map((m) => ({
            sourceRelativePath: m.destinationRelativePath,
            destinationRelativePath: m.sourceRelativePath.split("/").slice(0, -1).join("/"),
          })),
        };

        setUndoStack((prev) => [...prev, undoMove]);

        toastManager.add({
          type: "success",
          title: "Files moved",
          description: `Successfully moved ${result.movedPaths.length} file(s).`,
        });
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Move failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
  }, [environmentId, workspaceRoot, selectedPaths]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;

    const nextStack = [...undoStack];
    const lastMove = nextStack.pop();
    if (!lastMove) return;

    const api = environmentId ? readEnvironmentApi(environmentId) : undefined;
    if (!api) return;

    const movesByDest = new Map<string, string[]>();
    for (const move of lastMove.movedPaths) {
      const destDir = move.destinationRelativePath;
      const sources = movesByDest.get(destDir) || [];
      sources.push(move.sourceRelativePath);
      movesByDest.set(destDir, sources);
    }

    const promises = Array.from(movesByDest.entries()).map(([destDir, sources]) => {
      return api.projects.moveFile({
        cwd: lastMove.cwd,
        sourceRelativePaths: sources,
        destinationDirectoryRelativePath: destDir,
      });
    });

    Promise.all(promises)
      .then(() => {
        setUndoStack(nextStack);
        toastManager.add({
          type: "success",
          title: "Undo successful",
          description: "Reverted file moves.",
        });
      })
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Undo failed",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      });
  }, [undoStack, environmentId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isZ = event.key.toLowerCase() === "z";
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;
      if (isZ && isCtrlOrCmd && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleUndo]);

  const renderTreeNode = (node: TurnDiffTreeNode, depth: number) => {
    if (node.kind === "directory") {
      const isExpanded = expandedDirectories[node.path] ?? allDirectoriesExpanded;
      return (
        <DirectoryNode
          key={`dir:${node.path}`}
          node={node}
          depth={depth}
          isExpanded={isExpanded}
          onToggle={() => toggleDirectory(node.path)}
          activeDragFiles={activeDragFiles}
        >
          {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
        </DirectoryNode>
      );
    }

    return (
      <FileNode
        key={`file:${node.path}`}
        node={node}
        depth={depth}
        turnId={turnId}
        isSelected={selectedPaths.has(node.path)}
        onOpenTurnDiff={onOpenTurnDiff}
        onClick={handleFileClick}
        resolvedTheme={resolvedTheme}
      />
    );
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-0.5">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>
    </DndContext>
  );
});

function collectDirectoryPaths(nodes: ReadonlyArray<TurnDiffTreeNode>): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    paths.push(node.path);
    paths.push(...collectDirectoryPaths(node.children));
  }
  return paths;
}
