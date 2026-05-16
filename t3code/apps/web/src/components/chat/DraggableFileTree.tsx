import {
  type FilesystemBrowseEntry,
  type FilesystemMoveInput,
} from "@t3tools/contracts";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderClosedIcon,
  FolderOpenIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  useDraggable,
  useDroppable,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { cn } from "~/lib/utils";
import type { EnvironmentApi } from "@t3tools/contracts";

// ─── Tree Data Types ────────────────────────────────────────────────────────

interface TreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children: TreeNode[];
  depth: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTree(entries: Map<string, TreeNode>, rootPath: string): TreeNode[] {
  const root = entries.get(rootPath);
  if (!root || !root.isDirectory) return [];
  return root.children;
}

async function loadDirectory(
  api: EnvironmentApi,
  dirPath: string,
  cwd: string | undefined,
): Promise<readonly FilesystemBrowseEntry[]> {
  const result = await api.filesystem.browse({
    partialPath: dirPath,
    cwd,
  });
  return result.entries;
}

function findNodeByPath(
  nodes: Map<string, TreeNode>,
  path: string,
): TreeNode | undefined {
  return nodes.get(path);
}

function collectAllDescendantPaths(
  nodes: Map<string, TreeNode>,
  dirPath: string,
): string[] {
  const dir = nodes.get(dirPath);
  if (!dir || !dir.isDirectory) return [dirPath];
  const paths: string[] = [dirPath];
  for (const child of dir.children) {
    if (child.isDirectory) {
      paths.push(...collectAllDescendantPaths(nodes, child.path));
    } else {
      paths.push(child.path);
    }
  }
  return paths;
}

// ─── TreeNodeRow ─────────────────────────────────────────────────────────────

const TreeNodeRow = memo(function TreeNodeRow({
  node,
  expanded,
  onToggle,
  onDrop,
  draggedPath,
  selected,
  onClick,
}: {
  node: TreeNode;
  expanded: boolean;
  onToggle: (path: string) => void;
  onDrop: (sourcePath: string, destPath: string) => void;
  draggedPath: string | null;
  selected: boolean;
  onClick: (path: string, e: React.MouseEvent) => void;
}) {
  const isSelfDragged = draggedPath === node.path;
  const isChildOfDragged =
    draggedPath !== null &&
    !isSelfDragged &&
    node.path.startsWith(draggedPath + "/");

  return (
    <div>
      {node.isDirectory ? (
        <DroppableFolder
          node={node}
          expanded={expanded}
          onToggle={onToggle}
          isSelfDragged={isSelfDragged}
          isChildOfDragged={isChildOfDragged}
          selected={selected}
          onClick={onClick}
        />
      ) : (
        <DraggableFile
          node={node}
          isSelfDragged={isSelfDragged}
          isChildOfDragged={isChildOfDragged}
          selected={selected}
          onClick={onClick}
        />
      )}
    </div>
  );
});

// ─── DraggableFile ───────────────────────────────────────────────────────────

const DraggableFile = memo(function DraggableFile({
  node,
  isSelfDragged,
  isChildOfDragged,
  selected,
  onClick,
}: {
  node: TreeNode;
  isSelfDragged: boolean;
  isChildOfDragged: boolean;
  selected: boolean;
  onClick: (path: string, e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: node.path,
      data: { type: "file", path: node.path, isDirectory: false },
    });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const leftPadding = 8 + node.depth * 14;

  if (isChildOfDragged) return null;

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, paddingLeft: `${leftPadding}px` }}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        // Stop propagation so the drag listeners don't interfere with click-to-select
        e.stopPropagation();
        onClick(node.path, e);
      }}
      className={cn(
        "group flex cursor-grab items-center gap-1.5 rounded-md py-0.5 pr-2 text-left text-[11px]",
        isDragging
          ? "opacity-50"
          : "hover:bg-background/80 active:cursor-grabbing",
        isSelfDragged && "opacity-30",
        selected && "bg-accent/50",
      )}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      <span className="truncate font-mono text-muted-foreground/90 group-hover:text-foreground/90">
        {node.name}
      </span>
    </div>
  );
});

// ─── DroppableFolder ─────────────────────────────────────────────────────────

const DroppableFolder = memo(function DroppableFolder({
  node,
  expanded,
  onToggle,
  isSelfDragged,
  isChildOfDragged,
  selected,
  onClick,
}: {
  node: TreeNode;
  expanded: boolean;
  onToggle: (path: string) => void;
  isSelfDragged: boolean;
  isChildOfDragged: boolean;
  selected: boolean;
  onClick: (path: string, e: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder:${node.path}`,
    data: { type: "folder", path: node.path },
  });

  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } =
    useDraggable({
      id: node.path,
      data: { type: "folder", path: node.path, isDirectory: true },
    });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const leftPadding = 8 + node.depth * 14;

  if (isChildOfDragged) return null;

  return (
    <div ref={setNodeRef}>
      <div
        ref={setDragRef}
        style={{ ...style, paddingLeft: `${leftPadding}px` }}
        {...listeners}
        {...attributes}
        onClick={(e) => {
          e.stopPropagation();
          onClick(node.path, e);
        }}
        className={cn(
          "group flex cursor-grab items-center gap-1.5 rounded-md py-0.5 pr-2 text-left",
          isDragging
            ? "opacity-50"
            : "hover:bg-background/80 active:cursor-grabbing",
          isSelfDragged && "opacity-30",
          isOver && !isSelfDragged && "bg-accent/60 ring-1 ring-accent",
          selected && "bg-accent/50",
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          className="flex items-center"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        {expanded ? (
          <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        ) : (
          <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
          {node.name}
        </span>
      </div>
    </div>
  );
});

// ─── DragOverlayContent ──────────────────────────────────────────────────────

const DragOverlayContent = memo(function DragOverlayContent({
  path,
  count,
}: {
  path: string;
  count: number;
}) {
  const name = path.split("/").pop() || path;
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-accent/80 px-2 py-1 text-[11px] shadow-lg backdrop-blur-sm">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      <span className="truncate font-mono text-foreground/90">
        {count > 1 ? `${name} +${count - 1} more` : name}
      </span>
    </div>
  );
});

// ─── DraggableFileTree Component ─────────────────────────────────────────────

export const DraggableFileTree = memo(function DraggableFileTree({
  api,
  cwd,
}: {
  api: EnvironmentApi;
  cwd?: string;
}) {
  const [treeNodes, setTreeNodes] = useState<Map<string, TreeNode>>(new Map());
  const [expandedDirectories, setExpandedDirectories] = useState<
    Set<string>
  >(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const loadingRef = useRef<Set<string>>(new Set());

  // ── Multi-select state ───────────────────────────────────────────────────
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);
  // Snapshot of selected paths at drag start, to avoid race conditions
  const dragSelectedRef = useRef<Set<string>>(new Set());

  const rootPath = cwd ? cwd : "/";

  // Load root directory on mount
  useEffect(() => {
    const loadRoot = async () => {
      if (loadingRef.current.has(rootPath)) return;
      loadingRef.current.add(rootPath);
      setLoadingPaths((prev) => new Set(prev).add(rootPath));
      try {
        const entries = await loadDirectory(api, "", cwd);
        const rootNode: TreeNode = {
          path: rootPath,
          name: rootPath === "/" ? "/" : rootPath.split("/").pop() || "/",
          isDirectory: true,
          children: entries.map((e) => ({
            path: e.fullPath,
            name: e.name,
            isDirectory: e.isDirectory,
            children: [],
            depth: 1,
          })),
          depth: 0,
        };
        setTreeNodes((prev) => {
          const next = new Map(prev);
          next.set(rootPath, rootNode);
          for (const child of rootNode.children) {
            next.set(child.path, child);
          }
          return next;
        });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load files");
      } finally {
        loadingRef.current.delete(rootPath);
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(rootPath);
          return next;
        });
      }
    };
    loadRoot();
  }, [api, cwd, rootPath]);

  // Load a directory's children
  const expandDirectory = useCallback(
    async (dirPath: string) => {
      if (loadingRef.current.has(dirPath)) return;
      loadingRef.current.add(dirPath);
      setLoadingPaths((prev) => new Set(prev).add(dirPath));
      try {
        const entries = await loadDirectory(api, dirPath, cwd);
        const parentDepth = treeNodes.get(dirPath)?.depth ?? 0;
        setTreeNodes((prev) => {
          const next = new Map(prev);
          const dirNode = next.get(dirPath);
          if (!dirNode) return prev;

          const children = entries.map((e) => ({
            path: e.fullPath,
            name: e.name,
            isDirectory: e.isDirectory,
            children: [] as TreeNode[],
            depth: parentDepth + 1,
          }));

          // Remove old children
          for (const [k, v] of next) {
            if (v.path.startsWith(dirPath + "/") && v.path !== dirPath) {
              next.delete(k);
            }
          }

          // Add new children
          for (const child of children) {
            next.set(child.path, child);
          }

          dirNode.children = children;
          next.set(dirPath, { ...dirNode });
          return next;
        });
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load directory");
      } finally {
        loadingRef.current.delete(dirPath);
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [api, cwd, treeNodes],
  );

  const handleToggle = useCallback(
    (path: string) => {
      setExpandedDirectories((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          // Load on expand
          void expandDirectory(path);
        }
        return next;
      });
    },
    [expandDirectory],
  );

  // ── Multi-select click handler ────────────────────────────────────────────
  // Use a ref to access the latest visibleNodePaths without stale closures
  const visibleNodePathsRef = useRef<string[]>([]);
  const handleNodeClick = useCallback(
    (path: string, e: React.MouseEvent) => {
      const paths = visibleNodePathsRef.current;

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+click: toggle selection without clearing others
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return next;
        });
        // Update last-clicked anchor when toggling on
        if (!e.shiftKey) {
          lastClickedRef.current = path;
        }
        return;
      }

      if (e.shiftKey && lastClickedRef.current !== null) {
        // Shift+click: select range from lastClickedRef to this node
        // Find indices of anchor and clicked node in visible order
        const anchorIdx = paths.indexOf(lastClickedRef.current);
        const clickedIdx = paths.indexOf(path);

        if (anchorIdx !== -1 && clickedIdx !== -1) {
          const start = Math.min(anchorIdx, clickedIdx);
          const end = Math.max(anchorIdx, clickedIdx);
          const rangePaths = paths.slice(start, end + 1);
          // Merge range into existing selection
          setSelectedPaths((prev) => {
            const next = new Set(prev);
            for (const p of rangePaths) {
              next.add(p);
            }
            return next;
          });
        } else {
          // Fallback: just select the single clicked node
          setSelectedPaths(new Set([path]));
          lastClickedRef.current = path;
        }
        return;
      }

      // Plain click: clear selection, select just this item
      setSelectedPaths(new Set([path]));
      lastClickedRef.current = path;
    },
    [],
  );

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const sourcePath = active.id as string;
      const overData = over.data.current as
        | { type: string; path: string }
        | undefined;
      if (!overData) return;

      // Only allow dropping files into folders
      if (overData.type !== "folder") return;

      const destDir = overData.path;

      // Determine which paths to move
      const pathsToMove: string[] = [];
      const dragSnapshot = dragSelectedRef.current;

      if (dragSnapshot.size > 0 && dragSnapshot.has(sourcePath)) {
        // Drag started while multiple items selected → move all selected
        for (const p of dragSnapshot) {
          pathsToMove.push(p);
        }
      } else {
        // Single-item drag
        pathsToMove.push(sourcePath);
      }

      // Track which directories need refreshing
      const dirsToRefresh = new Set<string>();

      try {
        for (const srcPath of pathsToMove) {
          const fileName = srcPath.split("/").pop() || srcPath;
          const destPath = destDir.endsWith("/")
            ? `${destDir}${fileName}`
            : `${destDir}/${fileName}`;

          // Don't drop onto itself
          if (destPath === srcPath) continue;

          const moveInput: FilesystemMoveInput = {
            sourcePath: srcPath,
            destinationPath: destPath,
            cwd,
          };
          await api.filesystem.move(moveInput);

          const sourceDir = srcPath.substring(
            0,
            srcPath.lastIndexOf("/"),
          );
          dirsToRefresh.add(sourceDir);
          if (sourceDir !== destDir) {
            dirsToRefresh.add(destDir);
          }
        }

        // Refresh affected directories sequentially
        for (const dir of dirsToRefresh) {
          await expandDirectory(dir);
        }

        // Clear selection after a successful batch move
        setSelectedPaths(new Set());
        dragSelectedRef.current = new Set();
      } catch (e) {
        console.error("Failed to move file(s):", e);
      }
    },
    [api, cwd, expandDirectory],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
    // Snapshot selected paths at drag start
    setSelectedPaths((current) => {
      dragSelectedRef.current = new Set(current);
      return current;
    });
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // handled by droppable
  }, []);

  const rootNode = treeNodes.get(rootPath);
  const visibleNodes = useMemo(() => {
    const result: TreeNode[] = [];
    if (!rootNode) return result;

    const walk = (node: TreeNode) => {
      if (node.path === rootPath) {
        // Root children only
        for (const child of node.children) {
          result.push(child);
          if (child.isDirectory && expandedDirectories.has(child.path)) {
            walkChildren(child);
          }
        }
      }
    };

    const walkChildren = (dir: TreeNode) => {
      for (const child of dir.children) {
        result.push(child);
        if (child.isDirectory && expandedDirectories.has(child.path)) {
          walkChildren(child);
        }
      }
    };

    walk(rootNode);
    return result;
  }, [rootNode, expandedDirectories, rootPath]);

  // Flattened ordered paths for shift-click range calculation
  const visibleNodePaths = useMemo(() => {
    return visibleNodes.map((n) => n.path);
  }, [visibleNodes]);
  // Keep ref in sync so handleNodeClick (stable callback) can access latest
  visibleNodePathsRef.current = visibleNodePaths;

  const activePath =
    activeId && !String(activeId).startsWith("folder:")
      ? (activeId as string)
      : null;

  // Count how many items are being dragged (for overlay)
  const draggingCount =
    activePath && dragSelectedRef.current.has(activePath)
      ? Math.max(1, dragSelectedRef.current.size)
      : 1;

  // ── Ctrl+Z undo support ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        api.filesystem
          .undoMove()
          .then((result) => {
            if (result.success) {
              // Refresh directories after undo
              const dirsToRefresh = new Set<string>();
              if (result.undoneSourcePath) {
                const dir = result.undoneSourcePath.substring(
                  0,
                  result.undoneSourcePath.lastIndexOf("/")
                );
                if (dir) dirsToRefresh.add(dir);
              }
              if (result.undoneDestPath) {
                const dir = result.undoneDestPath.substring(
                  0,
                  result.undoneDestPath.lastIndexOf("/")
                );
                if (dir) dirsToRefresh.add(dir);
              }
              // Refresh affected directories
              const rootNode = treeNodes.get(rootPath);
              if (rootNode) {
                dirsToRefresh.add(rootPath);
              }
              dirsToRefresh.forEach((dir) => {
                if (expandedDirectories.has(dir)) {
                  loadDirectory(api, dir, cwd).then((entries) => {
                    setTreeNodes((prev) => {
                      const next = new Map(prev);
                      const existing = next.get(dir);
                      if (existing) {
                        next.set(dir, {
                          ...existing,
                          children: entries.map((e) => ({
                            path: e.fullPath,
                            name: e.name,
                            isDirectory: e.isDirectory,
                            children: [],
                            depth: existing.depth + 1,
                          })),
                        });
                      }
                      return next;
                    });
                  });
                }
              });
            }
          })
          .catch(() => {
            // silently fail — undo may not be available
          });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [api, cwd, rootPath, treeNodes, expandedDirectories]);

  return (
    <div className="flex flex-col gap-0.5 py-1">
      <div className="flex items-center gap-1.5 px-3 py-1">
        <FolderIcon className="size-3.5 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground/80">
          Files
        </span>
        {loadingPaths.size > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground/50">
            loading...
          </span>
        )}
      </div>

      {error && (
        <div className="px-3 py-1 text-[10px] text-red-400/80">{error}</div>
      )}

      <DndContext
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
      >
        <div className="space-y-0.5">
          {visibleNodes.map((node) => (
            <TreeNodeRow
              key={node.path}
              node={node}
              expanded={expandedDirectories.has(node.path)}
              onToggle={handleToggle}
              onDrop={async (src, dst) => {
                try {
                  await api.filesystem.move({
                    sourcePath: src,
                    destinationPath: dst,
                    cwd,
                  } as FilesystemMoveInput);
                  // Refresh
                  await expandDirectory(
                    src.substring(0, src.lastIndexOf("/")),
                  );
                } catch {
                  // ignore
                }
              }}
              draggedPath={activePath}
              selected={selectedPaths.has(node.path)}
              onClick={handleNodeClick}
            />
          ))}
          {visibleNodes.length === 0 && !error && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground/50">
              No files
            </div>
          )}
        </div>

        <DragOverlay>
          {activePath ? (
            <DragOverlayContent path={activePath} count={draggingCount} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
});
