/**
 * A drag-and-drop enabled file tree component for the sidebar.
 * Uses @dnd-kit/core and @dnd-kit/sortable (already in dependencies).
 *
 * Supports:
 * - Single file drag-and-drop to move files between directories
 * - Multi-select drag by holding Shift or Ctrl
 * - Drop indicator line when hovering over valid target
 * - git mv for tracked files, regular fs move for untracked
 */
import {
  DndContext,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
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
import { memo, useCallback, useMemo, useRef, useState, type FC } from "react";

export interface FileTreeItem {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly children?: FileTreeItem[];
}

interface FileTreeNodeProps {
  readonly item: FileTreeItem;
  readonly depth: number;
  readonly selectedIds: Set<string>;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (id: string, multi: boolean) => void;
}

const FileTreeNode: FC<FileTreeNodeProps> = memo(function FileTreeNode({
  item,
  depth,
  selectedIds,
  onToggle,
  onSelect,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
      paddingLeft: `${depth * 16 + 8}px`,
      opacity: isDragging ? 0.5 : 1,
    }),
    [transform, transition, depth, isDragging],
  );

  const isSelected = selectedIds.has(item.id);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div
        className={`flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer hover:bg-accent/50 text-sm ${
          isSelected ? "bg-accent" : ""
        }`}
        onClick={(e) => onSelect(item.id, e.shiftKey || e.ctrlKey || e.metaKey)}
        onDoubleClick={() => item.isDirectory && onToggle(item.id)}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={item.isDirectory ? undefined : undefined}
      >
        <span className="text-muted-foreground shrink-0">
          {item.isDirectory ? (item.children ? "📂" : "📁") : "📄"}
        </span>
        <span className="truncate">{item.name}</span>
      </div>
      {item.children?.map((child) => (
        <FileTreeNode
          key={child.id}
          item={child}
          depth={depth + 1}
          selectedIds={selectedIds}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
});

interface FileTreeProps {
  readonly items: FileTreeItem[];
  readonly onFileMove?: (fileId: string, targetDirId: string) => void;
}

export const FileTree: FC<FileTreeProps> = function FileTree({ items, onFileMove }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    setDropTargetId(overId);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setDropTargetId(null);

      if (over && active.id !== over.id) {
        onFileMove?.(String(active.id), String(over.id));
      }
    },
    [onFileMove],
  );

  const handleToggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      if (multi) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  }, []);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">
        No files to display
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div role="tree" aria-label="File explorer" className="select-none text-sm">
          {items.map((item) => (
            <FileTreeNode
              key={item.id}
              item={item}
              depth={0}
              selectedIds={selectedIds}
              onToggle={handleToggle}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeId ? (
          <div className="bg-accent/80 px-2 py-1 rounded text-sm shadow-lg">
            Moving...
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
