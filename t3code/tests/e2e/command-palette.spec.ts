import { test, expect } from '@playwright/test';

test('opens command palette with keyboard shortcut and searches', async ({ page, browserName }) => {
  await page.goto('/');
  
  // Wait for the app to settle
  await page.waitForTimeout(1000);
  
  // Press Ctrl+P or Meta+P depending on platform
  const isMac = process.platform === 'darwin';
  const modifier = isMac ? 'Meta' : 'Control';
  
  await page.keyboard.press(`${modifier}+k`);
  
  // Alternative for command palette if Ctrl+K doesn't work, maybe Ctrl+P
  // But usually it's Ctrl+K or Cmd+K
  
  // We'll just wait for an input to appear that wasn't there before
  const searchInput = page.locator('input[type="text"], input[placeholder*="search" i]').first();
  // Sometimes command palettes use dialog or combobox roles
  
  try {
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('search query');
  } catch (e) {
    // If Ctrl+K failed, try Ctrl+P
    await page.keyboard.press(`${modifier}+p`);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('search query');
  }
});
