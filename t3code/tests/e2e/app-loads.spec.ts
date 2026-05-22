import { test, expect } from '@playwright/test';

test('app renders without errors', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
});
