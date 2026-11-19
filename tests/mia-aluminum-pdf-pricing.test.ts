import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MISSING_MILAN_OTTOMANS,
  ODD_DOLLAR_PDF_ROWS,
  PRICE_REVIEW_MISSING,
  PRICE_REVIEW_ODD,
  isOddDollarPrice,
  phase1SpotCheckSkus,
  resolveWebsitePriceFromFixture,
  roundNearest5Alu,
  suggestedNearest5,
  type MiaPdfFixture,
} from "@/server/ecommerce/mia-aluminum-pricing";
import { roundNearest5AluFromBase } from "@/server/ecommerce/alu10-pricing";
import { autoWooAluminumPrice } from "@/server/ecommerce/auto-sku-engine";
import { loadPhase1SowRows } from "../scripts/ops/enable-phase1-hub-data";
import {
  loadHeaders,
  parseCsvMultiline,
  type CsvRow,
} from "../scripts/ops/generate-primeview-phase1-csv";

const FIXTURE_PATH = join(
  process.cwd(),
  "data_migration/Pricing/mia-aluminum-pricelist-2026-11-19.json",
);
const CSV_PATH = join(process.cwd(), "tmp/primeview-phase1-102-import.csv");

function loadFixture(): MiaPdfFixture {
  expect(existsSync(FIXTURE_PATH), "Mia aluminum fixture missing — run ingest script").toBe(
    true,
  );
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as MiaPdfFixture;
}

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

describe("mia nearest-$5 math", () => {
  it("matches Milan ottoman pre-pop formula", () => {
    for (const m of MISSING_MILAN_OTTOMANS) {
      expect(roundNearest5Alu(m.sowMsrp)).toBe(m.aluminum);
      expect(roundNearest5AluFromBase(m.sowMsrp)).toBe(m.aluminum);
    }
  });

  it("defaults New Product wizard to nearest-$5", () => {
    const preview = autoWooAluminumPrice({
      origin: "manufactured",
      steelBaseMsrp: 2080,
      metalFramedMake: true,
    });
    expect(preview.wooPrice).toBe(2290); // round((2080*1.1)/5)*5
  });

  it("flags odd dollars and suggests nearest $5", () => {
    expect(isOddDollarPrice(3328)).toBe(true);
    expect(suggestedNearest5(3328)).toBe(3330);
    expect(suggestedNearest5(2772)).toBe(2770);
    expect(suggestedNearest5(902)).toBe(900);
    expect(isOddDollarPrice(2530)).toBe(false);
    expect(isOddDollarPrice(464.99)).toBe(false);
  });
});

describe("mia aluminum PDF fixture", () => {
  it("has ~258 rows with 228 metal + flags for 6 odd + 4 missing Milan", () => {
    const f = loadFixture();
    expect(f.metal_row_count).toBe(228);
    expect(f.row_count).toBeGreaterThanOrEqual(250);
    expect(f.rows.filter((r) => r.price_review_flag === PRICE_REVIEW_ODD)).toHaveLength(6);
    expect(f.rows.filter((r) => r.price_review_flag === PRICE_REVIEW_MISSING)).toHaveLength(4);
    expect(phase1SpotCheckSkus()).toHaveLength(7);

    expect(f.sku_price_index["FIN-BRV-CLB-CHA-34X34"]?.price).toBe(2530);
    expect(f.sku_price_index["FIN-BRV-SWV-CHA-34X34"]?.price).toBe(2970);
    expect(f.sku_price_index["FIN-BRV-LOV-SOF-60X34"]?.price).toBe(3175);
    expect(f.sku_price_index["FIN-BRV-ARM-SOF-72X34"]?.price).toBe(3875);
    expect(f.sku_price_index["FIN-BRV-SOF-84X34"]?.price).toBe(4435);
    expect(f.sku_price_index["FIN-BRV-DYB-72X72"]?.price).toBe(7480);
    expect(f.sku_price_index["FIN-BRV-DYB-84X72"]?.price).toBe(7755);
    expect(f.sku_price_index["FIN-BRV-DYB-84X84"]?.price).toBe(8140);
    expect(f.sku_price_index["FIN-BRV-DYB-84X84-RND"]?.price).toBe(8415);
    expect(f.sku_price_index["FIN-BRV-SWG-72X12"]?.price).toBe(3600);
    expect(f.sku_price_index["FIN-BRV-SWG-96X32"]?.price).toBe(6235);
    expect(f.sku_price_index["FIN-OCN-TAB-34X12"]?.price).toBe(550);
    expect(f.sku_price_index["FIN-OCN-TAB-13X30"]?.price).toBe(550);
    expect(f.sku_price_index["FIN-BRV-COR-SOF-72X34-LS"]?.price).toBe(4345);
    expect(f.sku_price_index["FIN-CAN-UMB"]?.price).toBe(5150);
    expect(f.sku_price_index["FIN-KIN-MIS-HEATER"]?.price).toBe(5695);
    expect(f.sku_price_index["FIN-KIN-MIS-LAMP"]?.price).toBe(5595);
    expect(f.sku_price_index["FIN-MLN-UMB"]?.price).toBe(950);

    for (const m of MISSING_MILAN_OTTOMANS) {
      expect(f.sku_price_index[m.sku]?.price).toBe(m.aluminum);
      expect(f.sku_price_index[m.sku]?.flag).toBe(PRICE_REVIEW_MISSING);
    }
    for (const odd of ODD_DOLLAR_PDF_ROWS) {
      if (!odd.skuHint) continue;
      expect(f.sku_price_index[odd.skuHint]?.price).toBe(odd.price);
      expect(f.sku_price_index[odd.skuHint]?.flag).toBe(PRICE_REVIEW_ODD);
    }
  });
});

describe("phase1 CSV matches Mia PDF for all 107 Woo SKUs", () => {
  it("103 exact PDF matches + 4 flagged Milan ottomans", () => {
    expect(existsSync(CSV_PATH), "tmp CSV missing — run generate-primeview-phase1-csv.ts").toBe(
      true,
    );
    const fixture = loadFixture();
    const sow = loadPhase1SowRows();
    expect(sow).toHaveLength(102);
    const { headers, rows } = loadGeneratedCsv();
    expect(headers).toEqual(loadHeaders());

    const purchasable = rows.filter((r) => r.Type === "simple" || r.Type === "variation");
    expect(purchasable).toHaveLength(107);

    const bySku = new Map(purchasable.map((r) => [r.SKU, r]));
    expect(Number(bySku.get("FIN-BRV-CLB-CHA-34X34")!["Regular price"])).toBe(2530);
    expect(Number(bySku.get("FIN-BRV-SWV-CHA-34X34")!["Regular price"])).toBe(2970);
    expect(Number(bySku.get("FIN-BRV-LOV-SOF-60X34")!["Regular price"])).toBe(3175);
    expect(Number(bySku.get("FIN-KIN-MIS-HEATER")!["Regular price"])).toBe(5695);
    expect(Number(bySku.get("FIN-KIN-MIS-LAMP")!["Regular price"])).toBe(5595);
    expect(Number(bySku.get("FIN-CAN-UMB")!["Regular price"])).toBe(5150);
    expect(Number(bySku.get("FIN-MLN-OTT-22X60")!["Regular price"])).toBe(1410);
    expect(Number(bySku.get("FIN-MLN-OTT-22X72")!["Regular price"])).toBe(1650);
    expect(Number(bySku.get("FIN-MLN-OTT-34X60")!["Regular price"])).toBe(2035);
    expect(Number(bySku.get("FIN-MLN-OTT-56X42")!["Regular price"])).toBe(2245);

    let exactPdf = 0;
    let flaggedMilan = 0;
    for (const row of purchasable) {
      const price = Number(row["Regular price"]);
      expect(price, row.SKU).toBeGreaterThan(0);
      const fromFixture = resolveWebsitePriceFromFixture(fixture, {
        sku: row.SKU.replace(/-(LS|RS)$/i, ""),
        wooSku: row.SKU,
      });
      if (
        MISSING_MILAN_OTTOMANS.some((m) => m.sku === row.SKU.replace(/-(LS|RS)$/i, ""))
      ) {
        flaggedMilan += 1;
        expect(price).toBe(fromFixture);
        continue;
      }
      if (fromFixture != null) {
        expect(price, `${row.SKU} should match Mia fixture`).toBe(fromFixture);
        exactPdf += 1;
      }
    }
    expect(flaggedMilan).toBe(4);
    expect(exactPdf).toBeGreaterThanOrEqual(103);
  });
});
