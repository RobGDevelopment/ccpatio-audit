/**
 * Chunk D (`csv-smoke-live`) verification.
 *
 *   npx dotenv -e .env.local -- vitest run tests/phase1-csv-and-smoke.test.ts
 *
 * CSV assertions always run against tmp/primeview-phase1-102-import.csv.
 * Live Hub resolve + dry-run saga run when POSTGRES_URL / DATABASE_URL is set.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_FABRICS,
  PHASE1_RESALE_SKUS,
  loadPhase1SowRows,
} from "../scripts/ops/enable-phase1-hub-data";
import {
  buildFabricSwatchesJson,
  loadHeaders,
  parseCsvMultiline,
  type CsvRow,
} from "../scripts/ops/generate-primeview-phase1-csv";
import { verifyWooWebhookSignature } from "@/server/woocommerce/ingress";
import { wooLine, wooOrder } from "./helpers/woo-fakes";

const CSV_PATH = join(process.cwd(), "tmp/primeview-phase1-102-import.csv");
const HANDOFF_PATH = join(process.cwd(), "tmp/PRIMEVIEW_PHASE1_HANDOFF_SPEC.md");
const SECRET = "phase1-csv-smoke-secret";

function loadGeneratedCsv(): { headers: string[]; rows: CsvRow[] } {
  const table = parseCsvMultiline(readFileSync(CSV_PATH, "utf8"));
  const headers = (table[0] ?? []).map((h) => h.replace(/^\uFEFF/, ""));
  const rows = table.slice(1).map((cols) => {
    const o: CsvRow = {};
    for (let i = 0; i < headers.length; i++) o[headers[i]!] = cols[i] ?? "";
    return o;
  });
  return { headers, rows };
}

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("phase1 csv structural assertions", () => {
  it("writes the import CSV and handoff artifacts", () => {
    expect(existsSync(CSV_PATH), "tmp/primeview-phase1-102-import.csv missing — run generate-primeview-phase1-csv.ts").toBe(
      true,
    );
    expect(existsSync(HANDOFF_PATH), "tmp/PRIMEVIEW_PHASE1_HANDOFF_SPEC.md missing").toBe(true);
  });

  it("has exactly 173 headers (169 PrimeView + 4 native 3D/finish Meta) matching product_export_import_headers.csv", () => {
    const expected = loadHeaders();
    expect(expected).toHaveLength(173);
    expect(expected[0]).toBe("ID");

    const { headers } = loadGeneratedCsv();
    expect(headers).toHaveLength(173);
    expect(headers[0]).toBe("ID");
    expect(headers).toEqual(expected);
    expect(headers).toContain("Meta: acf_fabric_swatches_json");
    expect(headers).toContain("Meta: acf_powder_swatches_json");
    expect(headers).toContain("Meta: acf_dekton_swatches_json");
    expect(headers).toContain("Meta: acf_3d_model_glb_url");
    expect(headers).toContain("Meta: acf_3d_model_usdz_url");
    expect(headers).toContain("Meta: _w3d_enabled");
  });

  it("covers all 102 Phase 1 SOW items with 107 unique purchasable SKUs (Corner L/R facing)", () => {
    const sow = loadPhase1SowRows();
    expect(sow).toHaveLength(102);

    const { rows } = loadGeneratedCsv();
    const purchasable = rows.filter((r) => r.Type === "simple" || r.Type === "variation");
    expect(purchasable).toHaveLength(107);
    expect(rows.filter((r) => r.Type === "variation")).toHaveLength(100);
    expect(rows.filter((r) => r.Type === "simple")).toHaveLength(7);

    const skus = purchasable.map((r) => r.SKU);
    expect(skus.every((s) => s.trim().length > 0)).toBe(true);
    expect(new Set(skus).size).toBe(107);

    const variableParents = rows.filter((r) => r.Type === "variable");
    expect(variableParents.every((p) => !p.SKU.trim())).toBe(true);

    // Corner Sofa / Chaise expose Select Facing + both -LS and -RS SKUs.
    for (const pid of ["27674", "27687"]) {
      const parent = rows.find((r) => r.ID === pid && r.Type === "variable");
      expect(parent, `parent ${pid}`).toBeTruthy();
      expect(parent!["Attribute 2 name"]).toBe("Select Facing");
      expect(parent!["Attribute 2 value(s)"]).toContain("Left-Side Facing");
      expect(parent!["Attribute 2 value(s)"]).toContain("Right-Side Facing");
      expect(parent!["Attribute 2 default"]).toBe("Left-Side Facing");
    }
    const facingSkus = skus.filter((s) => /FIN-BRV-COR-(SOF|CHS)-.+-(LS|RS)$/.test(s));
    expect(facingSkus.length).toBe(10);

    const report = JSON.parse(
      readFileSync(join(process.cwd(), "tmp/primeview-phase1-csv-report.json"), "utf8"),
    ) as { handoff: Array<{ sowRow: number; canonicalSku: string; wooSku: string }> };
    expect(report.handoff).toHaveLength(107);
    const sowRows = new Set(sow.map((s) => s.sowRow));
    for (const h of report.handoff) {
      expect(sowRows.has(h.sowRow)).toBe(true);
      expect(skus).toContain(h.wooSku);
    }
    expect(new Set(report.handoff.map((h) => h.sowRow)).size).toBe(102);
  });

  it("populates fabric swatches on upholstered parents only (24 FAB-*, no example.com)", () => {
    const { rows } = loadGeneratedCsv();
    const parents = rows.filter((r) => r.Type === "variable" || r.Type === "simple");
    const fabricKey = "Meta: acf_fabric_swatches_json";
    const withSwatches = parents.filter((p) => (p[fabricKey] ?? "").trim());
    expect(withSwatches.length).toBeGreaterThan(10);

    const expectedJson = buildFabricSwatchesJson(
      PHASE1_FABRICS.map((sku) => ({ sku, name: sku })),
    );
    const expectedSkus = JSON.parse(expectedJson).map(
      (x: { fabric_sku: string }) => x.fabric_sku,
    );
    expect(expectedSkus).toHaveLength(24);

    for (const p of withSwatches) {
      expect(p[fabricKey]).not.toMatch(/example\.com/i);
      const arr = JSON.parse(p[fabricKey]) as Array<{
        label: string;
        color: string;
        image_url: string;
        fabric_sku: string;
      }>;
      expect(arr).toHaveLength(24);
      expect(arr.map((a) => a.fabric_sku).sort()).toEqual([...PHASE1_FABRICS].sort());
      for (const a of arr) {
        expect(a.image_url.startsWith("https://")).toBe(true);
        expect(a.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(a.label.length).toBeGreaterThan(0);
      }
    }

    // Non-upholstered tables/resale simples should stay blank
    const ripple = parents.find((p) => p.ID === "28335");
    const cantilever = parents.find((p) => p.ID === "28343");
    if (ripple) expect(ripple[fabricKey]).toBe("");
    if (cantilever) expect(cantilever[fabricKey]).toBe("");
  });

  it("requires positive Regular price + Weight (kg) on purchasable rows and blanks _w3d_enabled", () => {
    const { rows } = loadGeneratedCsv();
    const purchasable = rows.filter((r) => r.Type === "simple" || r.Type === "variation");
    for (const r of purchasable) {
      expect(Number(r["Regular price"]), `${r.SKU} price`).toBeGreaterThan(0);
      expect(Number(r["Weight (kg)"]), `${r.SKU} weight`).toBeGreaterThan(0);
      expect(["parcel", "freight-ltl"]).toContain(r["Shipping class"]);
    }
    for (const r of rows) {
      expect(r["Meta: _w3d_enabled"]).toBe("");
      expect(r["Meta: _w3d_model_url"]).toBe("");
    }
  });

  it("bakes Mia PDF Aluminum website prices into Regular price; pillows/resale stay 1.00x", () => {
    const { rows } = loadGeneratedCsv();
    const bySku = new Map(
      rows
        .filter((r) => r.Type === "simple" || r.Type === "variation")
        .map((r) => [r.SKU, r] as const),
    );
    // Mia PDF Aluminum (Oct 1 base + manual $0/$5) — NOT steel × 1.10
    expect(Number(bySku.get("FIN-BRV-CLB-CHA-34X34")!["Regular price"])).toBe(2530);
    expect(Number(bySku.get("FIN-BRV-SWV-CHA-34X34")!["Regular price"])).toBe(2970);
    expect(Number(bySku.get("FIN-BRV-LOV-SOF-60X34")!["Regular price"])).toBe(3175);
    expect(Number(bySku.get("FIN-CAB-MIS-17X17")!["Regular price"])).toBe(65);
    expect(Number(bySku.get("FIN-CAB-MIS-23X23")!["Regular price"])).toBe(95);
    expect(Number(bySku.get("FIN-CAB-MIS-12X24")!["Regular price"])).toBe(65);
    expect(Number(bySku.get("FIN-CAN-UMB")!["Regular price"])).toBe(5150);
    expect(Number(bySku.get("FIN-KIN-MIS-HEATER")!["Regular price"])).toBe(5695);
    // Resale Ripple Table stays vendor retail
    const ripple = [...bySku.values()].find((r) => r.SKU === "FIN-TJM-TAB");
    if (ripple) expect(Number(ripple["Regular price"])).toBe(464.99);
  });

  it("preserves parent ACF add-on price metas on Bravada Club Chair", () => {
    const { rows } = loadGeneratedCsv();
    const club = rows.find((r) => r.ID === "9449" && r.Type === "variable");
    expect(club).toBeTruthy();
    expect(club!["Meta: ironwood_price"]).toBeTruthy();
    expect(club!["Meta: acf_fabric_swatches_json"]).toBeTruthy();
  });
});

describe("phase1 P0 live Hub + swatch + qa-test guards", () => {
  // CI spins an empty local Postgres; live Hub suites need the real schema.
  const hasDb =
    Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL) &&
    !/^postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\b/i.test(
      process.env.POSTGRES_URL ?? "",
    );

  it("qa-test production guard returns blocked without ALLOW_LOCAL_QA_TEST", async () => {
    const { isQaTestProductionBlocked } = await import("@/app/api/qa-test/route");
    expect(
      isQaTestProductionBlocked({
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it.skipIf(!hasDb)(
    "all 107 CSV purchasable SKUs resolve cleanly against live Hub (aliases OK)",
    async () => {
      const { closeDb } = await import("../src/server/db/client");
      const { hubResolveDeps, resolveWooOrder } = await import(
        "../src/server/woocommerce/sku-resolver"
      );
      const { rows } = loadGeneratedCsv();
      const purchasable = rows.filter((r) => r.Type === "simple" || r.Type === "variation");
      expect(purchasable).toHaveLength(107);

      const deps = hubResolveDeps();
      const report = JSON.parse(
        readFileSync(join(process.cwd(), "tmp/primeview-phase1-csv-report.json"), "utf8"),
      ) as { handoff: Array<{ wooSku: string; canonicalSku: string }> };
      const byWoo = new Map(report.handoff.map((h) => [h.wooSku.toUpperCase(), h]));

      for (const row of purchasable) {
        const handoff = byWoo.get(row.SKU.toUpperCase());
        expect(handoff, `missing handoff for ${row.SKU}`).toBeTruthy();
        const aliasMap = deps.resolveAliases
          ? await deps.resolveAliases([row.SKU])
          : new Map<string, string>();
        const viaAlias = aliasMap.get(row.SKU.toUpperCase());
        const canonical = (
          viaAlias ??
          handoff!.canonicalSku ??
          row.SKU
        ).toUpperCase();
        const records = await deps.lookupSkus([canonical]);
        expect(records.has(canonical), `${row.SKU} → ${canonical} missing in Hub`).toBe(true);
        const rec = records.get(canonical)!;
        expect(rec.isActive, `${canonical} inactive`).toBe(true);
        expect(rec.katanaVariantId, `${canonical} null katana_variant_id`).not.toBeNull();
        void resolveWooOrder;
      }
      await closeDb();
    },
    180_000,
  );

  it.skipIf(!hasDb)(
    "zero Phase 1 ASM-* BOM children have null katana_variant_id",
    async () => {
      const { closeDb, getDb } = await import("../src/server/db/client");
      const { explodeBomTree } = await import("../src/server/db/queries/bom");
      const { inArray } = await import("drizzle-orm");
      const { sku_mappings } = await import("../src/server/db/schema");
      const {
        PHASE1_RESALE_SKUS,
        loadPhase1SowRows,
        uniqueCanonicalSkus,
      } = await import("../scripts/ops/enable-phase1-hub-data");

      const makeSkus = uniqueCanonicalSkus(loadPhase1SowRows()).filter(
        (s) => !(PHASE1_RESALE_SKUS as readonly string[]).includes(s),
      );
      const asm = new Set<string>();
      for (const parent of makeSkus) {
        for (const row of await explodeBomTree(parent)) {
          const child = row.child_sku?.trim().toUpperCase();
          if (child?.startsWith("ASM-")) asm.add(child);
        }
      }
      const db = getDb();
      const vids = await db
        .select({
          sku: sku_mappings.global_sku,
          vid: sku_mappings.katana_variant_id,
        })
        .from(sku_mappings)
        .where(inArray(sku_mappings.global_sku, [...asm]));
      const nulls = vids.filter((r) => r.vid == null).map((r) => r.sku);
      expect(nulls, `null ASM vids: ${nulls.join(", ")}`).toEqual([]);
      await closeDb();
    },
    180_000,
  );

  it.skipIf(!hasDb)(
    "15 mapped ACF add-ons resolve on '1' with non-null katana ids; custom welded quarantines",
    async () => {
      const { closeDb } = await import("../src/server/db/client");
      const { hubResolveDeps, resolveWooOrder } = await import(
        "../src/server/woocommerce/sku-resolver"
      );
      const { ACF_ADDON_DEFAULT_SKUS } = await import(
        "../src/server/woocommerce/line-specs"
      );

      const deps = hubResolveDeps();
      const mappedKeys = Object.keys(ACF_ADDON_DEFAULT_SKUS);
      expect(mappedKeys.length).toBeGreaterThanOrEqual(15);

      for (const key of mappedKeys) {
        const order = wooOrder({
          line_items: [
            wooLine({
              sku: "FIN-BRV-CLB-CHA-34X34",
              meta_data: [
                { key: "fabric_sku", value: "FAB-ACT-STO" },
                { key: "powder_coat", value: "PWD-BONE" },
                { key: "frame_material", value: "MET-ALUM" },
                { key: key, value: "1" },
              ],
            }),
          ],
        });
        const resolution = await resolveWooOrder(order, deps, { requireKatanaIds: false });
        expect(
          resolution.ok,
          resolution.ok
            ? ""
            : `${key}: ${resolution.issues.map((i) => i.message).join("; ")}`,
        ).toBe(true);
        if (!resolution.ok) continue;
        const expected = ACF_ADDON_DEFAULT_SKUS[key]!.toUpperCase();
        const addonLine = resolution.lines.find((l) => l.spec.sku === expected);
        expect(addonLine, `${key} → ${expected}`).toBeTruthy();
        expect(addonLine!.baseVariantId, `${expected} null vid`).not.toBeNull();
      }

      const custom = await resolveWooOrder(
        wooOrder({
          line_items: [
            wooLine({
              sku: "FIN-BRV-CLB-CHA-34X34",
              meta_data: [
                { key: "fabric_sku", value: "FAB-ACT-STO" },
                { key: "powder_coat", value: "PWD-BONE" },
                { key: "frame_material", value: "MET-ALUM" },
                { key: "custom_welded_fly_table", value: "1" },
              ],
            }),
          ],
        }),
        deps,
        { requireKatanaIds: false },
      );
      expect(custom.ok).toBe(false);
      if (!custom.ok) {
        expect(
          custom.issues.some((i) => i.message.includes("custom_quote_addon_requires_sales")),
        ).toBe(true);
      }
      await closeDb();
    },
    300_000,
  );

  it("live fetch against Meta: acf_fabric_swatches_json image_url returns HTTP 200", async () => {
    const fabricKey = "Meta: acf_fabric_swatches_json";
    const { rows } = loadGeneratedCsv();
    const parent = rows.find(
      (r) => r.Type === "variable" && (r[fabricKey] ?? "").trim(),
    );
    expect(parent).toBeTruthy();
    const arr = JSON.parse(parent![fabricKey]) as Array<{
      image_url: string;
      fabric_sku: string;
    }>;
    expect(arr).toHaveLength(24);
    for (const a of arr) {
      const res = await fetch(a.image_url, { method: "HEAD" });
      const ok = res.ok ? res : await fetch(a.image_url, { method: "GET" });
      expect(ok.status, `${a.fabric_sku} ${a.image_url}`).toBe(200);
    }
  }, 120_000);
});

describe("phase1 signed multi-path checkout smoke", () => {
  // CI spins an empty local Postgres; live Hub suites need the real schema.
  const hasDb =
    Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL) &&
    !/^postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\b/i.test(
      process.env.POSTGRES_URL ?? "",
    );
  const IRONWOOD_ADDON_SKU = "FIN-ESY-MIS-ADDIRONWOOD";
  const UMBRELLA_COVER_SKU = "FIN-ESY-MIS-WEATHERPROOFCO";

  /** Realistic multi-line order covering Make seating/table/pillow + Resale + alias. */
  function phase1SmokeOrder() {
    return wooOrder({
      id: 910_102,
      number: "910102",
      line_items: [
        // 1. Club chair Ready-Make: powder swap off hardcoded PWD-BLACK + boolean ironwood.
        wooLine({
          id: 1,
          sku: "FIN-BRV-CLB-CHA-34X34",
          quantity: 1,
          meta_data: [
            { key: "fabric_sku", value: "FAB-ACT-STO" },
            { key: "powder_coat", value: "PWD-BONE" },
            { key: "frame_material", value: "MET-ALUM" },
            { key: "ironwood", value: "1" },
          ],
        }),
        // 2. Restored Make barstool alias (swappable powder via RM-PWD-GENERIC)
        wooLine({
          id: 2,
          sku: "FIN-WFT-FLY-BST-18X18-BAR",
          quantity: 1,
          meta_data: [
            { key: "fabric", value: "FAB-BER-TUX" },
            { key: "powder_coat", value: "PWD-BLACK" },
            { key: "frame", value: "MET-ALUM" },
          ],
        }),
        // 3. Restored table Make (no fabric; frame + powder required)
        wooLine({
          id: 3,
          sku: "FIN-BRK-DIN-TAB-36X36",
          quantity: 1,
          meta_data: [
            { key: "powder_coat", value: "PWD-BLACK" },
            { key: "frame", value: "MET-ALUM" },
          ],
        }),
        // 4. Restored pillow Make (fabric only)
        wooLine({
          id: 4,
          sku: "FIN-CAB-MIS-17X17",
          quantity: 1,
          meta_data: [{ key: "fabric", value: "FAB-BLI-LIN" }],
        }),
        // 5a. Resale Ripple Table
        wooLine({
          id: 5,
          sku: "FIN-TJM-TAB",
          quantity: 1,
          meta_data: [],
        }),
        // 5b. Resale Cantilever Umbrella + boolean umbrella_cover checkbox
        wooLine({
          id: 6,
          sku: "FIN-CAN-UMB",
          quantity: 1,
          meta_data: [{ key: "umbrella_cover", value: "1" }],
        }),
      ],
    });
  }

  it("HMAC-verifies the signed multi-path payload", () => {
    const body = JSON.stringify(phase1SmokeOrder());
    const good = sign(body);
    expect(verifyWooWebhookSignature(body, good, SECRET)).toBe(true);
    expect(verifyWooWebhookSignature(body, sign(body, "wrong"), SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(body, null, SECRET)).toBe(false);
  });

  it.skipIf(!hasDb)(
    "resolves 100% of lines without quarantine and dry-runs saga with zero Katana writes",
    async () => {
      const { closeDb } = await import("../src/server/db/client");
      const { hubResolveDeps, resolveWooOrder } = await import(
        "../src/server/woocommerce/sku-resolver"
      );
      const { runWooOrderSaga, defaultWooSagaDeps } = await import("@/inngest/woo-order");
      const { WOO_DELIVERY_KEY_FIELD } = await import("@/server/woocommerce/ingress");

      const order = phase1SmokeOrder();
      const deps = hubResolveDeps();
      const resolution = await resolveWooOrder(order, deps, { requireKatanaIds: false });
      expect(
        resolution.ok,
        resolution.ok
          ? ""
          : resolution.issues.map((i) => `${i.path}: ${i.message}`).join("\n"),
      ).toBe(true);
      if (!resolution.ok) return;

      // Parent Make lines + expanded ironwood/cover add-on lines + 2 resale
      const parentSkus = resolution.lines.map((l) => l.spec.sku);
      expect(parentSkus).toContain("FIN-BRV-CLB-CHA-34X34");
      expect(parentSkus).toContain("FIN-WFT-FLY-BST-18X18"); // alias → canonical
      expect(parentSkus).toContain("FIN-BRK-DIN-TAB-36X36");
      expect(parentSkus).toContain("FIN-CAB-MIS-17X17");
      expect(parentSkus).toContain("FIN-TJM-TAB");
      expect(parentSkus).toContain("FIN-CAN-UMB");
      expect(parentSkus).toContain(IRONWOOD_ADDON_SKU);
      expect(parentSkus).toContain(UMBRELLA_COVER_SKU);

      const bySku = new Map(resolution.lines.map((l) => [l.spec.sku, l]));
      expect(bySku.get("FIN-BRV-CLB-CHA-34X34")!.skipMo).toBe(false);
      expect(bySku.get("FIN-WFT-FLY-BST-18X18")!.skipMo).toBe(false);
      expect(bySku.get("FIN-BRK-DIN-TAB-36X36")!.skipMo).toBe(false);
      expect(bySku.get("FIN-CAB-MIS-17X17")!.skipMo).toBe(false);
      expect(bySku.get("FIN-TJM-TAB")!.skipMo).toBe(true);
      expect(bySku.get("FIN-CAN-UMB")!.skipMo).toBe(true);
      expect(bySku.get(IRONWOOD_ADDON_SKU)!.skipMo).toBe(true);
      expect(bySku.get(UMBRELLA_COVER_SKU)!.skipMo).toBe(true);

      const clubPowder = bySku
        .get("FIN-BRV-CLB-CHA-34X34")!
        .finishes.find((f) => f.slot === "powder_coat");
      expect(clubPowder).toMatchObject({
        sku: "PWD-BONE",
        placeholderSku: "PWD-BLACK",
        mode: "swap",
      });

      // Resale SKUs are the Phase 1 TPS set
      for (const sku of ["FIN-TJM-TAB", "FIN-CAN-UMB"] as const) {
        expect(PHASE1_RESALE_SKUS).toContain(sku);
      }

      // Saga dry-run under ORDER_PIPELINE_MODE=log — Katana must never be touched.
      const prevMode = process.env.ORDER_PIPELINE_MODE;
      process.env.ORDER_PIPELINE_MODE = "log";

      const katanaCalls: string[] = [];
      const base = defaultWooSagaDeps();
      const mem = new Map<string, { status: string; current_step: string | null; last_error: string | null }>();
      const store = {
        async insertOnce(input: {
          sagaType: string;
          correlationKey: string;
          status?: string;
          currentStep?: string | null;
        }) {
          const k = `${input.sagaType}|${input.correlationKey}`;
          if (mem.has(k)) return { row: mem.get(k)!, inserted: false };
          const row = {
            status: input.status ?? "IN_PROGRESS",
            current_step: input.currentStep ?? null,
            last_error: null,
          };
          mem.set(k, row);
          return { row, inserted: true };
        },
        async get(t: string, c: string) {
          return mem.get(`${t}|${c}`) ?? null;
        },
        async setStep(t: string, c: string, step: string) {
          mem.get(`${t}|${c}`)!.current_step = step;
        },
        async setStatus(
          t: string,
          c: string,
          status: string,
          extra: { currentStep?: string | null; lastError?: string | null } = {},
        ) {
          const row = mem.get(`${t}|${c}`)!;
          row.status = status;
          if (extra.currentStep !== undefined) row.current_step = extra.currentStep;
          if (extra.lastError !== undefined) row.last_error = extra.lastError;
        },
        async fail(t: string, c: string, error: unknown) {
          const row = mem.get(`${t}|${c}`)!;
          row.status = "SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION";
          row.last_error = error instanceof Error ? error.message : String(error);
        },
      };

      const stepMemo = new Map<string, unknown>();
      const ran: string[] = [];
      const step = {
        run: async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
          if (stepMemo.has(id)) return stepMemo.get(id) as T;
          const result = await fn();
          stepMemo.set(id, result);
          ran.push(id);
          return result;
        },
      };

      const result = await runWooOrderSaga({
        event: {
          data: {
            ...order,
            [WOO_DELIVERY_KEY_FIELD]: "woo-delivery:phase1-csv-smoke",
          },
        },
        step: step as never,
        deps: {
          ...base,
          store: store as never,
          resolve: deps,
          updateAudit: async () => undefined,
          getModes: () => ({ orderMode: "log" as const, ledgerMode: "log" as const }),
          katana: {
            findSalesOrderByOrderNo: async () => {
              katanaCalls.push("findSalesOrderByOrderNo");
              throw new Error("Katana must not be called in log mode");
            },
            getSalesOrderRows: async () => {
              katanaCalls.push("getSalesOrderRows");
              throw new Error("Katana must not be called in log mode");
            },
            createSalesOrder: async () => {
              katanaCalls.push("createSalesOrder");
              throw new Error("Katana must not be called in log mode");
            },
            findMoIdForRow: async () => {
              katanaCalls.push("findMoIdForRow");
              throw new Error("Katana must not be called in log mode");
            },
            createMoForRow: async () => {
              katanaCalls.push("createMoForRow");
              throw new Error("Katana must not be called in log mode");
            },
            bindPlaceholder: async () => {
              katanaCalls.push("bindPlaceholder");
              throw new Error("Katana must not be called in log mode");
            },
          } as never,
        },
      });

      expect(result).toMatchObject({
        ok: true,
        dryRun: true,
        pipelineMode: "log",
        orderId: 910_102,
      });
      expect(ran).toContain("resolve-specs-dry-run");
      expect(ran).toContain("woo-dry-run");
      expect(ran.some((id) => id.startsWith("mto-row-") || id.includes("ensure-katana"))).toBe(
        false,
      );
      expect(katanaCalls).toEqual([]);

      // Routing proof from resolve: Make → SO+MO path (skipMo=false); Resale → SO-only (skipMo=true)
      const makeLines = resolution.lines.filter((l) => !l.skipMo);
      const resaleLines = resolution.lines.filter((l) => l.skipMo);
      expect(makeLines.length).toBeGreaterThanOrEqual(4);
      expect(resaleLines.length).toBeGreaterThanOrEqual(2);

      if (prevMode === undefined) delete process.env.ORDER_PIPELINE_MODE;
      else process.env.ORDER_PIPELINE_MODE = prevMode;
      await closeDb();
    },
    180_000,
  );
});
