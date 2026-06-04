import { test, expect } from "@playwright/test";
import { login } from "./auth";

test("opens command palette and searches", async ({ page }) => {
  await login(page);

  // Wait for the app to be fully interactive
  const trigger = page.locator('[data-testid="command-palette-trigger"]');
  await expect(trigger).toBeVisible();

  // Open command palette using keyboard shortcut (mod+k)
  const isMac = await page.evaluate(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);
  if (isMac) {
    await page.keyboard.press("Meta+k");
  } else {
    await page.keyboard.press("Control+k");
  }

  // Assert command palette input is visible
  const input = page.locator('input[placeholder="Search commands, projects, and threads..."]');
  await expect(input).toBeVisible();

  // Type a query
  await input.fill("Settings");

  // Verify that the command palette matches / displays a result for Settings
  const result = page.locator('[data-slot="command-list"]');
  await expect(result).toBeVisible();
  await expect(result).toContainText("settings", { ignoreCase: true });
});
