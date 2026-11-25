import { expect, test } from "@playwright/test";

/**
 * Default `/embed/admin/master-catalog` is the dark 3-tab Handoff Portal.
 * Legacy spreadsheet tools live behind `?view=legacy-admin` (Superadmin).
 * Auth may gate the embed; soft-skip when the session cookie is absent.
 */
test.describe("ecommerce handoff portal (default route)", () => {
  test("renders dark 3-tab portal with zero legacy Upcharge / duplicate search chrome", async ({
    page,
  }) => {
    await page.goto("/embed/admin/master-catalog");
    const portal = page.getByTestId("ecommerce-certification-portal");
    const visible = await portal.isVisible().catch(() => false);
    test.skip(!visible, "Embed master-catalog requires authenticated GHL session");

    await expect(portal).toBeVisible();
    await expect(page.getByTestId("portal-pill-tabs")).toBeVisible();
    await expect(page.getByTestId("portal-tab-finishes")).toBeVisible();
    await expect(page.getByTestId("portal-tab-products")).toBeVisible();
    await expect(page.getByTestId("portal-tab-sync")).toBeVisible();
    await expect(page.getByTestId("mia-approved-pill")).toBeVisible();
    await expect(page.getByTestId("portal-kpi-cards")).toBeVisible();

    // Default tab = finishes panel (inline, not modal-only)
    await expect(page.getByTestId("portal-panel-finishes")).toBeVisible();

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
  });

  test("legacy-admin spreadsheet escape hatch still exposes Upcharge tools", async ({ page }) => {
    await page.goto("/embed/admin/master-catalog?view=legacy-admin");
    const legacy = page.getByTestId("legacy-admin-catalog");
    const portal = page.getByTestId("ecommerce-certification-portal");
    const legacyVisible = await legacy.isVisible().catch(() => false);
    const portalVisible = await portal.isVisible().catch(() => false);
    test.skip(
      !legacyVisible && !portalVisible,
      "Embed master-catalog requires authenticated GHL session",
    );

    if (legacyVisible) {
      await expect(page.getByTestId("legacy-back-to-portal")).toBeVisible();
      await expect(page.getByTestId("recalculate-upcharge-btn")).toBeVisible();
      await expect(page.getByTestId("tab-live-ecommerce")).toBeVisible();
    } else {
      // Non-superadmin sessions are forced back to the dark portal
      await expect(portal).toBeVisible();
      await expect(page.getByTestId("recalculate-upcharge-btn")).toHaveCount(0);
    }
  });
});
