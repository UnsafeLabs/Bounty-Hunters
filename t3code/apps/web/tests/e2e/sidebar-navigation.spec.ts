import { expect, test } from "@playwright/test";

const settingsSections = [
  {
    button: "General",
    heading: "General",
    path: /\/settings\/general$/,
  },
  {
    button: "Keybindings",
    heading: "Keybindings",
    path: /\/settings\/keybindings$/,
  },
  {
    button: "Connections",
    heading: "Remote environments",
    path: /\/settings\/connections$/,
  },
  {
    button: "Archive",
    heading: "Archived threads",
    path: /\/settings\/archived$/,
  },
] as const;

test("clicks sidebar items and updates the main settings content", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Settings" }).click();

  for (const section of settingsSections) {
    await page.getByRole("button", { name: section.button }).click();
    await expect(page).toHaveURL(section.path);
    await expect(page.getByRole("heading", { name: section.heading, exact: true })).toBeVisible();
  }
});
