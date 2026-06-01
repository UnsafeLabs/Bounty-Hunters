/**
 * Resizable sidebar with drag handle and persisted width.
 */

import { useState, useCallback, useRef, useEffect } from "react";

interface UseResizableSidebarOptions {
  /** Default width in pixels (default: 260) */
  defaultWidth?: number;
  /** Minimum width (default: 180) */
  minWidth?: number;
  /** Maximum width (default: 500) */
  maxWidth?: number;
  /** Storage key for persistence */
  storageKey?: string;
}

export function useResizableSidebar(options: UseResizableSidebarOptions = {}) {
  const {
    defaultWidth = 260,
    minWidth = 180,
    maxWidth = 500,
    storageKey = "sidebar-width",
  } = options;

  const [width, setWidth] = useState(() => {
    if (typeof window !== "undefined" && storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return defaultWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
    },
    [width]
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (storageKey) {
        localStorage.setItem(storageKey, width.toString());
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, width, minWidth, maxWidth, storageKey]);

  return {
    width,
    isResizing,
    handleMouseDown,
  };
}
