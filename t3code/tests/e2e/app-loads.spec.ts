import { test, expect } from "@playwright/test";

test.describe("App Loading", () => {
  test("main layout renders without errors", async ({ page }) => {
    // Track uncaught errors
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");

    // Wait for the React app to mount
    await expect(page.locator("#root")).not.toBeEmpty();

    // The app should have a sidebar and main content area
    await expect(page.locator("nav")).toBeAttached({ timeout: 10000 });

    // Verify the app title is set in the document
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // No uncaught errors should have occurred
    expect(errors).toHaveLength(0);
  });

  test("page has the correct content structure", async ({ page }) => {
    await page.goto("/");

    // The page should render a sidebar with thread list content
    const sidebar = page.locator("nav, [class*='sidebar']").first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // Main content area should be visible
    const main = page.locator("main, [class*='content'], #root > div > *").last();
    await expect(main).toBeVisible();

    // Console should not have critical errors
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForTimeout(2000);
    expect(consoleErrors.length).toBeLessThanOrEqual(0);
  });
});
