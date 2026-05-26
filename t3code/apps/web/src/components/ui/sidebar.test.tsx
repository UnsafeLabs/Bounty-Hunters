import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Sidebar,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSubButton,
  SidebarProvider,
  SidebarRail,
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

describe("sidebar resizing", () => {
  it("renders a desktop resize handle with double-click reset affordance", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar resizable>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    expect(html).toContain('data-slot="sidebar-rail"');
    expect(html).toContain('aria-label="Resize Sidebar"');
    expect(html).toContain("Double-click to reset");
    expect(html).toContain("hover:after:bg-sidebar-ring/60");
  });

  it("uses 280px as the default sidebar width", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Sidebar resizable>
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>,
    );

    expect(html).toContain("--sidebar-width:280px");
  });
});
