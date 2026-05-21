import React, { useState } from "react";
import { DndContext, DragOverlay, type DragEndEvent, type DragStartEvent, useDraggable, useDroppable } from "@dnd-kit/core";

interface FileNode { id: string; name: string; type: "file" | "folder"; children?: FileNode[]; }

function DroppableFolder({ node }: { node: FileNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: node.id });
  return (
    <div ref={setNodeRef} className={"pl-4 py-1 text-sm rounded " + (isOver ? "bg-blue-100 dark:bg-blue-900" : "hover:bg-gray-100 dark:hover:bg-gray-800")}>
      {node.name}/
      {node.children?.map((child) => (child.type === "folder" ? <DroppableFolder key={child.id} node={child} /> : <DraggableFile key={child.id} node={child} />))}
    </div>
  );
}

function DraggableFile({ node }: { node: FileNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: node.id, data: { node } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={"pl-4 py-1 text-sm cursor-grab rounded " + (isDragging ? "opacity-50" : "hover:bg-gray-100 dark:hover:bg-gray-800")}>
      {node.name}
    </div>
  );
}

export function FileTree() {
  const [items] = useState<FileNode[]>([
    { id: "src", name: "src", type: "folder", children: [{ id: "main.ts", name: "main.ts", type: "file" }, { id: "utils.ts", name: "utils.ts", type: "file" }] },
    { id: "docs", name: "docs", type: "folder", children: [{ id: "readme.md", name: "readme.md", type: "file" }] },
  ]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);
  const handleDragEnd = (event: DragEndEvent) => { setActiveId(null); /* filesystem.move logic here */ };

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="file-tree p-2 text-xs font-mono">
        {items.map((node) => (node.type === "folder" ? <DroppableFolder key={node.id} node={node} /> : <DraggableFile key={node.id} node={node} />))}
      </div>
      <DragOverlay>{activeId ? <div className="bg-blue-500 text-white px-2 py-1 rounded text-xs">Moving...</div> : null}</DragOverlay>
    </DndContext>
  );
}
