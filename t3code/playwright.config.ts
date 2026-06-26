import { defineConfig, devices } from "playwright/test";

const port = Number(process.env.PORT ?? 5733);
const host = process.env.HOST?.trim() || "127.0.0.1";
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "bun run --cwd apps/web dev",
    cwd: ".",
    env: {
      HOST: host,
      PORT: String(port),
      VITE_HOSTED_APP_URL: baseURL,
      VITE_HTTP_URL: "",
      VITE_WS_URL: "",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
