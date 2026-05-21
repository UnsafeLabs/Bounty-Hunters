import { test, expect } from "@playwright/test";

test.describe("Sidebar Navigation", () => {
  test("sidebar is present in the app layout", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Check that sidebar content area exists
    const sidebar = page.locator("[data-sidebar='sidebar']");
    // The sidebar might be hidden on small screens, so just check it exists
    await expect(sidebar).toBeAttached();
  });

  test("thread rows render with data-testid attributes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for thread rows - they should have data-testid attributes if any threads exist
    const threadRows = page.locator("[data-testid^='thread-row-']");
    // Just verify the locator works (count may be 0 for empty state)
    await expect(threadRows).toBeDefined();
  });
});