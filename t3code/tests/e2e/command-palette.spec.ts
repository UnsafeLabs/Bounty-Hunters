import { expect, test } from "@playwright/test";

test("opens the command palette with the keyboard shortcut and filters commands", async ({
  page,
}) => {
  await page.goto("/");

  await page.keyboard.press("ControlOrMeta+K");

  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  await page.getByPlaceholder("Search commands, projects, and threads...").fill("settings");

  await expect(palette.getByText("Open settings", { exact: true })).toBeVisible();
  await expect(palette.getByText("Add project", { exact: true })).toBeHidden();

  await palette.getByText("Open settings", { exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/u);
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
});
