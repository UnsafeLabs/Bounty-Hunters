import { test, expect } from "@playwright/test";

test("settings dialog opens from the sidebar", async ({ page }) => {
  await page.goto("/");
  const settingsButton = page.locator('a[href*="/settings"]');
  await settingsButton.waitFor({ state: "visible", timeout: 10000 });
  await settingsButton.click();
  await expect(page).toHaveURL(/\/settings/);
});

test("theme can be toggled to dark mode", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("t3code:theme", "dark");
  });
  await page.reload();
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  expect(isDark).toBe(true);
});

test("theme can be toggled to light mode", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("t3code:theme", "light");
  });
  await page.reload();
  const isDark = await page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
  expect(isDark).toBe(false);
});

test("settings page has timestamp format option", async ({ page }) => {
  await page.goto("/settings");
  const timestampSelect = page.locator("select").filter({ hasText: /timestamp/i });
  await expect(timestampSelect).toBeAttached({ timeout: 10000 });
});
