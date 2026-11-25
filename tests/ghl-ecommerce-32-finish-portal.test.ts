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
import { classifyWooProbeBody } from "@/server/ecommerce/executive-stack-health";

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

  it("keeps FAB-CAB-CLA on roster with 7 inch vertical repeat", () => {
    const cabana = ECOMMERCE_32_FINISHES.find((f) => f.sku === "FAB-CAB-CLA");
    expect(cabana).toBeDefined();
    expect(cabana?.patternRepeatIn?.h).toBe(7);
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
  it("allows Mia, Kian, Superadmin, and GHL embed; denies Ops_Manager", () => {
    expect(canAccessEcommercePortal({ email: "mia@ccpatio.com", role: "Designer" })).toBe(true);
    expect(canAccessEcommercePortal({ email: "kian@ccpatio.com", role: null })).toBe(true);
    expect(canAccessEcommercePortal({ email: "ops@ccpatio.com", role: "SuperAdmin" })).toBe(true);
    expect(canAccessEcommercePortal({ email: "ops@ccpatio.com", role: "Ops_Manager" })).toBe(false);
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

describe("classifyWooProbeBody", () => {
  it("flags WordPress critical HTML as Action Required", () => {
    const body =
      "<!DOCTYPE html><html><body><p>There has been a critical error on this website.</p></body></html>";
    const verdict = classifyWooProbeBody({
      httpStatus: 200,
      contentType: "text/html",
      bodyText: body,
    });
    expect(verdict.status).toBe("Action Required");
    expect(verdict.label).toBe("WP Critical Error");
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

describe("default GHL route is dark Executive Control Center (no legacy chrome)", () => {
  it("ships full-bleed portal without legacy-admin or Upcharge escape hatches", () => {
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
    const layout = readFileSync(join(ROOT, "src/app/embed/layout.tsx"), "utf8");
    const loading = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/loading.tsx"),
      "utf8",
    );
    const stackStrip = readFileSync(
      join(
        ROOT,
        "src/app/embed/admin/master-catalog/ecommerce/ExecutiveStackHealthStrip.tsx",
      ),
      "utf8",
    );
    const archiveModal = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/ecommerce/ArchiveImpactModal.tsx"),
      "utf8",
    );
    const commitBar = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/ecommerce/PendingCommitBar.tsx"),
      "utf8",
    );

    expect(page).not.toContain('view") === "legacy-admin"');
    expect(page).not.toContain("legacy-back-to-portal");
    expect(page).toContain("EcommerceCertificationPortal");
    expect(page).toContain("PortalProductDrawer");
    expect(page).toContain("Access Restricted");

    expect(layout).toContain("h-[100dvh]");
    expect(layout).toContain("bg-[#0b0f17]");
    expect(loading).toContain("bg-[#0b0f17]");

    expect(portal).toContain("portal-tab-finishes");
    expect(portal).toContain("portal-tab-products");
    expect(portal).toContain("portal-tab-sync");
    expect(portal).toContain("portal-search-input");
    expect(portal).toContain("Executive Control Center");
    expect(portal).toContain("max-w-none");
    expect(portal).toContain("#0b0f17");
    expect(portal).toContain("overflow-y-auto");
    expect(portal).toContain("sticky top-0");
    expect(portal).toContain("storefront-readiness-pill");
    expect(portal).toContain("push-swatches-staging");
    expect(portal).toContain("push-catalog-staging");
    expect(portal).toContain("portal-sku-combobox");
    expect(portal).toContain("APF Target Group");
    expect(portal).toContain("portal-guidance-strip");
    expect(portal).toContain("ExecutiveStackHealthStrip");
    expect(portal).toContain("ArchiveImpactModal");
    expect(portal).toContain("PendingCommitBar");
    expect(portal).not.toContain("Recalculate Upcharge %");
    expect(portal).not.toContain("upcharge-pct-input");
    expect(portal).not.toContain("legacy-admin");
    expect(portal).not.toContain("mission-control");

    expect(stackStrip).toContain("executive-stack-health-strip");
    expect(archiveModal).toContain("archive-impact-modal");
    expect(commitBar).toContain("pending-commit-bar");

    expect(partner).toContain("Upholstery Swatches");
    expect(partner).toContain("Dekton Stones");
    expect(partner).toContain("Powder-Coat Finishes");
    expect(partner).toContain("Active Finishes");
    expect(partner).not.toContain("24 Fabric Swatches");
  });
});

describe("portal readiness + spot-check parity helpers", () => {
  it("strips FIN brackets and formats variations", async () => {
    const {
      stripFinBracketsFromTitle,
      formatVariationsFacing,
      storefrontDisplayTitle,
      stagingPushGuardrailMessage,
      apfTargetGroupForFamily,
    } = await import("@/server/ecommerce/portal-readiness");
    expect(stripFinBracketsFromTitle("Fly Leg Sofa [FIN-FLY-LEF-ARM-SOF-88X34]")).toBe(
      "Fly Leg Sofa",
    );
    expect(storefrontDisplayTitle("fly leg sofa [FIN-X]")).toBe("Fly Leg Sofa");
    expect(formatVariationsFacing({ globalSku: "FIN-A", hasLsRsPair: false })).toBe("Simple");
    expect(
      formatVariationsFacing({ globalSku: "FIN-A-LS", hasLsRsPair: true }),
    ).toBe("2 Vars (-LS / -RS)");
    expect(apfTargetGroupForFamily("sunbrella")).toBe("Cushion & Pillow");
    expect(apfTargetGroupForFamily("dekton")).toBe("Dekton Tabletop");
    expect(apfTargetGroupForFamily("powder")).toBe("Aluminum Frame");
    expect(stagingPushGuardrailMessage().liveWrite).toBe(false);
  });

  it("clears Needs Spot-Check when miaApproved === true", async () => {
    const { needsMiaSpotCheck } = await import("@/server/ecommerce/two-tab-portal");
    const sku = "FIN-WFT-FLY-BST-18X18-CNT";
    expect(
      needsMiaSpotCheck({
        globalSku: sku,
        wooSku: sku,
        miaApproved: false,
        attributes: { price_review_flag: "odd_dollar_in_pdf" },
      }),
    ).toBe(true);
    expect(
      needsMiaSpotCheck({
        globalSku: sku,
        wooSku: sku,
        miaApproved: true,
        attributes: { price_review_flag: "odd_dollar_in_pdf" },
      }),
    ).toBe(false);
  });

  it("resolves grouped parent + -LS/-RS candidates", async () => {
    const {
      resolveGroupedSkuCandidates,
      pickGroupedSkuRow,
    } = await import("@/server/ecommerce/grouped-sku-resolve");
    const r = resolveGroupedSkuCandidates("FIN-FLY-LEF-ARM-SOF-88X34");
    expect(r.parentSku).toBe("FIN-FLY-LEF-ARM-SOF-88X34");
    expect(r.childSkus).toEqual([
      "FIN-FLY-LEF-ARM-SOF-88X34-LS",
      "FIN-FLY-LEF-ARM-SOF-88X34-RS",
    ]);
    const picked = pickGroupedSkuRow(
      [
        { globalSku: "FIN-FLY-LEF-ARM-SOF-88X34-LS" },
        { globalSku: "FIN-FLY-LEF-ARM-SOF-88X34-RS" },
      ],
      "FIN-FLY-LEF-ARM-SOF-88X34",
    );
    expect(picked.row?.globalSku).toMatch(/FIN-FLY-LEF-ARM-SOF-88X34/);
  });

  it("extracts embed token from Authorization Bearer", async () => {
    const { extractEmbedTokenFromHeaders } = await import("@/lib/embed-auth");
    expect(
      extractEmbedTokenFromHeaders((n) =>
        n.toLowerCase() === "authorization" ? "Bearer tok-abc" : null,
      ),
    ).toBe("tok-abc");
    expect(
      extractEmbedTokenFromHeaders((n) =>
        n === "x-ccpatio-embed-token" ? "hdr-tok" : null,
      ),
    ).toBe("hdr-tok");
  });
});