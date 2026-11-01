import { defineConfig, devices } from "@playwright/test";
import { e2eBaseUrl, e2eDatabaseUrl, e2ePort, repoRoot } from "./e2e/constants";

const desktop = { ...devices["Desktop Chrome"], baseURL: e2eBaseUrl };
const mobile = { ...devices["Pixel 5"], baseURL: e2eBaseUrl };

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: desktop },
    {
      name: "mobile-chromium",
      use: mobile,
      testIgnore: [/api\.spec\.ts/, /states\.spec\.ts/],
    },
  ],
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `DATABASE_URL='${e2eDatabaseUrl}' REVALIDATE_SECRET=e2e-revalidate-secret E2E_SUSPEND_HEADER=1 pnpm --filter @evolution/web exec next dev --hostname 127.0.0.1 --port ${e2ePort}`,
    cwd: repoRoot,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      REVALIDATE_SECRET: "e2e-revalidate-secret",
      E2E_SUSPEND_HEADER: "1",
    },
  },
});
