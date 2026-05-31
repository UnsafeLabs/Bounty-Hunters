import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "on-first-retry",
    video: process.env.PLAYWRIGHT_DEMO_VIDEO ? "on" : "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 4177",
    cwd: ".",
    env: {
      VITE_HOSTED_APP_CHANNEL: "latest",
    },
    url: "http://127.0.0.1:4177",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
