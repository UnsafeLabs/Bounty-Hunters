import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5733",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev:web",
    url: "http://localhost:5733",
    reuseExistingServer: !process.env.CI,
    cwd: ".",
  },
});
