import { test, expect } from "@playwright/test";

test("app loads and displays the splash screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#boot-shell")).toBeVisible();
  await expect(page.locator("html")).toBeAttached();
});

test("command palette opens with keyboard shortcut", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const commandPalette = page.locator('[role="dialog"]');
  await expect(commandPalette).toBeVisible({ timeout: 5000 });
});

test("command palette closes on Escape", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const commandPalette = page.locator('[role="dialog"]');
  await expect(commandPalette).toBeVisible({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(commandPalette).not.toBeVisible({ timeout: 5000 });
});

test("chat input area is present on the page", async ({ page }) => {
  await page.goto("/");
  const chatInput = page.locator('[contenteditable="true"]');
  await expect(chatInput).toBeAttached({ timeout: 10000 });
});

test("chat input can be focused and typed into", async ({ page }) => {
  await page.goto("/");
  const chatInput = page.locator('[contenteditable="true"]');
  await chatInput.focus();
  await page.keyboard.type("Hello, T3 Code!");
  await expect(chatInput).toContainText("Hello, T3 Code!");
});
