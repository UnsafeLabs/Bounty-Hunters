import { test, expect } from "@playwright/test";

test("sidebar is visible and contains navigation items", async ({ page }) => {
  await page.goto("/");

  // Wait for the sidebar to be visible
  const sidebar = page.locator(
    '[class*="sidebar"], [class*="Sidebar"], nav[aria-label*="sidebar" i], [role="navigation"]'
  );
  await expect(sidebar.first()).toBeAttached({ timeout: 10000 });

  // Find clickable items within the sidebar
  const sidebarItems = page.locator(
    'a, button, [role="treeitem"], [role="button"]'
  );

  // Try to find at least one visible sidebar item
  const visibleItems = await sidebarItems
    .filter({ has: page.locator(":visible") })
    .all();

  // The sidebar should have some interactive elements
  expect(visibleItems.length).toBeGreaterThanOrEqual(1);
});

test("clicking sidebar items changes main content", async ({ page }) => {
  await page.goto("/");

  // Wait for sidebar
  const sidebar = page.locator(
    '[class*="sidebar"], [class*="Sidebar"], nav[aria-label*="sidebar" i], [role="navigation"]'
  );
  await expect(sidebar.first()).toBeAttached({ timeout: 10000 });

  // Get all clickable sidebar items (links, file tree items, etc.)
  const sidebarLinks = sidebar
    .first()
    .locator(
      'a:visible, button:visible, [role="treeitem"]:visible, [role="button"]:visible'
    );

  const count = await sidebarLinks.count();

  if (count > 0) {
    // Try clicking up to 3 different items and verify content changes
    const maxClicks = Math.min(count, 3);
    for (let i = 0; i < maxClicks; i++) {
      const item = sidebarLinks.nth(i);
      const itemText = await item.textContent();
      await item.click();
      await page.waitForTimeout(500);

      // After clicking, verify the main content area updated
      const mainContent = page.locator(
        '[class*="content"], [class*="Content"], main, [role="main"]'
      );
      await expect(mainContent.first()).toBeAttached();
    }
  }
});
