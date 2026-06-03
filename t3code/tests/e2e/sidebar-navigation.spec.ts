import { test, expect } from "@playwright/test";
import { login } from "./auth";

test("sidebar navigation clicks items and changes content", async ({ page }) => {
  await login(page);

  // 1. Click Search button -> Opens Command Palette
  const searchButton = page.locator('[data-testid="command-palette-trigger"]');
  await expect(searchButton).toBeVisible();
  await searchButton.click();
  await expect(page.locator('input[placeholder="Search commands, projects, and threads..."]')).toBeVisible();
  await page.keyboard.press("Escape");

  // 2. Click Add Project button -> Opens Project Import path input
  const addProjectButton = page.locator('[data-testid="sidebar-add-project-trigger"]');
  await expect(addProjectButton).toBeVisible();
  await addProjectButton.click();
  await page.locator('text="Local folder"').click();
  await expect(page.locator('input[placeholder="Enter path (e.g. ~/projects/my-app)"]')).toBeVisible();
  await page.keyboard.press("Escape");

  // 3. Click Settings button -> Navigates to /settings page
  const settingsButton = page.locator('[data-testid="settings-button"]');
  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
  await expect(page).toHaveURL(/\/settings/);
});
