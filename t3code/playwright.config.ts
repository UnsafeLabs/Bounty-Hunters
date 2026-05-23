import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const requireFromWebWorkspace = createRequire(new URL("./apps/web/package.json", import.meta.url));
const { defineConfig, devices } = requireFromWebWorkspace("playwright/test");
const webAppDir = fileURLToPath(new URL("./apps/web/", import.meta.url));
const port = Number(process.env.T3_E2E_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    headless: process.env.CI ? true : false,
    ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_HOSTED_APP_CHANNEL=latest npm run dev -- --host 127.0.0.1 --port ${port}`,
    cwd: webAppDir,
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
