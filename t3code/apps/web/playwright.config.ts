import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 4177);
const host = process.env.HOST?.trim() || "127.0.0.1";
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.PLAYWRIGHT_DEMO_VIDEO ? "on" : "retain-on-failure",
  },
  webServer: {
    command: `bun run dev --host ${host} --port ${port}`,
    cwd: ".",
    env: {
      HOST: host,
      PORT: String(port),
      VITE_HOSTED_APP_CHANNEL: "latest",
      VITE_HOSTED_APP_URL: baseURL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    url: baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
