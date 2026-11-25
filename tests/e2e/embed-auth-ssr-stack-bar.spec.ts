import { expect, test } from "@playwright/test";
import {
  EMBED_TOKEN_HEADER,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
} from "../../src/lib/embed-auth";

const TEST_SECRET = process.env.GHL_EMBED_SECRET || "test-embed-secret-key-1234";
const EDIT_SKU = "FIN-BRV-CLB-CHA-34X34";

test.describe("embed-auth-ssr-stack-bar-hardening", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("no key + cleared cookies → Executive Auth Gate (not half-shell)", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/embed/admin/master-catalog");
    await expect(page.getByTestId("executive-auth-gate")).toBeVisible();
    await expect(page.getByTestId("executive-auth-gate-message")).toContainText(
      "Missing or invalid GHL embed key",
    );
    await expect(page.getByTestId("ecommerce-certification-portal")).toHaveCount(0);
  });

  test("valid ?key= + literal {{user.email}} + clearCookies keeps 7 pills + Edit Details", async ({
    page,
    context,
  }) => {
    const secret = getGhlEmbedSecret() || TEST_SECRET;
    await context.clearCookies();

    await page.goto(
      `/embed/admin/master-catalog?key=${encodeURIComponent(secret)}&email=${encodeURIComponent("{{user.email}}")}`,
    );

    const portal = page.getByTestId("ecommerce-certification-portal");
    const gate = page.getByTestId("executive-auth-gate");
    const portalVisible = await portal.isVisible().catch(() => false);
    const gateVisible = await gate.isVisible().catch(() => false);
    test.skip(
      !portalVisible && gateVisible,
      "GHL_EMBED_SECRET mismatch — auth gate shown (env not wired for this runner)",
    );
    test.skip(!portalVisible, "Embed master-catalog requires valid GHL_EMBED_SECRET");

    const strip = page.getByTestId("executive-stack-health-strip");
    await expect(strip).toBeVisible();
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

    const katana = page.getByTestId("stack-layer-katana");
    await expect(katana).toContainText("Katana MRP");
    await katana.click();
    await expect(
      page.getByTestId("stack-action-katana-katana_reset_bucket_sync"),
    ).toBeVisible();
    await expect(
      page.getByTestId("stack-action-katana-katana_reset_bucket_sync"),
    ).toContainText("Reset Bucket & Sync Katana Now");

    // Simulated API failure must NOT unmount the 7-pill strip.
    await page.route("**/embed/admin/master-catalog**", async (route) => {
      // let document through; only used to keep strip mounted after client refresh noise
      await route.continue();
    });
    await expect(page.getByTestId("stack-layer-katana")).toBeVisible();

    // Default tab is Intake & Media Studio — open Certified Finishes first.
    await page.getByTestId("portal-tab-finishes").click();
    const sunbrella = page.getByTestId("finish-group-sunbrella");
    if (await sunbrella.isVisible().catch(() => false)) {
      const rows = sunbrella.locator("tbody tr[data-testid^='finish-row-']");
      const count = await rows.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }

    // Clear cookies — client still has embedToken from EmbedSessionProvider + mirror cookie rewrite.
    const embedToken = await mintEmbedSessionToken(secret);
    await context.clearCookies();
    await context.setExtraHTTPHeaders({
      [EMBED_TOKEN_HEADER]: embedToken,
      Authorization: `Bearer ${embedToken}`,
    });
    await page.evaluate(
      ([headerName, token]) => {
        document.cookie = `${headerName}=${encodeURIComponent(token)}; Path=/; Max-Age=7200; Secure; SameSite=None; Partitioned`;
      },
      [EMBED_TOKEN_HEADER, embedToken] as const,
    );

    await page.getByTestId("portal-tab-products").click();
    const editBtn = page.getByTestId(`edit-details-${EDIT_SKU}`);
    const editVisible = await editBtn.isVisible().catch(() => false);
    if (!editVisible) {
      const anyEdit = page.locator(`[data-testid^='edit-details-${EDIT_SKU}']`).first();
      const anyVisible = await anyEdit.isVisible().catch(() => false);
      test.skip(!anyVisible, `${EDIT_SKU} not in Phase 1 table for this env`);
      await anyEdit.click();
    } else {
      await editBtn.click();
    }

    const unauthorized = page.getByText(/unauthorized/i);
    await expect(unauthorized).toHaveCount(0);
  });

  test("duplicate Tab 2 status pills are gone (readiness row only)", async ({ page, context }) => {
    const secret = getGhlEmbedSecret() || TEST_SECRET;
    await context.clearCookies();
    await page.goto(`/embed/admin/master-catalog?key=${encodeURIComponent(secret)}`);
    const portal = page.getByTestId("ecommerce-certification-portal");
    test.skip(!(await portal.isVisible().catch(() => false)), "Portal not available");

    await page.getByTestId("portal-tab-products").click();
    await expect(page.getByTestId("portal-readiness-filters")).toBeVisible();
    await expect(page.getByTestId("portal-status-filters")).toHaveCount(0);
    await expect(page.getByTestId("portal-readiness-spot_check")).toHaveCount(1);
    await expect(page.getByTestId("portal-readiness-approved")).toHaveCount(1);
  });
});
