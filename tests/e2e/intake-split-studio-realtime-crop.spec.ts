import { expect, test } from "@playwright/test";

/**
 * Smoke: Tab 1 split studio contracts when the portal is reachable.
 * Skips cleanly when embed auth / env is unavailable in CI.
 */
test.describe("intake-split-studio-realtime-crop", () => {
  test("portal Tab 1 exposes split studio filmstrip + canvas strip", async ({ page }) => {
    const key = process.env.E2E_EMBED_KEY || process.env.MASTER_CATALOG_EMBED_KEY || "";
    if (!key) {
      test.skip(true, "No embed key — static Vitest covers markup contracts");
      return;
    }
    await page.goto(`/embed/admin/master-catalog?key=${encodeURIComponent(key)}`);
    const intakeTab = page.getByRole("button", { name: /Intake/i }).first();
    if (await intakeTab.count()) {
      await intakeTab.click();
    }
    const studio = page.getByTestId("intake-split-studio");
    await expect(studio).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("intake-filmstrip")).toBeVisible();
    await expect(page.getByTestId("intake-live-canvas-strip")).toBeVisible();
    await expect(page.getByTestId("intake-upload-dropzone").or(page.getByTestId("intake-upload-toggle"))).toBeVisible();
  });
});
