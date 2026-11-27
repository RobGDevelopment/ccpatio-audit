import { expect, test } from "@playwright/test";
import {
  EMBED_TOKEN_HEADER,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
} from "../../src/lib/embed-auth";

const TEST_SECRET = process.env.GHL_EMBED_SECRET || "test-embed-secret-key-1234";

test.describe("stack-live-sync-qbo-dlq drawer close", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("× and Escape close the Stack Health drawer", async ({ page, context }) => {
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

    await page.getByTestId("stack-layer-inngest_dlq").click();
    await expect(page.getByTestId("stack-diagnostic-drawer")).toBeVisible();
    await page.getByTestId("stack-drawer-close").click();
    await expect(page.getByTestId("stack-diagnostic-drawer")).toHaveCount(0);

    await page.getByTestId("stack-layer-katana").click();
    await expect(page.getByTestId("stack-diagnostic-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("stack-diagnostic-drawer")).toHaveCount(0);
  });
});
