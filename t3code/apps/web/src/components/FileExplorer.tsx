import { memo, useCallback, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FolderIcon, FileIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "directory";
  path: string;
  children?: FileNode[];
  isGitTracked?: boolean;
}

interface FileExplorerProps {
  files: FileNode[];
  onMoveFile: (sourcePath: string, targetPath: string) => Promise<void>;
  onMultiSelect?: (files: string[]) => void;
}

interface SortableFileItemProps {
  file: FileNode;
  depth: number;
  onMoveFile: (sourcePath: string, targetPath: string) => Promise<void>;
  selectedFiles: Set<string>;
  onToggleSelect: (fileId: string, multiSelect: boolean) => void;
}

const SortableFileItem = memo(function SortableFileItem({
  file,
  depth,
  onMoveFile,
  selectedFiles,
  onToggleSelect,
}: SortableFileItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: file.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: `${depth * 16 + 8}px`,
  };

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (file.type === "directory") {
        setIsExpanded(!isExpanded);
      }
      onToggleSelect(file.id, event.shiftKey || event.ctrlKey || event.metaKey);
    },
    [file.type, file.id, isExpanded, onToggleSelect],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (file.type === "directory") {
        setIsDropTarget(true);
      }
    },
    [file.type],
  );

  const handleDragLeave = useCallback(() => {
    setIsDropTarget(false);
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDropTarget(false);

      if (file.type !== "directory") return;

      const sourceIds = Array.from(selectedFiles);
      for (const sourceId of sourceIds) {
        // In real implementation, would look up file by ID
        const sourcePath = sourceId; // Simplified
        const targetPath = file.path;
        await onMoveFile(sourcePath, targetPath);
      }
    },
    [file.type, file.path, selectedFiles, onMoveFile],
  );

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex items-center gap-2 rounded-md py-1 px-2 cursor-pointer transition-colors",
          isDragging && "opacity-50",
          isDropTarget && "bg-accent ring-2 ring-primary",
          selectedFiles.has(file.id) && "bg-secondary",
          "hover:bg-accent/50",
        )}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {file.type === "directory" && (
          <ChevronRightIcon
            className={cn(
              "size-4 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        )}
        {file.type === "directory" ? (
          <FolderIcon className="size-4 text-blue-500" />
        ) : (
          <FileIcon className="size-4 text-gray-500" />
        )}
        <span className="text-sm truncate">{file.name}</span>
        {file.isGitTracked && (
          <span className="text-xs text-green-600 ml-auto">git</span>
        )}
      </div>

      {file.type === "directory" && isExpanded && file.children && (
        <SortableContext
          items={file.children.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {file.children.map((child) => (
            <SortableFileItem
              key={child.id}
              file={child}
              depth={depth + 1}
              onMoveFile={onMoveFile}
              selectedFiles={selectedFiles}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </SortableContext>
      )}
    </>
  );
});

export const FileExplorer = memo(function FileExplorer({
  files,
  onMoveFile,
  onMultiSelect,
}: FileExplorerProps) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    // If dragging an unselected item, select it first
    if (!selectedFiles.has(active.id as string)) {
      setSelectedFiles(new Set([active.id as string]));
    }
  }, [selectedFiles]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over) return;

      const sourceId = active.id as string;
      const targetId = over.id as string;

      // Find target directory
      const findDirectory = (nodes: FileNode[], id: string): FileNode | null => {
        for (const node of nodes) {
          if (node.id === id && node.type === "directory") return node;
          if (node.children) {
            const found = findDirectory(node.children, id);
            if (found) return found;
          }
        }
        return null;
      };

      const targetDir = findDirectory(files, targetId);
      if (!targetDir) return;

      // Move selected files
      const filesToMove = selectedFiles.has(sourceId)
        ? Array.from(selectedFiles)
        : [sourceId];

      for (const fileId of filesToMove) {
        await onMoveFile(fileId, targetDir.path);
      }

      setSelectedFiles(new Set());
    },
    [files, selectedFiles, onMoveFile],
  );

  const handleToggleSelect = useCallback(
    (fileId: string, multiSelect: boolean) => {
      setSelectedFiles((current) => {
        const next = new Set(multiSelect ? current : []);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        onMultiSelect?.(Array.from(next));
        return next;
      });
    },
    [onMultiSelect],
  );

  const allFileIds = useMemo(() => {
    const ids: string[] = [];
    const collectIds = (nodes: FileNode[]) => {
      for (const node of nodes) {
        ids.push(node.id);
        if (node.children) collectIds(node.children);
      }
    };
    collectIds(files);
    return ids;
  }, [files]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={allFileIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-0.5">
          {files.map((file) => (
            <SortableFileItem
              key={file.id}
              file={file}
              depth={0}
              onMoveFile={onMoveFile}
              selectedFiles={selectedFiles}
              onToggleSelect={handleToggleSelect}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
});

// Undo support
export class FileMoveUndoStack {
  private stack: Array<{ source: string; target: string }> = [];

  push(source: string, target: string) {
    this.stack.push({ source, target });
  }

  async undo(onMoveFile: (source: string, target: string) => Promise<void>): Promise<boolean> {
    const last = this.stack.pop();
    if (!last) return false;

    // Move back from target to source's parent
    await onMoveFile(last.target, last.source);
    return true;
  }

  clear() {
    this.stack = [];
  }
}
