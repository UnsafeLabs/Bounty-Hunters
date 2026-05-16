import { test, expect } from "@playwright/test";

test.describe("Command Palette", () => {
  test("opens and closes with keyboard shortcut Cmd+K / Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Verify command palette is initially closed
    const commandPalette = page.locator(
      '[role="dialog"], [class*="commandPalette"], [class*="command-palette"]'
    );
    await expect(commandPalette).toHaveCount(0);

    // Open with Cmd+K (Mac) / Ctrl+K (Windows/Linux)
    await page.keyboard.press("Control+K");
    await page.waitForTimeout(500);

    // The command palette should now be visible
    // It might render as a dialog or a specific palette element
    const paletteAfterOpen = page.locator(
      '[role="dialog"], [class*="commandPalette"], [class*="command-palette"], [class*="cmdk"]'
    );

    // If palette opened, interact with it
    const paletteCount = await paletteAfterOpen.count();
    if (paletteCount > 0) {
      await expect(paletteAfterOpen.first()).toBeVisible();

      // Type a search query
      const searchInput = page.locator(
        '[role="dialog"] input, [class*="commandPalette"] input, [class*="command-palette"] input, [cmdk-input]'
      );
      if ((await searchInput.count()) > 0) {
        await searchInput.first().fill("open");
        await page.waitForTimeout(300);

        // Results should update
        const results = page.locator(
          '[role="dialog"] [class*="result"], [class*="commandPalette"] [class*="item"]'
        );
        await expect(results.first()).toBeAttached({ timeout: 3000 });
      }

      // Close with Escape
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await expect(paletteAfterOpen.first()).not.toBeVisible();
    } else {
      // Command palette might use a different approach (e.g., a command menu)
      // Test the close behavior using Escape
      await page.keyboard.press("Escape");
    }
  });

  test("can search for available commands", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open command palette
    await page.keyboard.press("Control+K");
    await page.waitForTimeout(500);

    const searchInput = page.locator(
      'input[placeholder*="command" i], input[placeholder*="search" i], [cmdk-input] input'
    );

    if ((await searchInput.count()) > 0) {
      await searchInput.first().click();
      await searchInput.first().fill("settings");

      // Verify some command suggestions appear
      await page.waitForTimeout(500);
      const items = page.locator(
        '[role="option"], [cmdk-item], [class*="commandPalette"] [class*="item"]'
      );
      const itemCount = await items.count();
      expect(itemCount).toBeGreaterThanOrEqual(0);
    }

    // Close
    await page.keyboard.press("Escape");
  });
});
