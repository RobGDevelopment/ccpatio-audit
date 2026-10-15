import path from "node:path";
import { defineConfig } from "vitest/config";

/** Live Postgres suites. CI sets POSTGRES_URL to 127.0.0.1 and has no server. */
const dbIntegrationTests = [
  "tests/actions.test.ts",
  "tests/asset-vault.test.ts",
  "tests/confirm-asset.test.ts",
  "tests/custom-build-job.test.ts",
  "tests/dictionary-system.test.ts",
  "tests/freight-snapshot.test.ts",
  "tests/katana-variant-webhook.test.ts",
  "tests/order-desk-hold-swap.test.ts",
  "tests/order-desk-quote.test.ts",
  // Run by `npm run qa:phase0-hygiene-live` (RUN_DB_TESTS=1, this one file only), part of qa:lifecycle.
  "tests/phase13-hygiene-patch-live.test.ts",
  "tests/promise-date.test.ts",
  "tests/qbo-lock-keys.test.ts",
  "tests/send-quote.test.ts",
  "tests/seo-listing.test.ts",
  "tests/sku-preview.test.ts",
  "tests/sre-schema-smoke.test.ts",
  "tests/sre-token-bucket.test.ts",
  "tests/vault-buckets.test.ts",
  "tests/woo-saga-store.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
    testTimeout: 30_000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "**/e2e/**",
      "**/*.spec.ts",
      // Set RUN_DB_TESTS=1 to run the live-Postgres suites (explicit CLI paths do not override `exclude`).
      ...(process.env.RUN_DB_TESTS === "1" ? [] : dbIntegrationTests),
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
