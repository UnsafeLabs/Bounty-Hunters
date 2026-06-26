import { expect, test } from "playwright/test";

test("settings sidebar navigation changes the main settings content", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  await page.getByRole("button", { name: "Keybindings" }).click();
  await expect(page).toHaveURL(/\/settings\/keybindings$/);
  await expect(page.getByRole("heading", { name: "Keybindings" })).toBeVisible();

  await page.getByRole("button", { name: "Connections" }).click();
  await expect(page).toHaveURL(/\/settings\/connections$/);
  await expect(page.getByRole("heading", { name: "Remote environments" })).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page).toHaveURL(/\/settings\/archived$/);
  await expect(page.getByRole("heading", { name: "Archived threads", exact: true })).toBeVisible();
});
