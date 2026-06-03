import { test, expect } from "@playwright/test";

test("opens command palette and searches", async ({ page }) => {
  await page.goto("/");

  // Wait for the app to be fully interactive
  const trigger = page.locator('[data-testid="command-palette-trigger"]');
  await expect(trigger).toBeVisible();

  // Click the command palette trigger to open it
  await trigger.click();

  // Assert command palette input is visible
  const input = page.locator('input[placeholder="Search commands, projects, and threads..."]');
  await expect(input).toBeVisible();

  // Type a query
  await input.fill("Settings");

  // Verify that the command palette matches / displays a result for Settings
  const result = page.locator('[data-slot="command-list"]');
  await expect(result).toBeVisible();
  await expect(result).toContainText("Settings");
});
