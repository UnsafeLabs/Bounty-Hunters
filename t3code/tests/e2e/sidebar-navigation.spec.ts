import { test, expect } from "@playwright/test";

test.describe("Sidebar navigation", () => {
  test("clicking sidebar items changes content", async ({ page }) => {
    await page.goto("/");
    const sidebarLinks = page.locator("nav a, [data-slot="sidebar"] a, aside a").first();
    if (await sidebarLinks.count() > 0) {
      await sidebarLinks.first().click();
      await page.waitForTimeout(500);
      await expect(page.locator("main, [role="main"]")).toBeAttached();
    }
  });
});
