import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3773",
    trace: "on-first-retry",
  },
  webServer: {
    command: "cd apps/web && npm run dev",
    url: "http://localhost:3773",
    reuseExistingServer: !process.env.CI,
    cwd: "t3code",
  },
});
