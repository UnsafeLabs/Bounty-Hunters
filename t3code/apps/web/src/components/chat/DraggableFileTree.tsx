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
}: {
  node: TreeNode;
  expanded: boolean;
  onToggle: (path: string) => void;
  onDrop: (sourcePath: string, destPath: string) => void;
  draggedPath: string | null;
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
        />
      ) : (
        <DraggableFile
          node={node}
          isSelfDragged={isSelfDragged}
          isChildOfDragged={isChildOfDragged}
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
}: {
  node: TreeNode;
  isSelfDragged: boolean;
  isChildOfDragged: boolean;
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
      className={cn(
        "group flex cursor-grab items-center gap-1.5 rounded-md py-0.5 pr-2 text-left text-[11px]",
        isDragging
          ? "opacity-50"
          : "hover:bg-background/80 active:cursor-grabbing",
        isSelfDragged && "opacity-30",
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
}: {
  node: TreeNode;
  expanded: boolean;
  onToggle: (path: string) => void;
  isSelfDragged: boolean;
  isChildOfDragged: boolean;
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
        className={cn(
          "group flex cursor-grab items-center gap-1.5 rounded-md py-0.5 pr-2 text-left",
          isDragging
            ? "opacity-50"
            : "hover:bg-background/80 active:cursor-grabbing",
          isSelfDragged && "opacity-30",
          isOver && !isSelfDragged && "bg-accent/60 ring-1 ring-accent",
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
}: {
  path: string;
}) {
  const name = path.split("/").pop() || path;
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-accent/80 px-2 py-1 text-[11px] shadow-lg backdrop-blur-sm">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      <span className="truncate font-mono text-foreground/90">{name}</span>
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
      const fileName = sourcePath.split("/").pop() || sourcePath;
      const destPath = destDir.endsWith("/")
        ? `${destDir}${fileName}`
        : `${destDir}/${fileName}`;

      // Don't drop onto itself
      if (destPath === sourcePath) return;

      try {
        const moveInput: FilesystemMoveInput = {
          sourcePath,
          destinationPath: destPath,
          cwd,
        };
        await api.filesystem.move(moveInput);

        // Refresh affected directories
        const sourceDir = sourcePath.substring(
          0,
          sourcePath.lastIndexOf("/"),
        );
        await expandDirectory(sourceDir);
        if (sourceDir !== destDir) {
          await expandDirectory(destDir);
        }
      } catch (e) {
        console.error("Failed to move file:", e);
      }
    },
    [api, cwd, expandDirectory],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
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

  const activePath =
    activeId && !String(activeId).startsWith("folder:")
      ? (activeId as string)
      : null;

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
            <DragOverlayContent path={activePath} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
});
