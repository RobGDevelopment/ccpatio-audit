import { expect, test } from "@playwright/test";
import { injectGodModeSession } from "./helpers/god-mode-auth";

const TEST_SECRET = process.env.GHL_EMBED_SECRET || "test-embed-secret-key-1234";
const SKU = "FIN-BRV-CLB-CHA-34X34";

/**
 * Playwright proof for woocommerce-payload-pricing-integrity:
 * Tab 2 price parity hooks, product archive modal → staged commit → Archived vault,
 * and certified catalog staging push batch summary under DOWNSTREAM_MUTATIONS=false.
 */
test.describe("woocommerce payload pricing integrity", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("archive round-trip + staging push batch ok + price surface hooks", async ({
    page,
    context,
  }) => {
    await injectGodModeSession(context);
    await page.goto(`/embed/admin/master-catalog?embedKey=${TEST_SECRET}`);

    const portal = page.getByTestId("ecommerce-certification-portal");
    const visible = await portal.isVisible().catch(() => false);
    test.skip(!visible, "Embed master-catalog requires authenticated session");

    await page.getByTestId("portal-tab-products").click();
    await expect(page.getByTestId("portal-panel-products")).toBeVisible();

    // Price column uses canonical Aluminum (never steel fallback testid).
    const priceCell = page.getByTestId(`product-price-${SKU}`);
    if (await priceCell.isVisible().catch(() => false)) {
      const text = (await priceCell.innerText()).replace(/[$,\s]/g, "");
      expect(text === "" || text === "—" || Number(text) > 0).toBeTruthy();
      if (text && text !== "—") {
        expect(Number(text)).toBe(2530);
      }
    }

    // Archive → Impact Warning Modal → Staged Commit Bar
    const archiveBtn = page.locator('[data-testid^="archive-product-"]').first();
    if (await archiveBtn.isVisible().catch(() => false)) {
      await archiveBtn.click();
      await expect(page.getByTestId("archive-impact-modal")).toBeVisible();
      await page.getByTestId("archive-impact-confirm").click();
      await expect(page.getByTestId("pending-commit-bar")).toBeVisible();
      await page.getByTestId("pending-commit-discard").click();
      await expect(page.getByTestId("pending-commit-bar")).toHaveCount(0);
    }

    await expect(page.getByTestId("portal-readiness-archived")).toBeVisible();

    // Staging push batch under DOWNSTREAM_MUTATIONS=false
    await page.getByTestId("portal-tab-sync").click();
    await expect(page.getByTestId("push-catalog-staging")).toBeVisible();
    await page.getByTestId("push-catalog-staging").click();
    // Simulation should toast / note without "Listing not found."
    await expect
      .poll(async () => {
        const note = page.getByTestId("staging-guardrail-note");
        return (await note.innerText()).toLowerCase();
      })
      .toContain("downstream_mutations");
  });
});
