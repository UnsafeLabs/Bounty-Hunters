import { createRequire } from "node:module";

const requireFromWebWorkspace = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { expect, test } = requireFromWebWorkspace("playwright/test");

const sidebarItems = [
  { name: "Keybindings", path: "/settings/keybindings" },
  { name: "Providers", path: "/settings/providers" },
  { name: "General", path: "/settings/general" },
] as const;

test("navigates between settings sidebar items", async ({ page }) => {
  await page.goto("/settings/general", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

  for (const item of sidebarItems) {
    await page.getByRole("button", { name: item.name }).click();

    await expect(page).toHaveURL(new RegExp(`${item.path}$`));
    await expect(page.getByRole("heading", { name: item.name })).toBeVisible();
  }
});
