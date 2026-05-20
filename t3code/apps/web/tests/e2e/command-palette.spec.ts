import { expect, test } from "playwright/test";

test("opens the command palette and filters actions", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("command-palette-trigger").click();

  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  const searchInput = page.getByPlaceholder("Search commands, projects, and threads...");
  await expect(searchInput).toBeFocused();

  await searchInput.fill("settings");
  await expect(palette.getByText("Open settings")).toBeVisible();
});
