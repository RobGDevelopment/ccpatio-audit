import { expect, test } from "@playwright/test";

/**
 * Default `/embed/admin/master-catalog` is the dark 4-tab Handoff Portal (Tab 1 = Intake & Media Studio).
 * Legacy spreadsheet is retired — `?view=legacy-admin` still lands on the dark portal.
 * Auth may gate the embed; soft-skip when the session cookie is absent.
 */
test.describe("ecommerce handoff portal (default route)", () => {
  test("renders dark 4-tab portal with zero legacy Upcharge / duplicate search chrome", async ({
    page,
  }) => {
    await page.goto("/embed/admin/master-catalog");
    const portal = page.getByTestId("ecommerce-certification-portal");
    const visible = await portal.isVisible().catch(() => false);
    test.skip(!visible, "Embed master-catalog requires authenticated GHL session");

    await expect(portal).toBeVisible();
    await expect(page.getByTestId("portal-pill-tabs")).toBeVisible();
    // 4 tabs: Intake & Media Studio (default) · Certified Finishes & Add-Ons · Certified Products · WooCommerce Sync & Handoff
    await expect(page.getByTestId("portal-pill-tabs").getByRole("tab")).toHaveCount(4);
    await expect(page.getByTestId("portal-tab-intake")).toBeVisible();
    await expect(page.getByTestId("portal-tab-finishes")).toBeVisible();
    await expect(page.getByTestId("portal-tab-products")).toBeVisible();
    await expect(page.getByTestId("portal-tab-sync")).toBeVisible();
    await expect(page.getByTestId("mia-approved-pill")).toBeVisible();
    await expect(page.getByTestId("portal-kpi-cards")).toBeVisible();

    // Default tab = Intake & Media Studio (inline, not modal-only)
    await expect(page.getByTestId("portal-tab-intake")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("portal-panel-intake")).toBeVisible();
    await expect(page.getByTestId("portal-intake-subfilters")).toBeVisible();
    await expect(page.getByTestId("portal-panel-finishes")).toHaveCount(0);

    // Certified Finishes & Add-Ons is one click away
    await page.getByTestId("portal-tab-finishes").click();
    await expect(page.getByTestId("portal-panel-finishes")).toBeVisible();
    await expect(page.getByTestId("portal-panel-intake")).toHaveCount(0);

    // Legacy clutter must stay off the default route
    await expect(page.getByTestId("recalculate-upcharge-btn")).toHaveCount(0);
    await expect(page.getByTestId("upcharge-pct-input")).toHaveCount(0);
    await expect(page.getByTestId("storefront-policy-banner")).toHaveCount(0);
    await expect(page.getByTestId("live-ecommerce-toolbar")).toHaveCount(0);
    await expect(page.getByTestId("global-swatches-btn")).toHaveCount(0);
    await expect(page.getByTestId("tab-live-ecommerce")).toHaveCount(0);

    // Products tab: exactly one search input
    await page.getByTestId("portal-tab-products").click();
    await expect(page.getByTestId("portal-panel-products")).toBeVisible();
    await expect(page.getByTestId("portal-search-input")).toHaveCount(1);

    await page.getByTestId("portal-tab-sync").click();
    await expect(page.getByTestId("portal-panel-sync")).toBeVisible();
    await expect(page.getByTestId("test-woo-connection")).toBeVisible();
    await expect(page.getByTestId("sync-sku-combobox")).toBeVisible();
    await expect(page.getByTestId("certified-gate-note")).toBeVisible();
  });

  test("legacy-admin query must NOT expose Upcharge — dark portal only", async ({ page }) => {
    await page.goto("/embed/admin/master-catalog?view=legacy-admin");
    const portal = page.getByTestId("ecommerce-certification-portal");
    const portalVisible = await portal.isVisible().catch(() => false);
    test.skip(!portalVisible, "Embed master-catalog requires authenticated GHL session");

    await expect(portal).toBeVisible();
    await expect(page.getByTestId("legacy-admin-catalog")).toHaveCount(0);
    await expect(page.getByTestId("recalculate-upcharge-btn")).toHaveCount(0);
    await expect(page.getByTestId("executive-stack-health-strip")).toBeVisible();
  });
});
