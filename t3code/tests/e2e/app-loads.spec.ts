import { test, expect } from "@playwright/test";

test.describe("App loads", () => {
  test("main layout renders without errors", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeAttached();
    await expect(page).toHaveURL(/.*localhost:3773/);
  });
});
