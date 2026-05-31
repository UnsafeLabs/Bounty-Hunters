import { expect, test } from "@playwright/test";

test("navigates from the sidebar into settings sections", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  await page.getByRole("button", { name: "Keybindings" }).click();
  await expect(page).toHaveURL(/\/settings\/keybindings$/);
  await expect(page.getByRole("heading", { name: "Keybindings" })).toBeVisible();
});
