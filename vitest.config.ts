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
  "tests/promise-date.test.ts",
  "tests/send-quote.test.ts",
  "tests/seo-listing.test.ts",
  "tests/sku-preview.test.ts",
  "tests/vault-buckets.test.ts",
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
      ...dbIntegrationTests,
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
