import { test, expect } from "@playwright/test";

test.describe("App loading", () => {
  test("main layout renders without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The root layout should render without JS errors
    expect(errors).toHaveLength(0);

    // Verify basic DOM elements exist
    await expect(page.locator("#root")).toBeAttached();
  });
});
