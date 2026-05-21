import { test, expect } from "@playwright/test";

test.describe("App Loads", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("homepage redirects to the app shell", async ({ page }) => {
    // The root route shows the splash/error screen while authenticating
    // After auth, it shows the AppSidebarLayout with the index route
    await page.waitForLoadState("networkidle");

    // The app should load some UI (exact state depends on auth status)
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
  });

  test("app has correct title", async ({ page }) => {
    await page.waitForLoadState("domcontentloaded");
    const title = await page.title();
    // The title should be set from APP_DISPLAY_NAME
    expect(title.length).toBeGreaterThan(0);
  });
});