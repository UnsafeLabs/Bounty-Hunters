import { test, expect } from '@playwright/test';

test.describe('Command Palette E2E', () => {
  test('should open command palette with keyboard shortcut and type search query', async ({ page }) => {
    await page.goto('/');
    
    // Dispara atalho de teclado (Cmd+K ou Ctrl+K)
    await page.keyboard.press('Control+k');
    
    const paletteInput = page.locator('[placeholder*="command" i], [role="combobox"], input[type="text"]').first();
    await expect(paletteInput).toBeVisible();
    await paletteInput.fill('Settings');
    await expect(paletteInput).toHaveValue('Settings');
  });
});
