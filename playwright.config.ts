import path from "path";
import * as dotenv from "dotenv";
import { defineConfig, devices } from "@playwright/test";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test.local") });
dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Next.js test databases often suffer from concurrent writes, stick to 1 worker.
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Run your local PIM server before starting the tests.
  // Env comes from webServer.env (merged .env.local 2026 keys), not .env.test.local.
  webServer: {
    command: "npm run dev:pim",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      ...process.env,
      KATANA_E2E_MIRROR: "true",
      KATANA_API_BASE: "http://127.0.0.1:3000/api/qa/katana-mirror/v1",
      KATANA_API_KEY:
        process.env.KATANA_API_KEY ||
        process.env.KATANA_PERSONAL_ACCESS_TOKEN ||
        "e2e-mirror-token",
      E2E_GODMODE_SECRET:
        process.env.E2E_GODMODE_SECRET || "local-e2e-godmode-secret",
    },
  },
});
