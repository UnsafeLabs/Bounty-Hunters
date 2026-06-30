import type { CSSProperties } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Sidebar, SidebarProvider, SidebarRail } from "./sidebar";

const STORAGE_KEY = "sidebar-browser-test-width";
const originalMatchMedia = window.matchMedia.bind(window);

async function renderResizableSidebar() {
  window.matchMedia = ((query: string) => {
    if (query.includes("max-width: 767px")) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
      } as MediaQueryList;
    }
    return originalMatchMedia(query);
  }) as typeof window.matchMedia;

  const host = document.createElement("div");
  document.body.append(host);

  const screen = await render(
    <SidebarProvider defaultOpen style={{ "--sidebar-width": "280px" } as CSSProperties}>
      <Sidebar
        side="left"
        collapsible="offcanvas"
        resizable={{
          defaultWidth: 280,
          maxWidth: 500,
          minWidth: 200,
          storageKey: STORAGE_KEY,
        }}
      >
        <div>Sidebar content</div>
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>,
    { container: host },
  );

  const wrapper = host.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']");
  if (!wrapper) {
    throw new Error("Expected sidebar wrapper to render.");
  }

  return {
    wrapper,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("SidebarRail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem(STORAGE_KEY);
    window.matchMedia = originalMatchMedia;
  });

  it("resets the sidebar width to the configured default on double-click", async () => {
    const mounted = await renderResizableSidebar();

    try {
      mounted.wrapper.style.setProperty("--sidebar-width", "420px");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(420));

      await page.getByRole("button", { name: "Resize Sidebar" }).dblClick();

      await vi.waitFor(() => {
        expect(mounted.wrapper.style.getPropertyValue("--sidebar-width")).toBe("280px");
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toBe(280);
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("clamps persisted widths to the configured maximum on mount", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(720));
    const mounted = await renderResizableSidebar();

    try {
      await vi.waitFor(() => {
        expect(mounted.wrapper.style.getPropertyValue("--sidebar-width")).toBe("500px");
      });
    } finally {
      await mounted.cleanup();
    }
  });
});
