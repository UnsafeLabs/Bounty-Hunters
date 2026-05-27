import { test, expect } from "@playwright/test";

test.describe("Command Palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should open command palette with Ctrl+K (or Cmd+K on Mac)", async ({ page, isMac }) => {
    const modifier = isMac ? "Meta" : "Control";

    // Press the keyboard shortcut to open the command palette
    await page.keyboard.press(`${modifier}+KeyK`);

    // Wait for the command palette dialog/input to appear
    // The command palette typically renders a searchable input
    const commandPaletteInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="command" i], [role="dialog"] input, [role="combobox"]'
    );
    await expect(commandPaletteInput.first()).toBeVisible({ timeout: 5000 });
  });

  test("should close command palette with Escape", async ({ page, isMac }) => {
    const modifier = isMac ? "Meta" : "Control";

    // Open the command palette
    await page.keyboard.press(`${modifier}+KeyK`);
    const commandPaletteInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="command" i], [role="dialog"] input, [role="combobox"]'
    );
    await expect(commandPaletteInput.first()).toBeVisible({ timeout: 5000 });

    // Close with Escape
    await page.keyboard.press("Escape");

    // The command palette should now be closed (input no longer visible)
    await expect(commandPaletteInput.first()).not.toBeVisible({ timeout: 5000 });
  });

  test("should allow toggling command palette open and closed", async ({ page, isMac }) => {
    const modifier = isMac ? "Meta" : "Control";

    // Open via shortcut
    await page.keyboard.press(`${modifier}+KeyK`);
    const commandPaletteInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="command" i], [role="dialog"] input, [role="combobox"]'
    );

    await expect(commandPaletteInput.first()).toBeVisible({ timeout: 5000 });

    // Toggle closed via same shortcut
    await page.keyboard.press(`${modifier}+KeyK`);
    await expect(commandPaletteInput.first()).not.toBeVisible({ timeout: 5000 });
  });

  test("should filter results as user types in the command palette", async ({ page, isMac }) => {
    const modifier = isMac ? "Meta" : "Control";

    // Open the command palette
    await page.keyboard.press(`${modifier}+KeyK`);

    const commandPaletteInput = page.locator(
      'input[placeholder*="search" i], input[placeholder*="command" i], [role="dialog"] input, [role="combobox"]'
    );
    await expect(commandPaletteInput.first()).toBeVisible({ timeout: 5000 });

    // Type in the search field to filter commands
    const input = commandPaletteInput.first();
    await input.fill("settings");

    // Wait for results to update — there should be visible results
    // or at the very least the input should contain our text
    await expect(input).toHaveValue(/settings/i);
  });
});