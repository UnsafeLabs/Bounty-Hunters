import { test, expect } from "@playwright/test";

// Note: These tests require the web dev server running (npm run dev:web).
// The webServer config in playwright.config.ts handles this automatically.

test.describe("Command Palette", () => {
  test("command palette is not visible by default", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Command palette dialog should not be open
    const commandPalette = page.locator('[data-testid="command-palette"]');
    await expect(commandPalette).toBeHidden();
  });

  test("keyboard shortcut Ctrl+K opens the command palette", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Open with Ctrl+K
    await page.keyboard.press("Control+k");

    // Should now be visible
    const commandPalette = page.locator('[data-testid="command-palette"]');
    await expect(commandPalette).toBeVisible();
  });

  test("Escape closes the command palette", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Open with Ctrl+K
    await page.keyboard.press("Control+k");

    const commandPalette = page.locator('[data-testid="command-palette"]');
    await expect(commandPalette).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(commandPalette).toBeHidden();
  });
});