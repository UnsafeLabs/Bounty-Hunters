import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
  clampSidebarWidth,
  type SidebarResolvedResizableOptions,
} from "./sidebar";

function renderSidebarButton(className?: string) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenuButton className={className}>Projects</SidebarMenuButton>
    </SidebarProvider>,
  );
}

describe("sidebar interactive cursors", () => {
  it("uses a pointer cursor for menu buttons by default", () => {
    const html = renderSidebarButton();

    expect(html).toContain('data-slot="sidebar-menu-button"');
    expect(html).toContain("cursor-pointer");
  });

  it("lets project drag handles override the default pointer cursor", () => {
    const html = renderSidebarButton("cursor-grab");

    expect(html).toContain("cursor-grab");
    expect(html).not.toContain("cursor-pointer");
  });

  it("uses a pointer cursor for menu actions", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuAction aria-label="Create thread">
        <span>+</span>
      </SidebarMenuAction>,
    );

    expect(html).toContain('data-slot="sidebar-menu-action"');
    expect(html).toContain("cursor-pointer");
  });

  it("uses a pointer cursor for submenu buttons", () => {
    const html = renderToStaticMarkup(
      <SidebarMenuSubButton render={<button type="button" />}>Show more</SidebarMenuSubButton>,
    );

    expect(html).toContain('data-slot="sidebar-menu-sub-button"');
    expect(html).toContain("cursor-pointer");
  });
});

describe("clampSidebarWidth", () => {
  const makeOptions = (min: number, max: number): SidebarResolvedResizableOptions => ({
    minWidth: min,
    maxWidth: max,
    defaultWidth: 280,
    storageKey: null,
  });

  it("returns width when within min and max bounds", () => {
    expect(clampSidebarWidth(300, makeOptions(200, 500))).toBe(300);
  });

  it("clamps to minWidth when width is below minimum", () => {
    expect(clampSidebarWidth(100, makeOptions(200, 500))).toBe(200);
  });

  it("clamps to maxWidth when width is above maximum", () => {
    expect(clampSidebarWidth(600, makeOptions(200, 500))).toBe(500);
  });

  it("returns minWidth when width equals the minimum", () => {
    expect(clampSidebarWidth(200, makeOptions(200, 500))).toBe(200);
  });

  it("returns maxWidth when width equals the maximum", () => {
    expect(clampSidebarWidth(500, makeOptions(200, 500))).toBe(500);
  });
});
