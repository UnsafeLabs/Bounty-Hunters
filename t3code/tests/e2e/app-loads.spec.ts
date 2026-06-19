import { test, expect } from "@playwright/test";

test.describe("App Loading", () => {
  test("app renders without errors", async ({ page }) => {
    await page.goto("/");

    // Wait for the main layout to render
    await page.waitForLoadState("networkidle");

    // Check that the body is visible and has content
    const body = page.locator("body");
    await expect(body).toBeVisible();

    // Check no error boundaries triggered
    const errorText = page.locator("text=/error|crash|something went wrong/i");
    await expect(errorText).toHaveCount(0);

    // Verify the page has meaningful content
    const mainContent = page.locator("main, [role=main], #root, #app").first();
    await expect(mainContent).toBeVisible();
  });
});
