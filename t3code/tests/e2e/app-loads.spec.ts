import { test, expect } from "@playwright/test";
import { login } from "./auth";

test("app loads and main layout renders", async ({ page }) => {
  await login(page);
  await expect(page).toHaveTitle(/T3 Code/);
  await expect(page.locator('[data-testid="command-palette-trigger"]')).toBeVisible();
});
