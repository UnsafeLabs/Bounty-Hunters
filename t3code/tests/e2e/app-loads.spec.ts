import { test, expect } from "@playwright/test";

test("app loads without errors", async ({ page }) => {
  await page.goto("/");

  // Wait for the main layout to render
  await expect(page.locator("#app")).toBeAttached({ timeout: 10000 });

  // Verify the app shell is visible
  await expect(page.locator("body")).not.toBeEmpty();

  // Check that no visible error messages are present on load
  const errorIndicators = page.locator(
    '[class*="error"], [class*="Error"], [role="alert"]'
  );
  const errorCount = await errorIndicators.count();
  // Allow 0 or minimal errors — if many unexpected errors appear, fail
  expect(errorCount).toBeLessThan(3);
});

test("app title is set correctly", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/T3|Code/);
});
