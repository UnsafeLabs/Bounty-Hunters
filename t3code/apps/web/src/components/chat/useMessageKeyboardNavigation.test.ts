import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMessageKeyboardNavigation } from "./useMessageKeyboardNavigation";

function createMockRow(id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-timeline-root", "true");
  el.setAttribute("role", "listitem");
  el.setAttribute("data-message-id", id);
  el.tabIndex = -1;
  return el;
}

function createContainer(...rows: HTMLElement[]): HTMLDivElement {
  const container = document.createElement("div");
  container.setAttribute("data-messages-container", "true");
  rows.forEach((row) => container.appendChild(row));
  return container;
}

describe("useMessageKeyboardNavigation", () => {
  let container: HTMLDivElement;
  let rows: HTMLElement[];
  let composerEl: HTMLElement;

  beforeEach(() => {
    rows = [createMockRow("m1"), createMockRow("m2"), createMockRow("m3")];
    container = createContainer(...rows);
    document.body.appendChild(container);

    composerEl = document.createElement("textarea");
    composerEl.setAttribute("data-composer", "true");
    document.body.appendChild(composerEl);
  });

  function renderNav(composerRef?: React.RefObject<{ focusAtEnd: () => void } | null>) {
    const containerRef = { current: container };
    const compRef = composerRef ?? { current: { focusAtEnd: vi.fn() } };
    return renderHook(() =>
      useMessageKeyboardNavigation({ containerRef, composerRef: compRef }),
    );
  }

  function keyDown(key: string, target: HTMLElement) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: target });
    container.dispatchEvent(event);
  }

  it("does nothing when focus is outside the container", () => {
    renderNav();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    keyDown("ArrowDown", outside);
    expect(rows[0].tabIndex).toBe(-1);
  });

  it("does nothing when container has no rows", () => {
    const emptyContainer = document.createElement("div");
    document.body.appendChild(emptyContainer);
    const containerRef = { current: emptyContainer };
    const compRef = { current: { focusAtEnd: vi.fn() } };
    renderHook(() =>
      useMessageKeyboardNavigation({ containerRef, composerRef: compRef }),
    );

    // Should not throw
  });

  it("ArrowDown moves focus to next row", () => {
    renderNav();
    rows[0].tabIndex = 0;
    rows[0].focus();

    act(() => {
      keyDown("ArrowDown", rows[0]);
    });

    expect(rows[0].tabIndex).toBe(-1);
    expect(rows[1].tabIndex).toBe(0);
  });

  it("ArrowDown stops at last row", () => {
    renderNav();
    rows[2].tabIndex = 0;
    rows[2].focus();

    act(() => {
      keyDown("ArrowDown", rows[2]);
    });

    expect(rows[2].tabIndex).toBe(0);
  });

  it("ArrowUp moves focus to previous row", () => {
    renderNav();
    rows[1].tabIndex = 0;
    rows[1].focus();

    act(() => {
      keyDown("ArrowUp", rows[1]);
    });

    expect(rows[0].tabIndex).toBe(0);
    expect(rows[1].tabIndex).toBe(-1);
  });

  it("ArrowUp stops at first row", () => {
    renderNav();
    rows[0].tabIndex = 0;
    rows[0].focus();

    act(() => {
      keyDown("ArrowUp", rows[0]);
    });

    expect(rows[0].tabIndex).toBe(0);
  });

  it("Home moves focus to first row", () => {
    renderNav();
    rows[2].tabIndex = 0;
    rows[2].focus();

    act(() => {
      keyDown("Home", rows[2]);
    });

    expect(rows[0].tabIndex).toBe(0);
  });

  it("End moves focus to last row", () => {
    renderNav();
    rows[0].tabIndex = 0;
    rows[0].focus();

    act(() => {
      keyDown("End", rows[0]);
    });

    expect(rows[2].tabIndex).toBe(0);
  });

  it("Escape returns focus to composer", () => {
    const focusAtEnd = vi.fn();
    renderNav({ current: { focusAtEnd } });
    rows[1].tabIndex = 0;
    rows[1].focus();

    act(() => {
      keyDown("Escape", rows[1]);
    });

    expect(focusAtEnd).toHaveBeenCalled();
  });

  it("Enter clicks expand button if present", () => {
    renderNav();
    const expandBtn = document.createElement("button");
    expandBtn.setAttribute("aria-expanded", "false");
    const clickSpy = vi.spyOn(expandBtn, "click");
    rows[0].appendChild(expandBtn);
    rows[0].tabIndex = 0;

    act(() => {
      keyDown("Enter", rows[0]);
    });

    expect(clickSpy).toHaveBeenCalled();
  });
});
