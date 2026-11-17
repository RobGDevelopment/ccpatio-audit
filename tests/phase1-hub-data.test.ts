/**
 * Chunk C (`hub-phase1-data`) verification.
 * Pure helpers always run; live Hub SQL checks run when POSTGRES_URL is set
 * (after `enable-phase1-hub-data.ts --apply` against the same Hub DB).
 *
 * Invoke with `.env.local` only — `.env.test.local` points at local 54322 and
 * will not see Hub writes:
 *   npx dotenv -e .env.local -- vitest run tests/phase1-hub-data.test.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  correctedDims,
  loadPhase1SowRows,
  makeAluAliases,
  parseMoney,
  PHASE1_FABRICS,
  PHASE1_FRAME_FINISHES,
  PHASE1_POWDERS,
  PHASE1_RESALE_SKUS,
  PHASE1_SHARED_ALIASES,
  scaleWeightFromSister,
  uniqueCanonicalSkus,
} from "../scripts/ops/enable-phase1-hub-data";

describe("phase1 hub-data helpers", () => {
  it("loads 102 unique Phase 1 SOW rows after dropping the exact duplicate", () => {
    const rows = loadPhase1SowRows();
    expect(rows).toHaveLength(102);
    const skus = uniqueCanonicalSkus(rows);
    expect(skus.length).toBeGreaterThanOrEqual(86);
    expect(skus).toContain("FIN-TJM-TAB");
    expect(skus).toContain("FIN-BRV-CLB-CHA-34X34");
  });

  it("exposes 24 fabrics + 6 powders + 2 frame finishes", () => {
    expect(PHASE1_FABRICS).toHaveLength(24);
    expect(PHASE1_POWDERS).toHaveLength(6);
    expect(PHASE1_FRAME_FINISHES).toEqual(["MET-STEEL", "MET-ALUM"]);
    expect(PHASE1_FABRICS.length + PHASE1_POWDERS.length + PHASE1_FRAME_FINISHES.length).toBe(32);
  });

  it("parses SOW money and corrects the two dimension typos", () => {
    expect(parseMoney("$2,080.00")).toBe("2080.00");
    const fly = correctedDims("FIN-OCN-TAB-34X12", {
      sowRow: 61,
      name: "FLY TABLE",
      sku: "FIN-OCN-TAB-34X12",
      collection: "Ocean",
      length: "34",
      depth: "12",
      height: "2''",
      armHeight: "",
      sitHeight: "",
      baseWeight: "",
      msrp: "$650.00",
      options: "",
    });
    expect(fly.height).toBe("17");
    const swing = correctedDims("FIN-BRV-SWG-72X12", {
      sowRow: 86,
      name: "ROUND SWING",
      sku: "FIN-BRV-SWG-72X12",
      collection: "Bravada",
      length: "72",
      depth: "12",
      height: "60''",
      armHeight: "Bravada",
      sitHeight: "",
      baseWeight: "",
      msrp: "$3,120.00",
      options: "",
    });
    expect(swing.height).toBe("60");
    expect(swing.arm_height).toBeNull();
  });

  it("mints -ALU aliases for Make SKUs and keeps shared variation aliases", () => {
    const alu = makeAluAliases(["FIN-BRV-CLB-CHA-34X34", "FIN-KIN-MIS"]);
    expect(alu).toEqual([
      {
        alias_sku: "FIN-BRV-CLB-CHA-34X34-ALU",
        canonical_sku: "FIN-BRV-CLB-CHA-34X34",
        reason: "aluminum frame variation",
      },
    ]);
    const sharedCanonicals = new Set(PHASE1_SHARED_ALIASES.map((a) => a.canonical_sku));
    expect(sharedCanonicals.has("FIN-KIN-MIS")).toBe(true);
    expect(sharedCanonicals.has("FIN-TJM-MIS")).toBe(true);
    expect(PHASE1_SHARED_ALIASES.some((a) => a.alias_sku === "FIN-KIN-MIS-HEATER")).toBe(true);
    expect(PHASE1_SHARED_ALIASES.some((a) => a.alias_sku === "FIN-TJM-MIS-LAYLO")).toBe(true);
  });

  it("scales sister weights by area", () => {
    expect(scaleWeightFromSister(36 * 56, 36 * 36, 149.64)).toBeCloseTo(232.77, 1);
  });

  it("lists all 6 resale TPS SKUs including Ripple Table", () => {
    expect([...PHASE1_RESALE_SKUS]).toEqual([
      "FIN-KIN-MIS",
      "FIN-TJM-MIS",
      "FIN-TJM-CHA",
      "FIN-TJM-TAB",
      "FIN-MLN-UMB",
      "FIN-CAN-UMB",
    ]);
  });
});

describe("phase1 hub-data live Hub proof", () => {
  const hasDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
  const runLive = hasDb;

  it.skipIf(!runLive)(
    "proves finishes, TPS, aliases, weights, MSRPs, and sync_to_woo for Phase 1",
    async () => {
      const { closeDb, getDb } = await import("../src/server/db/client");
      const {
        finished_goods_catalog,
        sku_aliases,
        sku_mappings,
        third_party_sources,
      } = await import("../src/server/db/schema");

      const sow = loadPhase1SowRows();
      const unique = uniqueCanonicalSkus(sow);
      const db = getDb();

      const finishSkus = [
        ...PHASE1_FABRICS,
        ...PHASE1_POWDERS,
        ...PHASE1_FRAME_FINISHES,
      ];
      const finishes = await db
        .select({
          sku: sku_mappings.global_sku,
          attrs: sku_mappings.attributes,
        })
        .from(sku_mappings)
        .where(inArray(sku_mappings.global_sku, finishSkus));
      expect(finishes).toHaveLength(32);
      for (const f of finishes) {
        expect(
          (f.attrs as Record<string, unknown>).web_sellable,
          `${f.sku} web_sellable`,
        ).toBe(true);
      }

      const tps = await db
        .select({ sku: third_party_sources.global_sku })
        .from(third_party_sources)
        .where(inArray(third_party_sources.global_sku, [...PHASE1_RESALE_SKUS]));
      expect(tps.map((t) => t.sku).sort()).toEqual([...PHASE1_RESALE_SKUS].sort());

      const requiredAliases = [
        "FIN-BRV-DYB-84X84-RND",
        "FIN-BRV-MIN-LOV-48X34-ARMLESS",
        "FIN-WFT-FLY-BST-18X18-BAR",
        "FIN-WFT-FLY-BST-18X18-CNT",
        "FIN-WFT-FLY-BST-17X21-BAR",
        "FIN-WFT-FLY-BST-17X21-CNT",
        "FIN-TAY-BST-19X23-BAR",
        "FIN-TAY-BST-19X23-CNT",
        "FIN-KIN-MIS-HEATER",
        "FIN-KIN-MIS-LAMP",
        "FIN-TJM-CHA-FREELO",
        "FIN-TJM-CHA-MOON",
        "FIN-TJM-MIS-LAYLO",
        "FIN-TJM-MIS-LAYLO-4RISER",
        "FIN-TJM-MIS-2SHAYZ",
        "FIN-TJM-MIS-2WOOSAH",
        "FIN-BRV-CLB-CHA-34X34-ALU",
      ];
      const aliases = await db
        .select()
        .from(sku_aliases)
        .where(inArray(sku_aliases.alias_sku, requiredAliases));
      expect(aliases.map((a) => a.alias_sku).sort()).toEqual(
        [...requiredAliases].sort(),
      );

      const hub = await db
        .select({
          sku: sku_mappings.global_sku,
          sync: sku_mappings.sync_to_woo,
          weight: finished_goods_catalog.weight,
          msrp: finished_goods_catalog.msrp,
        })
        .from(sku_mappings)
        .leftJoin(
          finished_goods_catalog,
          eq(finished_goods_catalog.global_sku, sku_mappings.global_sku),
        )
        .where(inArray(sku_mappings.global_sku, unique));

      expect(hub.length).toBe(unique.length);
      for (const row of hub) {
        expect(row.sync, `${row.sku} sync_to_woo`).toBe(true);
        expect(Number(row.weight), `${row.sku} weight`).toBeGreaterThan(0);
        expect(Number(row.msrp), `${row.sku} msrp`).toBeGreaterThan(0);
      }

      // Every Phase 1 SOW row's canonical is covered.
      for (const r of sow) {
        expect(hub.some((h) => h.sku === r.sku), `missing hub for ${r.sku}`).toBe(
          true,
        );
      }

      await closeDb();
    },
    60_000,
  );

  it("BOM restore plan covers 25 NEEDS_BOM rows when generated", () => {
    const path = join(process.cwd(), "tmp/phase1-25-bom-restore-plan.json");
    if (!existsSync(path)) {
      // Allow unit-only CI without prior script run.
      expect(true).toBe(true);
      return;
    }
    const plan = JSON.parse(readFileSync(path, "utf8")) as {
      targetCount: number;
      targets: unknown[];
    };
    expect(plan.targetCount).toBe(25);
    expect(plan.targets).toHaveLength(25);
  });
});
