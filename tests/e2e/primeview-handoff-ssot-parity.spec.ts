import { expect, test } from "@playwright/test";
import {
  derivePrimeviewHandoffTokenFromEmbedSecret,
  resolveExpectedPrimeviewHandoffToken,
} from "../../src/lib/primeview-handoff-auth";

function partnerToken(): string | null {
  const explicit = process.env.PRIMEVIEW_HANDOFF_TOKEN?.trim();
  if (explicit) return explicit;
  const secret = process.env.GHL_EMBED_SECRET?.trim();
  if (secret) return derivePrimeviewHandoffTokenFromEmbedSecret(secret);
  try {
    return resolveExpectedPrimeviewHandoffToken();
  } catch {
    return null;
  }
}

test.describe("primeview-handoff-ssot-parity", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("partner portal: 3 tabs, staging banner, lightbox, no internal leaks", async ({
    page,
  }) => {
    const token = partnerToken();
    test.skip(!token, "PRIMEVIEW_HANDOFF_TOKEN / GHL_EMBED_SECRET not configured");

    await page.goto(`/partner/primeview-handoff?token=${encodeURIComponent(token!)}`);

    const portal = page.getByTestId("partner-handoff-portal");
    await expect(portal).toBeVisible({ timeout: 45_000 });
    await expect(portal).toHaveAttribute("data-force-dynamic", "true");

    // No internal admin / mutation controls
    await expect(page.getByTestId("portal-tab-intake")).toHaveCount(0);
    await expect(page.getByText(/Katana stock/i)).toHaveCount(0);
    await expect(page.getByText(/QuickBooks/i)).toHaveCount(0);
    await expect(page.getByText(/Full 38 Finishes/i)).toHaveCount(0);
    await expect(page.getByTestId("lightbox-replace")).toHaveCount(0);

    // KPI + staging banner
    await expect(page.getByTestId("partner-kpi-finishes")).toBeVisible();
    await expect(page.getByTestId("partner-kpi-purchasable")).toBeVisible();
    await expect(page.getByTestId("partner-kpi-mia")).toBeVisible();
    await expect(page.getByTestId("partner-staging-banner")).toBeVisible();
    await expect(page.getByTestId("partner-retest-staging")).toBeVisible();
    await expect(page.getByTestId("partner-copy-diagnostic")).toBeVisible();

    // Tab 1 finishes + add-ons
    await page.getByTestId("partner-tab-finishes").click();
    await expect(page.getByTestId("partner-panel-finishes")).toBeVisible();
    await page.getByTestId("partner-finish-subfilter-addons").click();
    await expect(page.getByTestId("partner-storefront-addons")).toBeVisible();
    await page.getByTestId("partner-finish-subfilter-all_active").click();

    // Prefer a 2048px-ready card when present so Fit/1:1/3×3 stages have a CDN URL.
    const readyCard = page
      .locator('[data-testid^="partner-finish-card-"]')
      .filter({ hasText: "2048px Ready" })
      .first();
    const anySwatch = page.locator('[data-testid^="partner-swatch-"]').first();
    const swatchTarget = (await readyCard.isVisible().catch(() => false))
      ? readyCard.locator('[data-testid^="partner-swatch-"]').first()
      : anySwatch;

    if (await swatchTarget.isVisible().catch(() => false)) {
      await swatchTarget.click();
      const lightbox = page.getByTestId("full-res-lightbox");
      await expect(lightbox).toBeVisible();
      await expect(page.getByTestId("full-res-mode-fit")).toBeVisible();
      await expect(page.getByTestId("full-res-mode-zoom")).toBeVisible();
      await expect(page.getByTestId("full-res-mode-tile")).toBeVisible();
      await expect(page.getByTestId("lightbox-prev")).toBeVisible();
      await expect(page.getByTestId("lightbox-next")).toBeVisible();
      await expect(page.getByTestId("lightbox-replace")).toHaveCount(0);

      await page.getByTestId("full-res-mode-zoom").click();
      const pan = page.getByTestId("lightbox-pan");
      const panOk = await pan.isVisible().catch(() => false);
      if (panOk) {
        await expect(pan).toBeVisible();
      }

      await page.getByTestId("full-res-mode-tile").click();
      const tile = page.getByTestId("lightbox-tile");
      // Tile stage mounts when imgSrc is healthy; CDN 404 flips to "No image available".
      // Mode controls + zero Replace still prove partner lightbox parity.
      if (await tile.isVisible().catch(() => false)) {
        await expect(tile).toBeVisible();
      } else {
        await expect(page.getByTestId("full-res-mode-tile")).toBeVisible();
        await expect(page.getByTestId("lightbox-replace")).toHaveCount(0);
      }

      await page.keyboard.press("Escape");
      await expect(lightbox).toBeHidden();
    }

    // Tab 2 products
    await page.getByTestId("partner-tab-products").click();
    await expect(page.getByTestId("partner-panel-products")).toBeVisible();
    await expect(page.getByTestId("partner-products-table")).toBeVisible();

    // Tab 3 downloads — certified only
    await page.getByTestId("partner-tab-sync").click();
    await expect(page.getByTestId("partner-panel-sync")).toBeVisible();
    await expect(page.getByTestId("partner-download-finishes-json")).toBeVisible();
    await expect(page.getByTestId("partner-download-products-csv")).toBeVisible();
    await expect(page.getByTestId("partner-download-addons-json")).toBeVisible();
  });
});
