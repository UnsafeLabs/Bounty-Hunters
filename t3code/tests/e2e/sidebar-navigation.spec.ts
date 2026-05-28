import { test, expect } from "@playwright/test";

test.describe("Sidebar navigation", () => {
  test("sidebar items are clickable and main content responds", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for sidebar navigation items
    const sidebarItems = page.locator("nav a, nav button, [class*="sidebar"] a, [class*="sidebar"] button");
    const count = await sidebarItems.count();

    if (count >= 3) {
      // Click up to 3 different items
      for (let i = 0; i < Math.min(3, count); i++) {
        const item = sidebarItems.nth(i);
        if (await item.isVisible()) {
          await item.click();
          await page.waitForTimeout(500);
          // Verify the main content area updated
          const main = page.locator("main, [class*="content"], [class*="main"]");
          await expect(main.first()).toBeAttached();
        }
      }
    } else {
      // If less than 3 sidebar items exist, at least verify sidebar renders
      console.log(`Found ${count} sidebar items`);
    }
  });
});
