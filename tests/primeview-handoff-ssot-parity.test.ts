import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
  filterActiveEcommerceFinishes,
  isLegacyShowroomFinishSku,
} from "@/lib/ecommerce-roster";
import {
  PHASE1_PARENT_COUNT,
  PHASE1_PURCHASABLE_SKU_COUNT,
  PHASE1_SIMPLE_COUNT,
  PHASE1_SOW_ITEM_COUNT,
  PHASE1_VARIATION_COUNT,
} from "@/server/ecommerce/phase1-portal";
import {
  assertPowderCoatParity,
  buildCertifiedFinishExportRows,
  buildStorefrontAddonsExport,
  certifiedFinishesToCsv,
  partnerTypeBadge,
} from "@/server/ecommerce/primeview-handoff-ssot";
import { buildWooDiagnosticReport } from "@/server/ecommerce/executive-stack-health";
import { authenticatePrimeviewHandoffToken } from "@/lib/primeview-handoff-auth";

const ROOT = process.cwd();

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("primeview-handoff-portal-ssot-parity · force-dynamic + SSOT wiring", () => {
  it("exports force-dynamic + revalidate=0 on partner page and download route", () => {
    const page = read("src/app/partner/primeview-handoff/page.tsx");
    const route = read("src/app/api/partner/primeview-handoff/download/route.ts");
    expect(page).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
    expect(page).toMatch(/export const revalidate\s*=\s*0/);
    expect(route).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
    expect(route).toMatch(/export const revalidate\s*=\s*0/);
    expect(route).toMatch(/no-store,\s*must-revalidate/);
  });

  it("partner page loads Certified SSOT (no raw listFinishAssets, no calibration mutations)", () => {
    const page = read("src/app/partner/primeview-handoff/page.tsx");
    expect(page).toContain("loadPartnerHandoffSsot");
    expect(page).not.toContain("onSaveCalibration");
    expect(page).not.toContain("updateFinishAsset");
    expect(page).not.toMatch(/listFinishAssets\(\)/);
  });

  it("partner client is read-only: no upload/save/Katana/QBO/intake leaks", () => {
    const client = read("src/app/partner/primeview-handoff/PartnerHandoffClient.tsx");
    expect(client).toContain('data-testid="partner-handoff-portal"');
    expect(client).toContain("partner-tab-finishes");
    expect(client).toContain("partner-tab-products");
    expect(client).toContain("partner-tab-sync");
    expect(client).toContain("partner-storefront-addons");
    expect(client).toContain("FullResImageLightbox");
    expect(client).toContain("partner-retest-staging");
    expect(client).toContain("partner-copy-diagnostic");
    expect(client).toContain("Download 32 Certified Finishes");
    expect(client).toContain("Download 107 Certified Aluminum Products");
    expect(client).not.toMatch(/Full 38 Finishes/);
    expect(client).not.toContain("onSaveCalibration");
    expect(client).not.toContain("uploadPartnerAsset");
    expect(client).not.toContain("PartnerDrop");
    expect(client).not.toMatch(/Katana stock|QuickBooks|finish_intake|QBO/);
    expect(client).not.toContain("onReplace");
    expect(client).not.toContain("portal-tab-intake");
  });

  it("wires lightbox Fit / 1:1 / 3×3 / Prev-Next without Replace", () => {
    const client = read("src/app/partner/primeview-handoff/PartnerHandoffClient.tsx");
    expect(client).toContain("hasPrev");
    expect(client).toContain("hasNext");
    expect(client).toContain("onPrev");
    expect(client).toContain("onNext");
    // onReplace omitted — FullResImageLightbox hides Replace when undefined
    expect(client).not.toMatch(/onReplace=\{/);
  });
});

describe("Certified roster parity constants (32 / 107 / 102)", () => {
  it("locks exact 32 finishes with 6/6 powder Gray/Beige/Bronze and zero PWD-BEIGE", () => {
    expect(ECOMMERCE_32_FINISHES).toHaveLength(ECOMMERCE_32_FINISH_COUNT);
    expect(ECOMMERCE_32_FINISH_COUNT).toBe(32);
    const powders = ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder");
    expect(powders).toHaveLength(6);
    const names = new Set(powders.map((f) => f.displayName));
    expect(names.has("Gray")).toBe(true);
    expect(names.has("Beige")).toBe(true);
    expect(names.has("Bronze")).toBe(true);
    expect(powders.some((p) => p.sku === "PWD-BEIGE")).toBe(false);
    expect(isLegacyShowroomFinishSku("PWD-BEIGE")).toBe(true);
    expect(
      filterActiveEcommerceFinishes([{ sku: "PWD-BEIGE" }, { sku: "PWD-LITE-BEIGE" }]).map(
        (r) => r.sku,
      ),
    ).toEqual(["PWD-LITE-BEIGE"]);
  });

  it("locks 107 purchasable / 47 parents / 100 vars / 7 simple / 102 Mia SOW", () => {
    expect(PHASE1_PURCHASABLE_SKU_COUNT).toBe(107);
    expect(PHASE1_PARENT_COUNT).toBe(47);
    expect(PHASE1_VARIATION_COUNT).toBe(100);
    expect(PHASE1_SIMPLE_COUNT).toBe(7);
    expect(PHASE1_SOW_ITEM_COUNT).toBe(102);
  });

  it("marks Kindle heater / lamp / Lay'd lounger as Simple (never -LS/-RS)", () => {
    expect(
      partnerTypeBadge({
        globalSku: "3P-KINDLE-HEATER-D15",
        productName: "Kindle Living Heater (d15cm)",
        collectionLabel: "Kindle Living",
        hasLsRsPair: true,
        variationCount: 2,
      }),
    ).toBe("Simple");
    expect(
      partnerTypeBadge({
        globalSku: "3P-KINDLE-LAMP",
        productName: "Kindle Living Lamp",
        hasLsRsPair: true,
      }),
    ).toBe("Simple");
    expect(
      partnerTypeBadge({
        globalSku: "3P-LAYD-LOUNGER",
        productName: "Lay'd Lounger",
        hasLsRsPair: true,
      }),
    ).toBe("Simple");
    expect(
      partnerTypeBadge({
        globalSku: "FIN-BRV-SEC-LS",
        wooSku: "FIN-BRV-SEC-LS",
        productName: "Bravada Sectional Left",
        collectionLabel: "Bravada",
      }),
    ).toBe("Left-Side (-LS)");
  });
});

describe("Certified exports + diagnostic", () => {
  it("builds 32-finish CSV columns and never includes legacy PWD-BEIGE / FAB-ACT-ASH", () => {
    const rows = buildCertifiedFinishExportRows(
      ECOMMERCE_32_FINISHES.map((f) => ({
        sku: f.sku,
        finishCategory: f.category,
        family: f.family,
        displayName: f.displayName,
        hexCode: f.hex,
        vendorSku: f.aliases[0] ?? null,
        factorySkuRef: null,
        swatchThumbUrl: null,
        texture2kUrl: null,
        patternRepeatWIn: f.patternRepeatIn?.w ?? null,
        patternRepeatHIn: f.patternRepeatIn?.h ?? null,
        textureScale: 8,
        textureSha256: "abcdef0123456789",
        sourceType: null,
        sourceFilename: null,
        textureWidthPx: 2048,
        textureHeightPx: 2048,
        qualityStatus: "photoshoot_verified" as const,
        apfGroup: "Cushion & Pillow",
        apfSlotKey: "cushion_fabric" as const,
        updatedAt: new Date().toISOString(),
      })),
    );
    expect(rows).toHaveLength(32);
    const csv = certifiedFinishesToCsv(rows);
    expect(csv).toContain("sku,display_name,material_class,apf_group");
    expect(csv).toContain("texture_scale");
    expect(csv).toContain("sha256");
    // Legacy PWD-BEIGE may appear only as a mill alias under PWD-LITE-BEIGE — never as a SKU row.
    expect(csv).toMatch(/^PWD-LITE-BEIGE,/m);
    expect(csv).not.toMatch(/^PWD-BEIGE,/m);
    expect(csv).not.toMatch(/^FAB-ACT-ASH,/m);
    expect(rows.some((r) => r.sku === "PWD-BEIGE")).toBe(false);
    expect(rows.some((r) => r.sku === "FAB-ACT-ASH")).toBe(false);
    const powderViews = ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder").map((f) => ({
      sku: f.sku,
      finishCategory: f.category,
      family: f.family,
      displayName: f.displayName,
      hexCode: f.hex,
      vendorSku: null,
      factorySkuRef: null,
      swatchThumbUrl: null,
      texture2kUrl: null,
      patternRepeatWIn: null,
      patternRepeatHIn: null,
      textureScale: 4,
      textureSha256: null,
      sourceType: null,
      sourceFilename: null,
      textureWidthPx: 2048,
      textureHeightPx: 2048,
      qualityStatus: "photoshoot_verified" as const,
      apfGroup: "Aluminum Frame",
      apfSlotKey: "frame_finish" as const,
      updatedAt: "",
    }));
    expect(assertPowderCoatParity(powderViews).ok).toBe(true);
  });

  it("storefront add-ons export includes APF slot mapping + ACF keys", () => {
    const addons = buildStorefrontAddonsExport();
    expect(addons.addons).toHaveLength(5);
    expect(addons.apf_slot_mapping.cushion_fabric).toBe("Cushion & Pillow");
    expect(addons.apf_slot_mapping.table_top).toBe("Dekton Tabletop");
    expect(addons.apf_slot_mapping.frame_finish).toBe("Aluminum Frame");
    expect(addons.finishes_roster_count).toBe(32);
    expect(addons.acf_keys.length).toBeGreaterThan(0);
  });

  it("CCP-DIAG-WOO report has 6 sections and staged 32/107 counts", () => {
    const report = buildWooDiagnosticReport({
      host: "ccpatiodev2.primeview.com",
      httpStatus: 500,
      label: "WordPress PHP Critical Error",
      snippet: "There has been a critical error on this website.",
      finishesStaged: 32,
      aluminumSkusStaged: 107,
    });
    expect(report).toMatch(/CCP-DIAG-WOO-\d{8}/);
    expect(report).toContain("── 1. Executive Summary ──");
    expect(report).toContain("── 2. Live Telemetry & Probe Evidence ──");
    expect(report).toContain("── 3. Isolation & Change-Control Attestation ──");
    expect(report).toContain("── 4. Required PrimeView Engineering Actions ──");
    expect(report).toContain("── 5. Staged Payload Summary ──");
    expect(report).toContain("Finishes staged (certified roster): 32");
    expect(report).toContain("Aluminum SKUs staged (purchasable): 107");
  });
});

describe("Download route · Certified-only + Cache-Control", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects missing/invalid token", async () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "parity-token-xyz");
    const { GET } = await import("@/app/api/partner/primeview-handoff/download/route");
    expect(
      (await GET(new Request("http://localhost/api/partner/primeview-handoff/download?artifact=finishes-json")))
        .status,
    ).toBe(401);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/partner/primeview-handoff/download?artifact=finishes-json&token=bad",
          ),
        )
      ).status,
    ).toBe(403);
  });

  it("serves finishes-json / finishes-csv / addons-json with no-store and zero legacy 38", async () => {
    vi.stubEnv("PRIMEVIEW_HANDOFF_TOKEN", "parity-token-xyz");

    vi.doMock("@/server/ecommerce/primeview-handoff-ssot", async () => {
      const actual = await vi.importActual<
        typeof import("@/server/ecommerce/primeview-handoff-ssot")
      >("@/server/ecommerce/primeview-handoff-ssot");
      const finishes = ECOMMERCE_32_FINISHES.map((f) => ({
        sku: f.sku,
        finishCategory: f.category,
        family: f.family,
        displayName: f.displayName,
        hexCode: f.hex,
        vendorSku: null,
        factorySkuRef: null,
        swatchThumbUrl: null,
        texture2kUrl: null,
        patternRepeatWIn: null,
        patternRepeatHIn: null,
        textureScale: 8,
        textureSha256: "deadbeefcafebabe",
        sourceType: null,
        sourceFilename: null,
        textureWidthPx: 2048,
        textureHeightPx: 2048,
        qualityStatus: "photoshoot_verified" as const,
        apfGroup: "Cushion & Pillow",
        apfSlotKey: "cushion_fabric" as const,
        updatedAt: new Date().toISOString(),
      }));
      return {
        ...actual,
        loadCertifiedPartnerFinishes: vi.fn(async () => ({ finishes, error: null })),
        buildCertifiedFinishesManifestForDownload: vi.fn(async () => ({
          generatedAtUtc: "2026-11-27T00:00:00.000Z",
          count: 32,
          finishes: actual.buildCertifiedFinishExportRows(finishes),
          counts: { fabrics: 20, powders: 6, dektons: 6, total: 32 },
          fabrics: [],
          powders: [],
          dektons: [],
        })),
      };
    });

    const { GET } = await import("@/app/api/partner/primeview-handoff/download/route");
    const auth = authenticatePrimeviewHandoffToken("parity-token-xyz");
    expect(auth.ok).toBe(true);

    const jsonRes = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=finishes-json&token=parity-token-xyz",
      ),
    );
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get("cache-control")).toMatch(/no-store/);
    const body = (await jsonRes.json()) as { count: number; finishes: Array<{ sku: string }> };
    expect(body.count).toBe(32);
    expect(body.finishes.some((f) => f.sku === "PWD-BEIGE")).toBe(false);
    expect(body.finishes.some((f) => f.sku === "FAB-ACT-ASH")).toBe(false);

    const csvRes = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=finishes-csv&token=parity-token-xyz",
      ),
    );
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("cache-control")).toMatch(/no-store/);
    const csv = await csvRes.text();
    expect(csv).toContain("PWD-LITE-BEIGE");
    expect(csv).not.toContain("PWD-BEIGE,");

    const addonsRes = await GET(
      new Request(
        "http://localhost/api/partner/primeview-handoff/download?artifact=addons-json&token=parity-token-xyz",
      ),
    );
    expect(addonsRes.status).toBe(200);
    expect(addonsRes.headers.get("cache-control")).toMatch(/no-store/);
    const addons = (await addonsRes.json()) as { addons: unknown[] };
    expect(addons.addons).toHaveLength(5);
  });
});
