import { expect, test } from "playwright/test";

test("hosted-static app loads the main layout without browser errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page).toHaveTitle(/T3 Code/);
  await expect(page.getByText("Connect an environment to get started")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add environment" })).toBeVisible();
  await expect(page.getByTestId("command-palette-trigger")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
