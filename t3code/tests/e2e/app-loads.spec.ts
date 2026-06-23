import { test, expect } from "@playwright/test";

test.describe("App loading", () => {
    test("app renders without errors", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("#root")).toBeVisible();
        await expect(page.locator(".app-layout")).toBeVisible();
    });
});

test.describe("Command palette", () => {
    test("opens with keyboard shortcut and searches", async ({ page }) => {
        await page.goto("/");
        await page.keyboard.press("Control+K");
        await expect(page.locator("[data-testid='command-palette']")).toBeVisible();
        await page.fill("[data-testid='command-search']", "open");
        await expect(page.locator("[data-testid='command-result']")).toHaveCount.atLeast(1);
    });
});

test.describe("Sidebar navigation", () => {
    test("clicking sidebar items changes content", async ({ page }) => {
        await page.goto("/");
        const items = page.locator("[data-testid='sidebar-item']");
        const count = await items.count();
        for (let i = 0; i < Math.min(3, count); i++) {
            const text = await items.nth(i).textContent();
            await items.nth(i).click();
            await expect(page.locator("[data-testid='main-content']")).toContainText(text || "");
        }
    });
});
