/**
 * Factory BOM lifecycle E2E — hub is the single source of truth.
 *
 * Architecture (commit 0714680):
 *   1. Operator edits `product_bom_draft` in `/admin/factory-bom`
 *   2. Approve copies the FRAME/CUSH adjacency list into live `product_bom`
 *   3. Catalog publish (`syncBOMToKatana`) emits nested `POST /recipes`
 *      bodies — never a flat BOM string, and never a sales-order MTO.
 *
 * God Mode: tests/e2e/helpers/god-mode-auth.ts
 *   HMAC-signs a `ccpatio_e2e_godmode` cookie with E2E_GODMODE_SECRET so the
 *   agent never touches magic links. Middleware honors the cookie only when
 *   that secret is set on the Next process (never in Vercel production).
 *
 * Isolated CLI (from repo root, headed so you can watch the agent):
 *   npx dotenv -e .env.local -- playwright test tests/e2e/factory-bom-lifecycle.spec.ts --ui
 *
 * Headless isolation:
 *   npm run test:e2e:factory-bom
 *
 * Required env (.env.local):
 *   POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL,
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY),
 *   SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY),
 *   E2E_GODMODE_SECRET
 * Optional:
 *   E2E_GODMODE_EMAIL
 *   KATANA_E2E_MIRROR=true  (Playwright webServer sets this when it boots Next)
 */
import { test, expect, type Page } from "@playwright/test";
import { injectGodModeSession, GODMODE_EMAIL } from "./helpers/god-mode-auth";
import {
  cleanupFactoryBomE2eSeed,
  closeFactoryBomE2eDb,
  E2E_CAP_SKU,
  E2E_CUSH_SKU,
  E2E_FABRIC_SKU,
  E2E_FG_SKU,
  E2E_FRAME_SKU,
  E2E_POWDER_SKU,
  getDb,
  seedFactoryBomE2eDraft,
} from "./helpers/factory-bom-seed";
import { eq } from "drizzle-orm";
import { product_bom, product_bom_draft } from "../../src/server/db/schema";

type RecipePreview = {
  ok: boolean;
  finishedGoodSku: string;
  path: string;
  method: string;
  hubLines: Array<{
    parentSku: string;
    childSku: string;
    quantity: number;
    effectiveQuantity: number;
    unitOfMeasure: string;
  }>;
  katanaRecipePosts: Array<{
    keep_current_rows: boolean;
    rows: Array<{
      product_sku: string;
      ingredient_sku: string;
      quantity: number;
      notes: string;
    }>;
  }>;
};

test.describe.configure({ mode: "serial" });

test.describe("Factory BOM lifecycle (hub SoT → Katana recipes)", () => {
  test.beforeAll(async () => {
    await seedFactoryBomE2eDraft();
  });

  test.afterAll(async () => {
    await cleanupFactoryBomE2eSeed();
    await closeFactoryBomE2eDb();
  });

  test.beforeEach(async ({ context }) => {
    await injectGodModeSession(context);
  });

  test("operator edits a draft recipe, approves it, and Katana receives nested recipe rows", async ({
    page,
  }) => {
    // --------------------------------------------------------------------------
    // PHASE 4 intercept (browser-side). Server actions cannot be seen here;
    // the authenticated recipe-preview route + optional E2E mirror cover that.
    // --------------------------------------------------------------------------
    const browserKatanaPosts: unknown[] = [];
    await page.route("https://api.katanamrp.com/v1/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.url().includes("/recipes")) {
        const raw = request.postData();
        expect(raw, "Katana recipe POST must not be a bare string body").not.toBeNull();
        const parsed = request.postDataJSON() as unknown;
        expect(typeof parsed).toBe("object");
        expect(Array.isArray(parsed)).toBeFalsy();
        browserKatanaPosts.push(parsed);
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ data: [], mock: true }),
      });
    });

    // --------------------------------------------------------------------------
    // PHASE 1 + 2 — God Mode session already injected; load the workbench.
    // --------------------------------------------------------------------------
    const response = await page.goto("/admin/factory-bom");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/admin\/factory-bom/);
    await expect(page.getByTestId("factory-bom-title")).toHaveText(/Factory BOM Builder/i);
    await expect(page.getByTestId("factory-bom-status-banner")).toBeVisible();
    await expect(page.getByText(GODMODE_EMAIL)).toBeVisible();

    await page.getByTestId("factory-bom-search").fill("FIN-TEST-SOFA");
    const productButton = page.getByTestId(`factory-bom-product-${E2E_FG_SKU}`);
    await expect(productButton).toBeVisible();
    await productButton.click();

    await expect(page.getByTestId("factory-bom-recipe-status")).toContainText(/Auto-generated/i);

    // CUSH holds RM-FAB-GENERIC in the two-level FRAME/CUSH graph.
    await page.getByTestId(`factory-bom-parent-${E2E_CUSH_SKU}`).click();
    await expect(page.getByTestId(`factory-bom-line-${E2E_FABRIC_SKU}`)).toBeVisible();
    const fabricQty = page.getByTestId(`factory-bom-qty-${E2E_FABRIC_SKU}`);
    await expect(fabricQty).toBeVisible();
    await fabricQty.fill("8.5");
    await fabricQty.blur();
    await expect(page.getByText("Draft quantity updated")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`factory-bom-qty-${E2E_FABRIC_SKU}`)).toHaveValue("8.5");
    await expect(page.getByTestId("factory-bom-recipe-status")).toContainText(/Edited/i);

    const combobox = page.getByTestId("factory-bom-material-combobox");
    await combobox.click();
    await combobox.fill(E2E_CAP_SKU);
    const capOption = page.getByTestId(`factory-bom-material-option-${E2E_CAP_SKU}`);
    await expect(capOption).toBeVisible({ timeout: 10_000 });
    await capOption.click();
    await page.getByTestId("factory-bom-add-qty").fill("4");
    await page.getByTestId("factory-bom-add-line").click();
    await expect(page.getByText("Draft line saved")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`factory-bom-line-${E2E_CAP_SKU}`)).toBeVisible();
    await expect(page.getByTestId(`factory-bom-line-${E2E_FABRIC_SKU}`)).toBeVisible();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/product_bom/i);
      void dialog.accept();
    });
    await page.getByTestId("factory-bom-approve").click();
    await expect(page.getByText("Draft copied to live product_bom")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("factory-bom-recipe-status")).toContainText(
      /Factory approved/i,
    );

    // --------------------------------------------------------------------------
    // PHASE 3 — bypass the UI; query Postgres directly.
    // --------------------------------------------------------------------------
    const db = getDb();
    const draftRows = await db
      .select()
      .from(product_bom_draft)
      .where(eq(product_bom_draft.parent_sku, E2E_CUSH_SKU));
    expect(draftRows.length).toBeGreaterThan(0);
    expect(draftRows.every((row) => row.status === "factory_approved")).toBeTruthy();

    const liveRows = await db.select().from(product_bom);
    const liveByParent = (parent: string) =>
      liveRows.filter((row) => row.parent_sku === parent);

    const fgChildren = liveByParent(E2E_FG_SKU).map((row) => row.child_sku).sort();
    expect(fgChildren).toEqual([E2E_CUSH_SKU, E2E_FRAME_SKU].sort());
    expect(fgChildren).not.toContain(E2E_CAP_SKU);

    const cushKids = liveByParent(E2E_CUSH_SKU);
    const cushFabric = cushKids.find((row) => row.child_sku === E2E_FABRIC_SKU);
    expect(cushFabric, "RM-FAB-GENERIC must copy onto live CUSH BOM").toBeTruthy();
    expect(Number(cushFabric!.quantity)).toBeCloseTo(8.5, 4);
    const cushCap = cushKids.find((row) => row.child_sku === E2E_CAP_SKU);
    expect(cushCap, "Added RM-HRD-2X2-CAP must stay on the CUSH parent").toBeTruthy();
    expect(Number(cushCap!.quantity)).toBeCloseTo(4, 4);

    const frameKids = liveByParent(E2E_FRAME_SKU).map((row) => row.child_sku);
    expect(frameKids).toContain(E2E_POWDER_SKU);
    expect(frameKids).not.toContain(E2E_CAP_SKU);

    // --------------------------------------------------------------------------
    // PHASE 4 — catalog recipe payload (relational rows, not a flat string).
    // --------------------------------------------------------------------------
    await page.getByRole("button", { name: "Publish recipes to Katana" }).click();
    await expect(
      page.getByText(/Catalog recipes posted|Dry-run|Synced/i),
    ).toBeVisible({ timeout: 30_000 });

    const preview = await fetchRecipePreview(page, E2E_FG_SKU);
    expect(preview.ok).toBeTruthy();
    expect(preview.finishedGoodSku).toBe(E2E_FG_SKU);
    expect(preview.path).toBe("/recipes");
    expect(preview.method).toBe("POST");
    expect(Array.isArray(preview.katanaRecipePosts)).toBeTruthy();
    expect(preview.katanaRecipePosts.length).toBeGreaterThan(0);

    for (const post of preview.katanaRecipePosts) {
      expect(post).toEqual(expect.objectContaining({ keep_current_rows: false }));
      expect(Array.isArray(post.rows)).toBeTruthy();
      expect(typeof post.rows).not.toBe("string");
      for (const row of post.rows) {
        expect(typeof row).toBe("object");
        expect(typeof row.product_sku).toBe("string");
        expect(typeof row.ingredient_sku).toBe("string");
        expect(typeof row.quantity).toBe("number");
      }
    }

    const fabricRow = preview.hubLines.find(
      (line) =>
        line.parentSku === E2E_CUSH_SKU && line.childSku === E2E_FABRIC_SKU,
    );
    expect(fabricRow, "preview must include CUSH → RM-FAB-GENERIC").toBeTruthy();
    expect(fabricRow!.quantity).toBeCloseTo(8.5, 4);

    const framePost = preview.katanaRecipePosts.find((post) =>
      post.rows.some((row) => row.product_sku === E2E_FRAME_SKU),
    );
    const cushPost = preview.katanaRecipePosts.find((post) =>
      post.rows.some((row) => row.product_sku === E2E_CUSH_SKU),
    );
    expect(framePost, "FRAME recipe block must stay a separate parent").toBeTruthy();
    expect(cushPost, "CUSH recipe block must stay a separate parent").toBeTruthy();
    expect(
      cushPost!.rows.some(
        (row) => row.ingredient_sku === E2E_FABRIC_SKU && row.quantity === 8.5,
      ),
    ).toBeTruthy();

    const captured = await page.request.get("/api/qa/katana-mirror/captures");
    if (captured.ok()) {
      const payload = (await captured.json()) as {
        captures: Array<{ path: string; body: unknown }>;
      };
      const recipeCaptures = payload.captures.filter((item) =>
        item.path.includes("recipes"),
      );
      for (const item of recipeCaptures) {
        expect(typeof item.body).toBe("object");
        expect(typeof item.body).not.toBe("string");
        const body = item.body as { rows?: unknown };
        expect(Array.isArray(body.rows)).toBeTruthy();
      }
    }

    // Browser-side route is a safety net; hub publish is a server action.
    expect(Array.isArray(browserKatanaPosts)).toBeTruthy();
  });
});

async function fetchRecipePreview(page: Page, sku: string): Promise<RecipePreview> {
  const response = await page.request.get(
    `/api/qa/katana-recipe-preview?sku=${encodeURIComponent(sku)}`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as RecipePreview;
}
