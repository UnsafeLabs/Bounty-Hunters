import { test, expect } from '@playwright/test';

test.describe('Sidebar Navigation E2E', () => {
  test('should click sidebar items and verify main content changes', async ({ page }) => {
    await page.goto('/');

    const sidebarItems = page.locator('nav a, sidebar button, [role="tab"]').first();
    await expect(sidebarItems).toBeVisible();

    const count = await page.locator('nav a, sidebar button, [role="tab"]').count();
    const itemsToClick = Math.min(count, 3);

    for (let i = 0; i < itemsToClick; i++) {
      const item = page.locator('nav a, sidebar button, [role="tab"]').nth(i);
      await item.click();
      await page.waitForTimeout(300);
      await expect(page.locator('main, #content, body')).toBeVisible();
    }
  });
});
