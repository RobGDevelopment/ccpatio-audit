import { expect, test } from "@playwright/test";
import {
  EMBED_TOKEN_HEADER,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
} from "../../src/lib/embed-auth";

const TEST_SECRET = process.env.GHL_EMBED_SECRET || "test-embed-secret-key-1234";

test.describe("ecc-compact-stack-highrez-lightbox-polish", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("compact 7-pill strip, drawers, KPI→Tab2, add-ons, lightbox", async ({
    page,
    context,
  }) => {
    const secret = getGhlEmbedSecret() || TEST_SECRET;
    await context.clearCookies();
    const embedToken = await mintEmbedSessionToken(secret);
    await context.setExtraHTTPHeaders({
      [EMBED_TOKEN_HEADER]: embedToken,
      Authorization: `Bearer ${embedToken}`,
    });

    await page.goto(
      `/embed/admin/master-catalog?key=${encodeURIComponent(secret)}&email=${encodeURIComponent("mia@ccpatio.com")}`,
    );

    const portal = page.getByTestId("ecommerce-certification-portal");
    const gate = page.getByTestId("executive-auth-gate");
    const portalVisible = await portal.isVisible().catch(() => false);
    const gateVisible = await gate.isVisible().catch(() => false);
    test.skip(
      !portalVisible && gateVisible,
      "GHL_EMBED_SECRET mismatch — auth gate shown",
    );
    test.skip(!portalVisible, "Embed master-catalog requires valid GHL_EMBED_SECRET");

    const strip = page.getByTestId("executive-stack-health-strip");
    await expect(strip).toBeVisible();
    const stripBox = await strip.boundingBox();
    expect(stripBox?.height ?? 999).toBeLessThan(90);

    for (const id of [
      "supabase",
      "katana",
      "qbo",
      "woocommerce",
      "ghl",
      "fedex",
      "inngest_dlq",
    ]) {
      await expect(page.getByTestId(`stack-layer-${id}`)).toBeVisible();
    }

    await page.getByTestId("stack-layer-qbo").click();
    await expect(page.getByTestId("stack-diagnostic-drawer")).toBeVisible();
    await expect(page.getByTestId("stack-action-qbo-qbo_reconnect")).toBeVisible();
    await expect(page.getByTestId("stack-action-qbo-qbo_verify_token")).toBeVisible();

    await page.getByTestId("stack-layer-katana").click();
    await expect(page.getByTestId("stack-action-katana-katana_reset_bucket_sync")).toBeVisible();
    await expect(page.getByTestId("stack-action-katana-katana_sync_now")).toBeVisible();

    // KPI Parents while on Tab 1 → Tab 2
    await page.getByTestId("portal-tab-finishes").click();
    await page.getByTestId("portal-kpi-parents").click();
    await expect(page.getByTestId("portal-panel-products")).toBeVisible();

    await page.getByTestId("portal-tab-finishes").click();
    await page.getByTestId("finish-subfilter-addons").click();
    await expect(page.getByTestId("storefront-addons-editor")).toBeVisible();

    await page.getByTestId("finish-subfilter-all_active").click();
    const readyBadge = page.getByText("2048px Ready").first();
    if (await readyBadge.isVisible().catch(() => false)) {
      await readyBadge.click();
      await expect(page.getByTestId("full-res-lightbox")).toBeVisible();
      await expect(page.getByTestId("full-res-mode-fit")).toBeVisible();
      await expect(page.getByTestId("full-res-mode-zoom")).toBeVisible();
      await expect(page.getByTestId("full-res-mode-tile")).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // APF badges present — no truncated cushion_f…
    await expect(page.getByText("Cushion & Pillow").first()).toBeVisible();
    await expect(page.locator("text=cushion_f")).toHaveCount(0);
  });
});
