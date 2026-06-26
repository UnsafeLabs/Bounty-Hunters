import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { Sidebar, SidebarProvider, SidebarRail } from "./sidebar";

const STORAGE_KEY = "t3code:test:sidebar-width";

describe("SidebarRail resizable behavior", () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    document.body.innerHTML = "";
  });

  it("resets a persisted sidebar width to the configured default on double click", async () => {
    await page.viewport(1280, 800);
    localStorage.setItem(STORAGE_KEY, "420");
    const onResize = vi.fn();

    const screen = await render(
      <SidebarProvider defaultOpen>
        <Sidebar
          collapsible="offcanvas"
          resizable={{
            defaultWidth: 280,
            maxWidth: 500,
            minWidth: 200,
            onResize,
            storageKey: STORAGE_KEY,
          }}
        >
          <div>Navigation</div>
          <SidebarRail />
        </Sidebar>
        <main>Content</main>
      </SidebarProvider>,
    );

    try {
      const wrapper = document.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']");
      expect(wrapper).not.toBeNull();

      await vi.waitFor(() => {
        expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("420px");
      });

      const rail = document.querySelector<HTMLButtonElement>("[data-slot='sidebar-rail']");
      expect(rail).not.toBeNull();
      rail?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

      await vi.waitFor(() => {
        expect(wrapper?.style.getPropertyValue("--sidebar-width")).toBe("280px");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("280");
      });
      expect(onResize).toHaveBeenLastCalledWith(280);
    } finally {
      await screen.unmount();
    }
  });
});
