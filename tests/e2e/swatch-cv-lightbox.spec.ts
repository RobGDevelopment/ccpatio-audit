import { expect, test } from "@playwright/test";
import {
  EMBED_TOKEN_HEADER,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
} from "../../src/lib/embed-auth";

const TEST_SECRET = process.env.GHL_EMBED_SECRET || "test-embed-secret-key-1234";

test.describe("swatch-cv-recrop-scale-lightbox", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("1:1 lightbox stays in viewport with prev/next + dark upload buttons", async ({
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
    test.skip(!portalVisible && gateVisible, "GHL_EMBED_SECRET mismatch — auth gate shown");
    test.skip(!portalVisible, "Embed master-catalog requires valid GHL_EMBED_SECRET");

    await page.getByTestId("portal-tab-finishes").click();

    const thumbBtn = page.locator('[data-testid^="upload-thumb-"]').first();
    if (await thumbBtn.isVisible().catch(() => false)) {
      const cls = (await thumbBtn.evaluate((el) => {
        const wrap = el.closest("div");
        return `${el.className} ${wrap?.className ?? ""}`;
      })) as string;
      expect(cls).not.toMatch(/\bbg-white\b/);
      expect(cls).toMatch(/slate/);
    }

    const readyBadge = page.getByText("2048px Ready").first();
    test.skip(!(await readyBadge.isVisible().catch(() => false)), "No 2048px Ready finishes yet");

    await readyBadge.click();
    const lightbox = page.getByTestId("full-res-lightbox");
    await expect(lightbox).toBeVisible();

    const box = await lightbox.boundingBox();
    const viewport = page.viewportSize();
    expect(box).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect((box!.y ?? 0) + (box!.height ?? 0)).toBeLessThanOrEqual((viewport!.height ?? 0) + 2);

    const stage = page.getByTestId("lightbox-stage");
    await expect(stage).toBeVisible();
    const stageBox = await stage.boundingBox();
    expect(stageBox).toBeTruthy();
    expect(Math.abs((stageBox!.width ?? 0) - (stageBox!.height ?? 0))).toBeLessThanOrEqual(2);

    await expect(page.getByTestId("lightbox-prev")).toBeVisible();
    await expect(page.getByTestId("lightbox-next")).toBeVisible();
    await expect(page.getByTestId("lightbox-replace")).toBeVisible();

    await page.getByTestId("full-res-mode-zoom").click();
    await expect(page.getByTestId("lightbox-pan")).toBeVisible();
    await page.getByTestId("full-res-mode-tile").click();
    await expect(page.getByTestId("lightbox-tile")).toBeVisible();

    await page.getByTestId("lightbox-next").click();
    await expect(lightbox).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
  });

  test("showroom populated photo opens lightbox not Add photo", async ({ page, context }) => {
    const secret = getGhlEmbedSecret() || TEST_SECRET;
    await context.clearCookies();
    const embedToken = await mintEmbedSessionToken(secret);
    await context.setExtraHTTPHeaders({
      [EMBED_TOKEN_HEADER]: embedToken,
      Authorization: `Bearer ${embedToken}`,
    });

    await page.goto(`/embed/showroom?key=${encodeURIComponent(secret)}`);
    const openLb = page.getByTestId("inventory-open-lightbox").first();
    const hasPhoto = await openLb.isVisible().catch(() => false);
    test.skip(!hasPhoto, "No populated showroom photos in this environment");

    await openLb.click();
    await expect(page.getByTestId("full-res-lightbox")).toBeVisible();
    await expect(page.getByText("Add photo")).toHaveCount(0);
  });
});
