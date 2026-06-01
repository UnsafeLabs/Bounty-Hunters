/**
 * Drag-and-drop file moving in sidebar file tree.
 */

import { useState, useCallback, useRef } from "react";

interface DragState {
  sourcePath: string;
  targetPath: string | null;
  position: "before" | "inside" | "after";
}

export function useFileDragDrop(onMove: (source: string, dest: string) => Promise<void>) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<string | null>(null);

  const handleDragStart = useCallback((path: string, e: React.DragEvent) => {
    dragRef.current = path;
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((targetPath: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const position = y < rect.height * 0.25 ? "before" : y > rect.height * 0.75 ? "after" : "inside";
    setDragState({ sourcePath: dragRef.current || "", targetPath, position });
  }, []);

  const handleDrop = useCallback(async (targetPath: string, e: React.DragEvent) => {
    e.preventDefault();
    const source = e.dataTransfer.getData("text/plain");
    if (source && source !== targetPath) {
      const destDir = dragState?.position === "inside" ? targetPath : targetPath.split("/").slice(0, -1).join("/");
      await onMove(source, destDir);
    }
    setDragState(null);
    dragRef.current = null;
  }, [dragState, onMove]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    dragRef.current = null;
  }, []);

  return { dragState, handleDragStart, handleDragOver, handleDrop, handleDragEnd };
}
