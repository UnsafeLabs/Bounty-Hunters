import { defineConfig, devices } from "@playwright/experimental-ct-react";

const PORT = Number(process.env.PORT ?? 5733);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `PORT=${PORT} npx vite --port ${PORT}`,
    cwd: "./apps/web",
    port: PORT,
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
  },
});
