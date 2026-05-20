import { expect, test } from "playwright/test";

test("loads the hosted-static app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/T3 Code \(Latest\)/);
  await expect(page.getByText("Connect an environment to get started")).toBeVisible();
  await expect(page.getByTestId("command-palette-trigger")).toBeVisible();
});
