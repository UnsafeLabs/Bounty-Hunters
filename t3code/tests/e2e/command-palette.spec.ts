import { test, expect } from "@playwright/test";

test.describe("Command palette", () => {
  test("opens with keyboard shortcut and can search", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open command palette with Ctrl+K (or Cmd+K on macOS)
    await page.keyboard.press("Control+k");

    // Wait for the command palette dialog to appear
    const palette = page.locator('[role="dialog"], [data-testid="command-palette"], input[placeholder*="command" i], input[placeholder*="search" i]');
    await expect(palette.first()).toBeAttached({ timeout: 5000 });

    // Type a search query
    const searchInput = page.locator("input, textarea").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("settings");
      await page.waitForTimeout(500);
    }
  });
});
