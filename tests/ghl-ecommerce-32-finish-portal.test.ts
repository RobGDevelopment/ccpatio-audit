import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertExact32Roster,
  buildFinishAutoSku,
  canAccessEcommercePortal,
  canAccessFullMasterCatalog,
  ECOMMERCE_32_FINISH_COUNT,
  ECOMMERCE_32_FINISHES,
  filterActiveEcommerceFinishes,
  filterAluminumOnlyFrameExport,
  generateCollisionCheckedFinishSku,
  isEcommerce32FinishSku,
  isFinishSkuLocked,
  resolveEcommerceFinishSku,
  tokensFromFinishDisplayName,
} from "@/lib/ecommerce-roster";
import {
  PHASE1_DEKTONS,
  PHASE1_FABRICS,
  PHASE1_FRAME_FINISHES,
  PHASE1_FRAME_FINISHES_FACTORY,
  PHASE1_POWDERS,
  PHASE1_SOW_ITEM_COUNT,
  reconcileMiaApprovedCounts,
  sowKeyFromSku,
} from "@/server/ecommerce/phase1-portal";
import { MET_ALUM_SKU, MET_STEEL_SKU } from "@/server/woocommerce/finish-keys";
import { STEEL_DISCONTINUED_REASON } from "@/server/ecommerce/alu10-pricing";
import { buildFinishAutoSku as engineBuildFinishSku, isFinishSkuLocked as engineSkuLocked } from "@/server/ecommerce/auto-sku-engine";

const ROOT = process.cwd();

describe("exact 32 e-commerce finish roster", () => {
  it("contains exactly 32 unique finishes (16+4+6+6)", () => {
    assertExact32Roster();
    expect(ECOMMERCE_32_FINISHES).toHaveLength(ECOMMERCE_32_FINISH_COUNT);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "sunbrella")).toHaveLength(16);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "ultraleather")).toHaveLength(4);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "dekton")).toHaveLength(6);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder")).toHaveLength(6);
  });

  it("maps Phase 1 portal lists to the exact 32 roster", () => {
    expect(PHASE1_FABRICS).toHaveLength(20);
    expect(PHASE1_POWDERS).toHaveLength(6);
    expect(PHASE1_DEKTONS).toHaveLength(6);
    expect(PHASE1_FABRICS).toContain("FAB-CAN-WHI");
    expect(PHASE1_FABRICS).toContain("FAB-BLA-MOO");
    expect(PHASE1_FABRICS).not.toContain("FAB-ACT-ASH");
    expect(PHASE1_POWDERS).toContain("PWD-WHITE");
    expect(PHASE1_POWDERS).not.toContain("PWD-WILD-RICE");
    expect(PHASE1_DEKTONS.map((d) => d.sku)).toEqual(
      expect.arrayContaining(["DKT-ALDEM", "DKT-NILIUM", "DKT-STRATO"]),
    );
    expect(PHASE1_DEKTONS.every((d) => d.sku.startsWith("DKT-"))).toBe(true);
  });

  it("hides non-roster showroom swatches from active e-commerce filtering", () => {
    const rows = [
      { sku: "FAB-CAN-WHI", uploaded_by: null },
      { sku: "FAB-ACT-ASH", uploaded_by: null },
      { sku: "FAB-RIT-NEC", uploaded_by: "ecommerce:disabled" },
      { sku: "DKT-ALDEM", uploadedBy: null },
    ];
    const active = filterActiveEcommerceFinishes(rows);
    expect(active.map((r) => r.sku)).toEqual(["FAB-CAN-WHI", "DKT-ALDEM"]);
    expect(isEcommerce32FinishSku("FAB-ACT-ASH")).toBe(false);
    expect(resolveEcommerceFinishSku("PWD-WILD-RICE")).toBe("PWD-WHITE");
    expect(resolveEcommerceFinishSku("DEC-NILIUM")).toBe("DKT-NILIUM");
  });
});

describe("aluminum-only frame export rule", () => {
  it("exports MET-ALUM only and quarantines steel + steel upcharge", () => {
    expect([...PHASE1_FRAME_FINISHES]).toEqual([MET_ALUM_SKU]);
    expect([...PHASE1_FRAME_FINISHES_FACTORY]).toEqual([MET_STEEL_SKU, MET_ALUM_SKU]);

    const { exported, quarantined } = filterAluminumOnlyFrameExport([
      { sku: MET_ALUM_SKU, label: "Aluminum", steelUpchargePct: null },
      { sku: MET_STEEL_SKU, label: "Steel", steelUpchargePct: 0.1 },
      { sku: "MET-STEEL-FRAME", label: "Steel Frame", steelUpchargePct: 0.1 },
      { sku: "MET-CUSTOM", label: "Custom +10%", steelUpchargePct: 0.1 },
    ]);

    expect(exported).toHaveLength(1);
    expect(exported[0]!.sku).toBe(MET_ALUM_SKU);
    expect(exported[0]!.steelUpchargePct).toBeNull();
    expect(quarantined.length).toBeGreaterThanOrEqual(2);
    expect(quarantined.every((q) => q.reason === STEEL_DISCONTINUED_REASON)).toBe(true);
  });
});

describe("auto-SKU generation + SKU lock", () => {
  it("mints FAB-/PWD-/DKT- codes and keeps them locked", () => {
    expect(buildFinishAutoSku({ category: "fabric", familyCode: "CAN", colorCode: "WHI" })).toBe(
      "FAB-CAN-WHI",
    );
    expect(buildFinishAutoSku({ category: "powder", familyCode: "WHITE", colorCode: "WHITE" })).toBe(
      "PWD-WHITE",
    );
    expect(buildFinishAutoSku({ category: "dekton", familyCode: "ALDEM", colorCode: "ALDEM" })).toBe(
      "DKT-ALDEM",
    );
    expect(tokensFromFinishDisplayName("Black Moor", "fabric")).toEqual({
      category: "fabric",
      familyCode: "BLA",
      colorCode: "MOO",
    });
    expect(engineBuildFinishSku(tokensFromFinishDisplayName("Black Moor", "fabric"))).toBe(
      "FAB-BLA-MOO",
    );
    expect(isFinishSkuLocked("FAB-CAN-WHI")).toBe(true);
    expect(engineSkuLocked("PWD-BLACK")).toBe(true);
  });

  it("collision-checks finish SKUs when allocating + rows", async () => {
    const known = new Set(["FAB-CAN-WHI"]);
    const minted = await generateCollisionCheckedFinishSku(
      { category: "fabric", familyCode: "CAN", colorCode: "WHI" },
      async (sku) => known.has(sku),
    );
    expect(minted.collided).toBe(true);
    expect(minted.sku).toBe("FAB-CAN-WHI2");
    expect(minted.sku).not.toBe("FAB-CAN-WHI");
  });
});

describe("E-Commerce portal role access", () => {
  it("allows Mia, Kian, Superadmin, Ops_Manager, and GHL embed", () => {
    expect(canAccessEcommercePortal({ email: "mia@ccpatio.com", role: "Designer" })).toBe(true);
    expect(canAccessEcommercePortal({ email: "kian@ccpatio.com", role: null })).toBe(true);
    expect(canAccessEcommercePortal({ email: "ops@ccpatio.com", role: "SuperAdmin" })).toBe(true);
    expect(canAccessEcommercePortal({ email: "ops@ccpatio.com", role: "Ops_Manager" })).toBe(true);
    expect(canAccessEcommercePortal({ email: "ghl-embed@ccpatio.com", embedSession: true })).toBe(
      true,
    );
    expect(canAccessEcommercePortal({ email: "designer@ccpatio.com", role: "Designer" })).toBe(
      false,
    );
    expect(canAccessFullMasterCatalog({ role: "SuperAdmin" })).toBe(true);
    expect(canAccessFullMasterCatalog({ role: "Ops_Manager" })).toBe(false);
  });
});

describe("Mia Approved count reconciliation (102 SOW, not 107 variations)", () => {
  it("collapses -LS/-RS facing pairs into one SOW key", () => {
    expect(sowKeyFromSku("FIN-BRV-SOFA-84-LS")).toBe("FIN-BRV-SOFA-84");
    expect(sowKeyFromSku("FIN-BRV-SOFA-84-RS")).toBe("FIN-BRV-SOFA-84");
    const { miaApprovedCount, sowItemCount } = reconcileMiaApprovedCounts([
      { globalSku: "FIN-A-LS", miaApproved: true },
      { globalSku: "FIN-A-RS", miaApproved: true },
      { globalSku: "FIN-B", miaApproved: false },
      { globalSku: "FIN-C", miaApproved: true },
    ]);
    expect(sowItemCount).toBe(PHASE1_SOW_ITEM_COUNT);
    expect(miaApprovedCount).toBe(2);
  });
});

describe("default GHL route is dark 3-tab portal (no legacy chrome)", () => {
  it("ships portal tabs + legacy-admin escape hatch; no default Upcharge bar", () => {
    const page = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/page.tsx"),
      "utf8",
    );
    const portal = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx"),
      "utf8",
    );
    const partner = readFileSync(
      join(ROOT, "src/app/partner/primeview-handoff/PartnerHandoffClient.tsx"),
      "utf8",
    );

    expect(page).toContain('view") === "legacy-admin"');
    expect(page).toContain("legacy-back-to-portal");
    expect(page).toContain("EcommerceCertificationPortal");
    expect(page).toContain("system-health-pill");

    expect(portal).toContain("portal-tab-finishes");
    expect(portal).toContain("portal-tab-products");
    expect(portal).toContain("portal-tab-sync");
    expect(portal).toContain("portal-search-input");
    expect(portal).toContain("E-Commerce Certification & Handoff Portal");
    expect(portal).toContain("#0b0f17");
    expect(portal).not.toContain("Recalculate Upcharge %");
    expect(portal).not.toContain("upcharge-pct-input");

    expect(partner).toContain("Upholstery Swatches");
    expect(partner).toContain("Dekton Stones");
    expect(partner).toContain("Powder-Coat Finishes");
    expect(partner).toContain("Active Finishes");
    expect(partner).not.toContain("24 Fabric Swatches");
  });
});
