import { expect, test } from "@playwright/test";

test("loads the app shell without browser errors", async ({ page }) => {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });

  await page.goto("/");

  await expect(page).toHaveTitle(/T3 Code/u);
  await expect(page.getByTestId("command-palette-trigger")).toBeVisible();
  await expect(page.getByText("Projects", { exact: true })).toBeVisible();
  await expect(page.getByText("No projects yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  expect(failures).toEqual([]);
});
