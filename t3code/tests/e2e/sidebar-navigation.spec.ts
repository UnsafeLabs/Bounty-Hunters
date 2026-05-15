import { expect, test } from "@playwright/test";

test("clicks settings sidebar items and updates the main content", async ({ page }) => {
  await page.goto("/settings/general");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  await page.getByRole("button", { name: "Keybindings" }).click();
  await expect(page).toHaveURL(/\/settings\/keybindings$/u);
  await expect(page.getByRole("heading", { name: "Keybindings" })).toBeVisible();

  await page.getByRole("button", { name: "Providers" }).click();
  await expect(page).toHaveURL(/\/settings\/providers$/u);
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();

  await page.getByRole("button", { name: "Source Control" }).click();
  await expect(page).toHaveURL(/\/settings\/source-control$/u);
  await expect(page.getByRole("heading", { name: "Server environment" })).toBeVisible();
});
