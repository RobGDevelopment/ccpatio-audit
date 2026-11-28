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

test.describe("woo-shipping-bridge-and-taxjar", () => {
  test.use({ viewport: { width: 1400, height: 900 } });

  test("partner handoff: shipping ZIP download + quote simulator on Certified SSOT", async ({
    page,
    request,
  }) => {
    const token = partnerToken();
    test.skip(!token, "PRIMEVIEW_HANDOFF_TOKEN / GHL_EMBED_SECRET not configured");

    const zipRes = await request.get(
      `/api/partner/primeview-handoff/shipping-plugin?token=${encodeURIComponent(token!)}`,
    );
    expect(zipRes.status()).toBe(200);
    expect(zipRes.headers()["content-type"] ?? "").toMatch(/application\/zip/);
    const body = await zipRes.body();
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
    expect(body[2]).toBe(0x03);
    expect(body[3]).toBe(0x04);

    await page.goto(`/partner/primeview-handoff?token=${encodeURIComponent(token!)}`);
    const portal = page.getByTestId("partner-handoff-portal");
    await expect(portal).toBeVisible({ timeout: 45_000 });
    await expect(portal).toHaveAttribute("data-force-dynamic", "true");

    // Zero internal admin mutation leaks
    await expect(page.getByTestId("portal-tab-intake")).toHaveCount(0);
    await expect(page.getByTestId("lightbox-replace")).toHaveCount(0);

    await page.getByTestId("partner-tab-sync").click();
    await expect(page.getByTestId("partner-panel-sync")).toBeVisible();
    await expect(page.getByTestId("partner-shipping-taxjar-panel")).toBeVisible();
    await expect(page.getByTestId("partner-shipping-taxjar-download-zip")).toBeVisible();
    await expect(page.getByTestId("partner-shipping-taxjar-simulate")).toBeVisible();
    const skuSelect = page.getByTestId("partner-shipping-taxjar-sku");
    await expect(skuSelect).toBeVisible();
    // Ensure a SKU is selected so Simulate is enabled (empty catalog → fallback option).
    const selected = await skuSelect.inputValue();
    if (!selected) {
      const opts = skuSelect.locator("option");
      const firstVal = await opts.nth(0).getAttribute("value");
      if (firstVal) await skuSelect.selectOption(firstVal);
    }
    await expect(page.getByTestId("partner-shipping-taxjar-simulate")).toBeEnabled({
      timeout: 10_000,
    });

    await page.getByTestId("partner-shipping-taxjar-simulate").click();
    await expect(page.getByTestId("partner-shipping-taxjar-result")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("partner-shipping-taxjar-rates")).toBeVisible();
    await expect(
      page.getByTestId("partner-shipping-taxjar-rate-ccpatio_fedex_ltl_curbside"),
    ).toBeVisible();
    await expect(
      page.getByTestId("partner-shipping-taxjar-rate-ccpatio_pickup_scottsdale"),
    ).toBeVisible();
    await expect(
      page.getByTestId("partner-shipping-taxjar-rate-ccpatio_pickup_solana"),
    ).toBeVisible();
  });
});
