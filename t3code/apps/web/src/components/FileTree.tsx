import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
  pointerWithin,
  useSensor,
  useSensors,
  PointerSensor,
  type CollisionDetection,
} from "@dnd-kit/core";
import { memo, useCallback, useMemo, useState, useEffect } from "react";
import { FolderIcon, FileIcon, GripVerticalIcon, FolderOpenIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { readEnvironmentApi } from "~/environmentApi";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import type { EnvironmentId, FilesystemBrowseEntry } from "@t3tools/contracts";
import { stackedThreadToast, toastManager } from "./ui/toast";

interface FileEntry extends FilesystemBrowseEntry {
  isDirectory: boolean;
  depth: number;
  children?: FileEntry[];
}

interface FileNodeProps {
  entry: FileEntry;
  environmentId: EnvironmentId;
  onToggle: (path: string) => void;
  expandedPaths: Set<string>;
  isOver: boolean;
}

function FileNodeLeaf({ entry, environmentId, onToggle, expandedPaths, isOver }: FileNodeProps) {
  const isExpanded = expandedPaths.has(entry.fullPath);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.fullPath,
    data: { entry },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const handleClick = useCallback(() => {
    if (entry.isDirectory) onToggle(entry.fullPath);
  }, [entry.isDirectory, entry.fullPath, onToggle]);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs transition-colors",
        entry.depth > 0 && "ml-[calc(0.75rem_*_var(--depth))]",
        isDragging && "opacity-50",
        isOver && "bg-accent/60 ring-1 ring-primary/40",
        !isDragging && !isOver && "hover:bg-accent/40",
      )}
      style={{ ...style, "--depth": entry.depth } as React.CSSProperties}
      onClick={handleClick}
    >
      <button
        type="button"
        className="cursor-grab touch-none opacity-0 group-hover:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-hidden"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3 text-muted-foreground/40" />
      </button>
      {entry.isDirectory ? (
        isExpanded ? (
          <FolderOpenIcon className="size-3.5 shrink-0 text-amber-500" />
        ) : (
          <FolderIcon className="size-3.5 shrink-0 text-amber-500" />
        )
      ) : (
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
      )}
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
    </div>
  );
}

interface FileTreeProps {
  environmentId?: EnvironmentId;
  cwd?: string;
  className?: string;
}

export const FileTree = memo(function FileTree({ environmentId, cwd, className }: FileTreeProps) {
  const primaryEnvId = usePrimaryEnvironmentId();
  const envId = environmentId ?? primaryEnvId;
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const api = envId ? readEnvironmentApi(envId) : null;

  const loadDirectory = useCallback(async (path: string): Promise<FileEntry[]> => {
    if (!api) return [];
    try {
      const result = await api.filesystem.browse({ partialPath: path, cwd });
      return result.entries.map((e) => ({
        ...e,
        isDirectory: e.fullPath.endsWith("/") || !e.name.includes("."),
        depth: path === "~/" ? 1 : path.split("/").filter(Boolean).length,
      }));
    } catch {
      return [];
    }
  }, [api, cwd]);

  useEffect(() => {
    void loadDirectory("~/").then(setEntries);
  }, [loadDirectory]);

  const handleToggle = useCallback(async (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

    if (!expandedPaths.has(path)) {
      const children = await loadDirectory(path);
      setEntries((prev) =>
        prev.map((e) =>
          e.fullPath === path ? { ...e, children, isDirectory: true } : e,
        ),
      );
    }
  }, [expandedPaths, loadDirectory]);

  const collisionDetection: CollisionDetection = useCallback(
    (args) => pointerWithin(args),
    [],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const activeId = event.active.id as string;
      setActiveId(null);
      setOverId(null);

      if (!event.over) return;
      const overId = event.over.id as string;
      if (activeId === overId) return;

      const targetEntry = entries.find(
        (e) => e.isDirectory && e.fullPath === overId.replace(/^drop-/, ""),
      );
      if (!targetEntry) return;

      const sourceEntry = entries.find((e) => e.fullPath === activeId);
      if (!sourceEntry) return;

      if (!api) return;

      try {
        await api.filesystem.move({
          sourcePath: sourceEntry.fullPath,
          targetDir: targetEntry.fullPath,
        });
        toastManager.add({
          type: "success",
          title: "File moved",
          description: `${sourceEntry.name} → ${targetEntry.fullPath}`,
        });
        void loadDirectory("~/").then(setEntries);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to move file",
            description: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
    },
    [api, entries, loadDirectory],
  );

  const handleDragOver = useCallback((event: { over: { id: string } | null }) => {
    setOverId(event.over?.id ?? null);
  }, []);

  const memoEntries = useMemo(() => {
    const result: FileEntry[] = [];
    const walk = (list: FileEntry[]) => {
      for (const entry of list) {
        result.push(entry);
        if (entry.isDirectory && expandedPaths.has(entry.fullPath) && entry.children) {
          walk(entry.children);
        }
      }
    };
    walk(entries);
    return result;
  }, [entries, expandedPaths]);

  return (
    <div className={cn("select-none text-xs", className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-0.5 py-1">
          {memoEntries.length === 0 && (
            <div className="px-2 py-4 text-center text-muted-foreground/60">
              No files to display
            </div>
          )}
          {memoEntries.map((entry) => (
            <DroppableFileNode
              key={entry.fullPath}
              entry={entry}
              environmentId={envId ?? "local" as EnvironmentId}
              onToggle={handleToggle}
              expandedPaths={expandedPaths}
              isOver={overId === `drop-${entry.fullPath}` && entry.isDirectory}
            />
          ))}
        </div>
        <DragOverlay>
          {activeId ? (
            <div className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs shadow-lg ring-1 ring-border">
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
              <span className="truncate font-medium">{activeId.split("/").pop()}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
});

function DroppableFileNode(props: FileNodeProps) {
  const { entry } = props;
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${entry.fullPath}`,
    data: { entry },
    disabled: !entry.isDirectory,
  });

  return (
    <div ref={entry.isDirectory ? setNodeRef : undefined}>
      <FileNodeLeaf {...props} isOver={isOver || props.isOver} />
    </div>
  );
}
