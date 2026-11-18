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

  it("has exactly 169 headers matching product_export_import_headers.csv (ID without BOM)", () => {
    const expected = loadHeaders();
    expect(expected).toHaveLength(169);
    expect(expected[0]).toBe("ID");

    const { headers } = loadGeneratedCsv();
    expect(headers).toHaveLength(169);
    expect(headers[0]).toBe("ID");
    expect(headers).toEqual(expected);
    expect(headers).toContain("acf_fabric_swatches_json");
    expect(headers).toContain("Meta: _w3d_enabled");
  });

  it("covers all 102 Phase 1 SOW items with unique non-blank purchasable SKUs", () => {
    const sow = loadPhase1SowRows();
    expect(sow).toHaveLength(102);

    const { rows } = loadGeneratedCsv();
    const purchasable = rows.filter((r) => r.Type === "simple" || r.Type === "variation");
    expect(purchasable).toHaveLength(102);

    const skus = purchasable.map((r) => r.SKU);
    expect(skus.every((s) => s.trim().length > 0)).toBe(true);
    expect(new Set(skus).size).toBe(102);

    const variableParents = rows.filter((r) => r.Type === "variable");
    expect(variableParents.every((p) => !p.SKU.trim())).toBe(true);

    // Every SOW canonical (or a registered alias of it) appears as a purchasable SKU.
    const report = JSON.parse(
      readFileSync(join(process.cwd(), "tmp/primeview-phase1-csv-report.json"), "utf8"),
    ) as { handoff: Array<{ sowRow: number; canonicalSku: string; wooSku: string }> };
    expect(report.handoff).toHaveLength(102);
    const sowRows = new Set(sow.map((s) => s.sowRow));
    for (const h of report.handoff) {
      expect(sowRows.has(h.sowRow)).toBe(true);
      expect(skus).toContain(h.wooSku);
    }
  });

  it("populates fabric swatches on upholstered parents only (24 FAB-*, no example.com)", () => {
    const { rows } = loadGeneratedCsv();
    const parents = rows.filter((r) => r.Type === "variable" || r.Type === "simple");
    const withSwatches = parents.filter((p) => p.acf_fabric_swatches_json.trim());
    expect(withSwatches.length).toBeGreaterThan(10);

    const expectedJson = buildFabricSwatchesJson(
      PHASE1_FABRICS.map((sku) => ({ sku, name: sku })),
    );
    const expectedSkus = JSON.parse(expectedJson).map(
      (x: { fabric_sku: string }) => x.fabric_sku,
    );
    expect(expectedSkus).toHaveLength(24);

    for (const p of withSwatches) {
      expect(p.acf_fabric_swatches_json).not.toMatch(/example\.com/i);
      const arr = JSON.parse(p.acf_fabric_swatches_json) as Array<{
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
    if (ripple) expect(ripple.acf_fabric_swatches_json).toBe("");
    if (cantilever) expect(cantilever.acf_fabric_swatches_json).toBe("");
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

  it("preserves parent ACF add-on price metas on Bravada Club Chair", () => {
    const { rows } = loadGeneratedCsv();
    const club = rows.find((r) => r.ID === "9449" && r.Type === "variable");
    expect(club).toBeTruthy();
    expect(club!["Meta: ironwood_price"]).toBeTruthy();
    expect(club!["acf_fabric_swatches_json"]).toBeTruthy();
  });
});

describe("phase1 signed multi-path checkout smoke", () => {
  const hasDb = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
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
            { key: "frame_material", value: "MET-STEEL" },
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
            { key: "frame", value: "MET-STEEL" },
          ],
        }),
        // 3. Restored table Make (no fabric; frame + powder required)
        wooLine({
          id: 3,
          sku: "FIN-BRK-DIN-TAB-36X36",
          quantity: 1,
          meta_data: [
            { key: "powder_coat", value: "PWD-BLACK" },
            { key: "frame", value: "MET-STEEL" },
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
