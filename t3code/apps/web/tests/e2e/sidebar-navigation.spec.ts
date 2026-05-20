import { expect, test } from "playwright/test";

test("navigates from the sidebar to settings", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("main").getByRole("heading", { name: "General" })).toBeVisible();
  await expect(page.getByRole("button", { name: "General" })).toBeVisible();
});
