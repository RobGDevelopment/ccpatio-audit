import path from "path";
import * as dotenv from "dotenv";
import { defineConfig, devices } from "@playwright/test";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test.local") });
dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

// Ensure Supavisor transaction pooler (port 6543) is used instead of session pooler (5432)
// to prevent connection exhaustion during concurrent webServer + test execution.
if (process.env.POSTGRES_URL_TX?.trim()) {
  process.env.POSTGRES_URL = process.env.POSTGRES_URL_TX.trim();
} else if (process.env.POSTGRES_URL?.includes(".pooler.supabase.com:5432")) {
  process.env.POSTGRES_URL = process.env.POSTGRES_URL.replace(":5432", ":6543");
}

process.env.KATANA_E2E_MIRROR = "true";
process.env.KATANA_API_BASE =
  process.env.KATANA_API_BASE || "http://127.0.0.1:3000/api/qa/katana-mirror/v1";
process.env.KATANA_API_KEY =
  process.env.KATANA_API_KEY ||
  process.env.KATANA_PERSONAL_ACCESS_TOKEN ||
  "e2e-mirror-token";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
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
  // qa:phase2 leaves `next start` on port 3000 and e2e reuses it.
  // Do not start `next dev` here. Dev compiles /admin/dictionary on first hit,
  // and aborting that request when a test times out takes the listener down.
  // Later tests then fail with ECONNREFUSED. When port 3000 is free, start the
  // same production server phase 2 uses.
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    env: {
      ...process.env,
      NODE_ENV: "production",
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
