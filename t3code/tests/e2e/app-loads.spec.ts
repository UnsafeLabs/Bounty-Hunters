import { test, expect } from '@playwright/test';

test.describe('App Loading E2E', () => {
  test('should render the main application layout without errors', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/t3code|T3/i);
    await expect(page.locator('body')).toBeVisible();
  });
});
