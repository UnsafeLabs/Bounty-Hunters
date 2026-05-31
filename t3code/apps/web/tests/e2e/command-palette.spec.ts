import { expect, test } from "@playwright/test";

test("opens and filters the command palette", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("command-palette-trigger").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();

  const searchInput = page.getByRole("combobox", {
    name: "Search commands, projects, and threads...",
  });
  await searchInput.fill("settings");

  await expect(page.getByRole("option", { name: "Open settings" })).toBeVisible();
});
