import { defineConfig, devices } from "@playwright/test";
import { e2eBaseUrl, e2eDatabaseUrl, e2ePort, repoRoot } from "./e2e/constants";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `DATABASE_URL='${e2eDatabaseUrl}' REVALIDATE_SECRET=e2e-revalidate-secret pnpm --filter @evolution/web exec next dev --port ${e2ePort}`,
    cwd: repoRoot,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      REVALIDATE_SECRET: "e2e-revalidate-secret",
    },
  },
});
