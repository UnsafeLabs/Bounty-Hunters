import { expect, test } from "playwright/test";

test("command palette opens from the keyboard shortcut and filters commands", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("ControlOrMeta+K");

  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  const search = page.getByPlaceholder("Search commands, projects, and threads...");
  await expect(search).toBeFocused();

  await search.fill("settings");

  await expect(search).toHaveValue("settings");
  await expect(palette.getByRole("option", { name: "Open settings" })).toBeVisible();
});
