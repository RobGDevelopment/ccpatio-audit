/**
 * Chunk C2 (`phase1-katana-bom-restore`) verification.
 * Pure helpers always run; live Hub SQL + sku-resolver checks run when
 * POSTGRES_URL is set (after `restore-phase1-25-boms.ts --apply`).
 *
 *   npx dotenv -e .env.local -- vitest run tests/phase1-bom-restore.test.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  loadPhase1SowRows,
  PHASE1_RESALE_SKUS,
} from "../scripts/ops/enable-phase1-hub-data";
import {
  assertPillowSafe,
  assertTableSafe,
  bomKindForSku,
  buildPillowOnlyDocument,
  buildRestoreDocument,
  NEEDS_BOM_SOW_ROWS,
  UNIQUE_NEEDS_BOM_SKUS,
} from "../scripts/ops/restore-phase1-25-boms";
import { wooOrder, wooLine } from "./helpers/woo-fakes";

describe("phase1 bom-restore helpers", () => {
  it("covers 25 SOW rows and 22 unique Canonical SKUs", () => {
    expect(NEEDS_BOM_SOW_ROWS).toHaveLength(25);
    expect(UNIQUE_NEEDS_BOM_SKUS).toHaveLength(22);
    expect(new Set(NEEDS_BOM_SOW_ROWS.map((r) => r.sku)).size).toBe(22);
  });

  it("classifies seating / table / pillow kinds", () => {
    expect(bomKindForSku("FIN-MLN-SOF-72X36")).toBe("seating");
    expect(bomKindForSku("FIN-BRK-BAR-TAB-36X36")).toBe("table");
    expect(bomKindForSku("FIN-CAB-MIS-17X17")).toBe("pillow");
    expect(bomKindForSku("FIN-WFT-FLY-BST-18X18")).toBe("seating");
  });

  it("builds dimensionally scaled seating FRAME+CUSH with fabric + swappable powder", () => {
    const doc = buildRestoreDocument("FIN-MLN-SOF-72X36");
    expect(doc.status).toBe("ready");
    expect(doc.frameSku).toBe("ASM-MLN-SOF-72X36-FRAME");
    expect(doc.cushionSku).toBe("ASM-MLN-SOF-72X36-CUSH");
    const all = doc.parents.flatMap((p) => p.rows.map((r) => r.ingredientSku));
    expect(all).toContain("RM-FAB-GENERIC");
    expect(all).toContain("RM-PWD-GENERIC");
    expect(all.some((s) => s.startsWith("PWD-") && s !== "RM-PWD-GENERIC")).toBe(false);
  });

  it("builds table BOMs with zero fabric and swappable powder", () => {
    const doc = buildRestoreDocument("FIN-BRK-DIN-TAB-42X42");
    assertTableSafe(doc);
    const all = doc.parents.flatMap((p) => p.rows.map((r) => r.ingredientSku));
    expect(all).not.toContain("RM-FAB-GENERIC");
    expect(all).toContain("RM-PWD-GENERIC");
    expect(doc.parents.some((p) => p.role === "cushion")).toBe(false);
  });

  it("builds pillow-only BOMs with zero frame/metal/powder", () => {
    for (const sku of ["FIN-CAB-MIS-17X17", "FIN-CAB-MIS-23X23", "FIN-CAB-MIS-12X24"] as const) {
      const doc = buildPillowOnlyDocument(sku);
      assertPillowSafe(doc);
      expect(doc.frameSku).toBeNull();
      expect(doc.parents.some((p) => p.role === "frame")).toBe(false);
      const all = doc.parents.flatMap((p) => p.rows.map((r) => r.ingredientSku));
      expect(all).toContain("RM-FAB-GENERIC");
      expect(all).toContain("RM-RAW-FOAM");
      expect(all.some((s) => s.includes("TUBING") || s.startsWith("PWD-") || s.endsWith("-FRAME"))).toBe(
        false,
      );
    }
  });
});

describe("phase1 bom-restore live Hub proof", () => {
  const hasDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  const runLive = hasDb;

  it.skipIf(!runLive)(
    "proves all 91 Make + 11 Resale Phase 1 SOW rows resolve with zero NEEDS_BOM",
    async () => {
      const { closeDb, getDb } = await import("../src/server/db/client");
      const { product_bom, sku_mappings, third_party_sources } = await import(
        "../src/server/db/schema"
      );
      const {
        deriveRecipeSlots,
        hubResolveDeps,
        recipeSkusFromHub,
        resolveWooOrder,
      } = await import("../src/server/woocommerce/sku-resolver");

      const sow = loadPhase1SowRows();
      expect(sow).toHaveLength(102);
      const resaleSet = new Set<string>(PHASE1_RESALE_SKUS);
      const makeRows = sow.filter((r) => !resaleSet.has(r.sku));
      const resaleRows = sow.filter((r) => resaleSet.has(r.sku));
      expect(makeRows).toHaveLength(91);
      expect(resaleRows).toHaveLength(11);

      const db = getDb();
      const makeSkus = [...new Set(makeRows.map((r) => r.sku))];

      // Hub integrity for every Make canonical.
      const hub = await db
        .select({
          sku: sku_mappings.global_sku,
          vid: sku_mappings.katana_variant_id,
        })
        .from(sku_mappings)
        .where(inArray(sku_mappings.global_sku, makeSkus));
      expect(hub.length).toBe(makeSkus.length);

      const bomParents = await db
        .select({
          parent: product_bom.parent_sku,
          n: sql<number>`count(*)::int`,
        })
        .from(product_bom)
        .where(inArray(product_bom.parent_sku, makeSkus))
        .groupBy(product_bom.parent_sku);
      const bomCount = new Map(bomParents.map((r) => [r.parent, Number(r.n)]));

      const stillNeedsBom: string[] = [];
      for (const row of hub) {
        const children = bomCount.get(row.sku) ?? 0;
        if (children < 1 || row.vid == null) {
          stillNeedsBom.push(`${row.sku}:bom=${children}:vid=${row.vid}`);
        }
      }
      expect(stillNeedsBom, `NEEDS_BOM remaining:\n${stillNeedsBom.join("\n")}`).toEqual([]);

      // Restored SKUs: ASM children must also have katana_variant_id.
      for (const sku of UNIQUE_NEEDS_BOM_SKUS) {
        const recipe = await recipeSkusFromHub(sku);
        expect(recipe.length, `${sku} empty recipe`).toBeGreaterThan(0);
        const slots = deriveRecipeSlots(recipe);
        const kind = bomKindForSku(sku);
        if (kind === "pillow") {
          expect(slots.fabric, `${sku} fabric`).toBe(true);
          expect(slots.frame, `${sku} frame`).toBe(false);
          expect(slots.powder_coat, `${sku} powder`).toBe(false);
        } else if (kind === "table") {
          expect(slots.fabric, `${sku} fabric`).toBe(false);
          expect(slots.frame, `${sku} frame`).toBe(true);
          expect(slots.powder_coat, `${sku} powder`).toBe(true);
        } else {
          expect(slots.fabric, `${sku} fabric`).toBe(true);
          expect(slots.frame, `${sku} frame`).toBe(true);
        }
        const asmKids = recipe.filter(
          (c) => c.startsWith("ASM-") || c.startsWith("SA-"),
        );
        if (asmKids.length > 0) {
          const asmRows = await db
            .select({
              sku: sku_mappings.global_sku,
              vid: sku_mappings.katana_variant_id,
            })
            .from(sku_mappings)
            .where(inArray(sku_mappings.global_sku, asmKids));
          for (const a of asmRows) {
            expect(a.vid, `${sku} child ${a.sku} katana_variant_id`).not.toBeNull();
          }
        }
      }

      // sku-resolver: Make rows with Aluminum-only finish meta (locked storefront rule).
      const deps = hubResolveDeps();
      const FAB = "FAB-ACT-ASH";
      const PWD = "PWD-BLACK";
      const FRAME = "MET-ALUM";

      for (const row of makeRows) {
        const slots = deriveRecipeSlots(await recipeSkusFromHub(row.sku));
        const meta: Array<{ key: string; value: string }> = [];
        if (slots.fabric) meta.push({ key: "fabric", value: FAB });
        if (slots.powder_coat) meta.push({ key: "powder_coat", value: PWD });
        if (slots.frame) meta.push({ key: "frame", value: FRAME });
        // Phase 1 Make restore trees do not include RM-DKT-GENERIC-SLAB; if a
        // pre-existing Make SKU still offers dekton, skip resolver proof here
        // rather than invent a DKT-* without confirming web_sellable inventory.
        if (slots.dekton) continue;

        const res = await resolveWooOrder(
          wooOrder({
            id: 900_000 + row.sowRow,
            line_items: [wooLine({ sku: row.sku, meta_data: meta })],
          }),
          deps,
          { requireKatanaIds: false },
        );
        expect(
          res.ok,
          `${row.sku} issues: ${res.ok ? "" : res.issues.map((i) => i.message).join("; ")}`,
        ).toBe(true);
        if (!res.ok) continue;
        const line = res.lines[0]!;
        expect(line.spec.sku).toBe(row.sku);
        expect(line.skipMo).toBe(false);
      }

      // Explicit Steel on a framed Make recipe must quarantine (aluminum-only lock).
      {
        const framed = makeRows.find((r) => r.sku === "FIN-BRV-CLB-CHA-34X34") ?? makeRows[0]!;
        const steelRes = await resolveWooOrder(
          wooOrder({
            id: 900_999,
            line_items: [
              wooLine({
                sku: framed.sku,
                meta_data: [
                  { key: "fabric", value: FAB },
                  { key: "powder_coat", value: PWD },
                  { key: "frame", value: "Steel" },
                ],
              }),
            ],
          }),
          deps,
          { requireKatanaIds: false },
        );
        expect(steelRes.ok).toBe(false);
        if (!steelRes.ok) {
          expect(
            steelRes.issues.some((i) =>
              i.message.includes("steel_discontinued_on_ecommerce"),
            ),
          ).toBe(true);
        }
      }

      // Resale: third_party_sources + skipMo (isResale).
      const tps = await db
        .select({ sku: third_party_sources.global_sku })
        .from(third_party_sources)
        .where(inArray(third_party_sources.global_sku, [...PHASE1_RESALE_SKUS]));
      expect(tps.map((t) => t.sku).sort()).toEqual([...PHASE1_RESALE_SKUS].sort());

      for (const row of resaleRows) {
        const res = await resolveWooOrder(
          wooOrder({
            id: 800_000 + row.sowRow,
            line_items: [wooLine({ sku: row.sku, meta_data: [] })],
          }),
          deps,
          { requireKatanaIds: false },
        );
        expect(
          res.ok,
          `${row.sku} resale issues: ${res.ok ? "" : res.issues.map((i) => i.message).join("; ")}`,
        ).toBe(true);
        if (!res.ok) continue;
        expect(res.lines[0]?.skipMo).toBe(true);
      }

      // Zero of the 25 NEEDS_BOM SOW rows remain unresolved.
      for (const target of NEEDS_BOM_SOW_ROWS) {
        const [fg] = await db
          .select({
            vid: sku_mappings.katana_variant_id,
          })
          .from(sku_mappings)
          .where(eq(sku_mappings.global_sku, target.sku))
          .limit(1);
        expect(fg?.vid, `${target.sku} variant`).not.toBeNull();
        const [edge] = await db
          .select({ child: product_bom.child_sku })
          .from(product_bom)
          .where(eq(product_bom.parent_sku, target.sku))
          .limit(1);
        expect(edge?.child, `${target.sku} bom`).toBeTruthy();
      }

      await closeDb();
    },
    180_000,
  );
});
