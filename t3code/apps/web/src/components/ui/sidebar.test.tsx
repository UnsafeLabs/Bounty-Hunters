import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Sidebar,
  SidebarRail,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
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

  it("renders the desktop resize rail with drag and reset affordances", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar resizable={{ defaultWidth: 280, maxWidth: 500, minWidth: 200 }}>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    expect(html).toContain('aria-label="Resize Sidebar"');
    expect(html).toContain('title="Drag to resize sidebar. Double-click to reset."');
    expect(html).toContain("cursor-col-resize");
    expect(html).toContain("hover:after:bg-sidebar-ring");
  });
});
