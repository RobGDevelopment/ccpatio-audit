import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BANNED_TERMS_PATTERNS } from "../../src/lib/intake/copy";

const TEST_SECRET = process.env.GHL_EMBED_SECRET || "test-embed-secret-key-1234";

test.describe("Phase 12 Human-Centric Intake Embed (/embed/factory-bom)", () => {
  test.beforeEach(async ({ page }) => {
    // Intercept GHL opportunities API with mock
    const oppMockPath = path.resolve(process.cwd(), "tests/fixtures/ghl-opportunity-search.mock.json");
    let oppMock = { opportunities: [] };
    if (fs.existsSync(oppMockPath)) {
      oppMock = JSON.parse(fs.readFileSync(oppMockPath, "utf8"));
    }

    await page.route("**/embed/factory-bom/api/opportunities*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          results: oppMock.opportunities.map((o: any) => ({
            id: o.id,
            name: o.name,
            contactName: o.contactName,
            valueCents: (o.monetaryValue || 0) * 100,
          })),
        }),
      });
    });

    // Intercept finishes API with mock options
    await page.route("**/embed/factory-bom/api/finishes*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          results: [
            { sku: "MET-ALUM-RAW", name: "Raw Aluminum" },
            { sku: "PWD-MATTE-BLK", name: "Matte Black" },
            { sku: "FAB-SUNB-CANVAS", name: "Sunbrella Canvas Natural" },
          ],
        }),
      });
    });
  });

  test("1. Renders intake embed and enforces no banned jargon in DOM", async ({ page }) => {
    await page.goto(
      `/embed/factory-bom?embedKey=${TEST_SECRET}&ghlUserEmail=rep@ccpatio.com`
    );

    // Verify Drop Step is visible
    await expect(page.locator("text=Drop your design")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator("text=Drag & drop your files here, or browse")
    ).toBeVisible();

    // Runtime Jargon Sweep on body innerText
    const bodyText = await page.locator("body").innerText();
    for (const pattern of BANNED_TERMS_PATTERNS) {
      expect(
        pattern.test(bodyText),
        `Found banned term pattern ${pattern} in page text: "${bodyText.slice(0, 100)}..."`
      ).toBe(false);
    }
  });

  test("2. Enforces autofill suppression on form controls", async ({ page }) => {
    await page.goto(
      `/embed/factory-bom?embedKey=${TEST_SECRET}&ghlUserEmail=rep@ccpatio.com`
    );

    // Check all inputs for autocomplete="off"
    const inputs = await page.locator("input").all();
    for (const input of inputs) {
      const autocomplete = await input.getAttribute("autocomplete");
      if (autocomplete !== null) {
        expect(autocomplete).toBe("off");
      }

      // Check name attribute is opaque
      const name = await input.getAttribute("name");
      if (name) {
        const forbiddenNames = ["name", "email", "address", "phone", "zip", "city"];
        expect(forbiddenNames.includes(name.toLowerCase())).toBe(false);
      }
    }
  });

  test("3. Responsive layout checks at 1280px and 390px widths", async ({ page }) => {
    // Desktop Viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(
      `/embed/factory-bom?embedKey=${TEST_SECRET}&ghlUserEmail=rep@ccpatio.com`
    );
    await expect(page.locator("text=Drop your design")).toBeVisible();

    // Mobile Viewport (iPhone frame)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/embed/factory-bom?embedKey=${TEST_SECRET}&ghlUserEmail=rep@ccpatio.com`
    );
    await expect(page.locator("text=Drop your design")).toBeVisible();
  });
});
