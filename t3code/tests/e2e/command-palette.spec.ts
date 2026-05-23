import { createRequire } from "node:module";

const requireFromWebWorkspace = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { expect, test } = requireFromWebWorkspace("playwright/test");

test("opens the command palette with the keyboard shortcut and searches commands", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.keyboard.press("Control+K");

  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();

  await palette.locator("input").first().fill("settings");

  await expect(palette.getByText("Open settings")).toBeVisible();
});
