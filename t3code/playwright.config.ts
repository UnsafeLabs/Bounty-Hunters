import { defineConfig, devices } from "@playwright/test";
import path from "path";

const WEB_APP_DIR = path.join(__dirname, "apps", "web");

export default defineConfig({
  testDir: path.join(__dirname, "tests", "e2e"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "cd " + WEB_APP_DIR + " && npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
