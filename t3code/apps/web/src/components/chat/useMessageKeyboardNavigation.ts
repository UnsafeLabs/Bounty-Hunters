import { useCallback, useEffect, useRef } from "react";

/**
 * Keyboard navigation hook for the messages timeline.
 * Implements roving tabindex pattern for ArrowUp/ArrowDown navigation
 * between message rows, Enter to expand, and Escape to return focus to composer.
 */
export function useMessageKeyboardNavigation({
  containerRef,
  composerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  composerRef?: React.RefObject<{ focusAtEnd: () => void } | null>;
}) {
  const focusedIndexRef = useRef<number>(-1);

  const getFocusableRows = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(
        '[data-timeline-root="true"][role="listitem"]',
      ),
    );
  }, [containerRef]);

  const focusRow = useCallback(
    (index: number) => {
      const rows = getFocusableRows();
      if (rows.length === 0) return;

      const clampedIndex = Math.max(0, Math.min(index, rows.length - 1));

      // Roving tabindex: set all to -1, target to 0
      for (let i = 0; i < rows.length; i++) {
        rows[i].tabIndex = i === clampedIndex ? 0 : -1;
      }

      rows[clampedIndex].focus();
      focusedIndexRef.current = clampedIndex;
    },
    [getFocusableRows],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent | KeyboardEvent) => {
      const target = event.target as HTMLElement;
      // Only handle if focus is within the messages container
      if (!containerRef.current?.contains(target)) return;

      const rows = getFocusableRows();
      if (rows.length === 0) return;

      const currentIndex = rows.indexOf(target as HTMLElement);
      if (currentIndex === -1) return;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex = Math.min(currentIndex + 1, rows.length - 1);
          focusRow(nextIndex);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          focusRow(prevIndex);
          break;
        }
        case "Enter": {
          // Toggle expand/collapse if the row has an expand button
          const expandButton = target.querySelector<HTMLElement>(
            'button[aria-expanded]',
          );
          if (expandButton) {
            event.preventDefault();
            expandButton.click();
          }
          break;
        }
        case "Escape": {
          event.preventDefault();
          // Return focus to composer
          if (composerRef?.current) {
            composerRef.current.focusAtEnd();
          }
          break;
        }
        case "Home": {
          event.preventDefault();
          focusRow(0);
          break;
        }
        case "End": {
          event.preventDefault();
          focusRow(rows.length - 1);
          break;
        }
      }
    },
    [containerRef, composerRef, getFocusableRows, focusRow],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
    };
  }, [containerRef, handleKeyDown]);

  return { focusRow, getFocusableRows };
}
