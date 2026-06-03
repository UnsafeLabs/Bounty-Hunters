import { test, expect } from "@playwright/test";

test("app loads and main layout renders", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/T3 Code/);
  await expect(page.locator('[data-testid="command-palette-trigger"]')).toBeVisible();
});
