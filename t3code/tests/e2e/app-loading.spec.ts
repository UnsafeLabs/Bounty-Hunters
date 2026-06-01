/**
 * Playwright E2E tests for app loading, command palette, and sidebar.
 */

import { test, expect, Page } from "@playwright/test";

test.describe("App Loading", () => {
  test("should load the application", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/t3code/);
    await expect(page.locator("[data-testid=app-container]")).toBeVisible();
  });

  test("should show loading state", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid=loading-spinner]")).toBeVisible();
    await expect(page.locator("[data-testid=loading-spinner]")).not.toBeVisible({ timeout: 10000 });
  });
});

test.describe("Command Palette", () => {
  test("should open with keyboard shortcut", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await expect(page.locator("[data-testid=command-palette]")).toBeVisible();
  });

  test("should filter commands", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("settings");
    await expect(page.locator("[data-testid=command-item]")).toHaveCount(1);
  });

  test("should execute command on Enter", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await page.keyboard.type("settings");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-testid=settings-panel]")).toBeVisible();
  });
});

test.describe("Sidebar", () => {
  test("should toggle sidebar", async ({ page }) => {
    await page.goto("/");
    await page.click("[data-testid=sidebar-toggle]");
    await expect(page.locator("[data-testid=sidebar]")).not.toBeVisible();
    await page.click("[data-testid=sidebar-toggle]");
    await expect(page.locator("[data-testid=sidebar]")).toBeVisible();
  });

  test("should resize sidebar", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.locator("[data-testid=sidebar]");
    const handle = page.locator("[data-testid=sidebar-resize-handle]");
    const box = await handle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + box.height / 2);
      await page.mouse.up();
    }
    const newBox = await sidebar.boundingBox();
    expect(newBox?.width).toBeLessThan(300);
  });
});
