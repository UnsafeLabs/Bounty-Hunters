import { test, expect } from "@playwright/test";

test.describe("App Loading", () => {
  test("should load the application and display the page title", async ({ page }) => {
    await page.goto("/");
    // Wait for the React app to hydrate
    await page.waitForLoadState("networkidle");

    // Verify the page has the T3 Code title
    const title = await page.title();
    expect(title).toBeTruthy();

    // Verify the page renders content (no blank screen)
    const bodyContent = await page.locator("body").innerText();
    expect(bodyContent.length).toBeGreaterThan(0);
  });

  test("should render the app shell with correct structure", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for the root element that React renders into
    const rootEl = page.locator("#root");
    await expect(rootEl).toBeAttached({ timeout: 10000 });

    // Verify the body has content beyond the loading state
    await expect(page.locator("body")).not.toHaveText("Loading", { timeout: 10000 });
  });

  test("should not show console errors during initial load", async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Allow a brief moment for any async errors to surface
    await page.waitForTimeout(2000);

    // We expect minimal or no console errors during initial load
    // Some errors may be expected (e.g. WebSocket connection refused in dev),
    // but there should be no uncaught exceptions
    const uncaughtErrors = consoleErrors.filter(
      (e) =>
        !e.includes("WebSocket") &&
        !e.includes("ws://") &&
        !e.includes("Failed to load resource")
    );

    expect(uncaughtErrors.length).toBe(0);
  });
});