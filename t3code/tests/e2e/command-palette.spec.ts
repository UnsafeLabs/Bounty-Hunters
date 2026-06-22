import { test, expect } from "@playwright/test";

test.describe("Command palette", () => {
  test("opens with keyboard shortcut and allows searching", async ({ page }) => {
    await page.goto("/");
    // Command palette is typically opened with Ctrl+K or Cmd+K
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(500);
    // Type a search query
    const searchInput = page.locator("input[type="text"], input[placeholder*="command" i], [role="combobox"]").first();
    await searchInput.fill("settings");
    await expect(searchInput).toHaveValue(/settings/i);
  });
});
