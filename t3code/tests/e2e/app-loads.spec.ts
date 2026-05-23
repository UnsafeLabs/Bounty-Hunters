import { createRequire } from "node:module";

const requireFromWebWorkspace = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { expect, test } = requireFromWebWorkspace("playwright/test");

test("renders the hosted app shell without page errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Connect an environment to get started")).toBeVisible();
  await expect(page.getByText("Add environment")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
