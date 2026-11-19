/**
 * Idempotent Mia Aluminum PDF → JSON fixture → Hub Aluminum website price.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/ingest-mia-aluminum-pdf.ts --dry-run
 *   npx dotenv -e .env.local -- tsx scripts/ops/ingest-mia-aluminum-pdf.ts --apply
 *
 * Never commits the PDF binary. COALESCE-only on BOMs/weights/dims/descriptions/images.
 */
import { loadEnvConfig } from "@next/env";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  logistics_profiles,
  product_bom,
  sku_mappings,
} from "../../src/server/db/schema";
import {
  assertNoRegression,
  type NonNullSnapshot,
} from "../../src/server/ecommerce/phase2-hydration";
import {
  classifyFramePolicy,
  FRAME_POLICY_ALU10,
} from "../../src/server/ecommerce/alu10-pricing";
import {
  buildSkuPriceIndex,
  buildSyntheticMilanRows,
  flagOddDollarRows,
  lookupAliasPrice,
  matchDescriptionToPdf,
  MIA_PDF_FIXTURE_REL,
  MISSING_MILAN_OTTOMANS,
  normalizeDesc,
  ODD_DOLLAR_PDF_ROWS,
  parseMiaAluminumPdfText,
  phase1SpotCheckSkus,
  PRICE_REVIEW_MISSING,
  PRICE_REVIEW_ODD,
  suggestedNearest5,
  type MiaPdfFixture,
  type MiaPdfRow,
} from "../../src/server/ecommerce/mia-aluminum-pricing";
import {
  loadPhase1SowRows,
  PHASE1_RESALE_SKUS,
} from "./enable-phase1-hub-data";
import { parsePhase2SowCsv } from "../../src/server/ecommerce/phase2-hydration";

loadEnvConfig(process.cwd());

const DRY_RUN = process.argv.includes("--dry-run") || !process.argv.includes("--apply");
const UPDATED_BY = "ingest-mia-aluminum-pdf";
const PDF_REL =
  "docs/AluminumUpdate/CC PATIO PRICE LIST 10.01.2026 MSRP .xlsx - Google Sheets.pdf";
const PDF_PATH = path.resolve(process.cwd(), PDF_REL);
const FIXTURE_PATH = path.resolve(process.cwd(), MIA_PDF_FIXTURE_REL);
const PHASE2_CSV = path.resolve(
  process.cwd(),
  "data_migration/Primeview/E-Commerce - Website Product Info - vividworks_phase2_products.csv",
);
const TMP_TEXT = path.resolve(process.cwd(), "tmp/mia-aluminum-pdf-raw.txt");

function extractPdfText(): string {
  if (!fs.existsSync(PDF_PATH)) {
    // Fallback: previously extracted text (local regenerations without PDF)
    if (fs.existsSync(TMP_TEXT)) {
      console.warn(`[mia-pdf] PDF missing; using cached text ${TMP_TEXT}`);
      return fs.readFileSync(TMP_TEXT, "utf8");
    }
    throw new Error(`Missing PDF: ${PDF_PATH}`);
  }

  const py = `
from pypdf import PdfReader
from pathlib import Path
pdf = Path(r${JSON.stringify(PDF_PATH)})
out = Path(r${JSON.stringify(TMP_TEXT)})
out.parent.mkdir(parents=True, exist_ok=True)
reader = PdfReader(str(pdf))
chunks = []
for i, page in enumerate(reader.pages):
    t = page.extract_text() or ""
    chunks.append(f"===== PAGE {i+1} =====\\n{t}")
text = "\\n\\n".join(chunks)
out.write_text(text, encoding="utf-8")
print(len(reader.pages))
print(len(text))
`;
  const result = spawnSync("py", ["-3", "-c", py], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `pypdf extract failed: ${result.stderr || result.stdout || result.error}`,
    );
  }
  return fs.readFileSync(TMP_TEXT, "utf8");
}

function asCountMap(result: unknown): Record<string, number> {
  const row = Array.isArray(result)
    ? (result[0] as Record<string, unknown> | undefined)
    : ((result as { rows?: Record<string, unknown>[] })?.rows?.[0] as
        | Record<string, unknown>
        | undefined);
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, Number(v)]),
  );
}

async function snapshotNonNull(): Promise<NonNullSnapshot> {
  const db = getDb();
  const fg = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE msrp IS NOT NULL AND length(trim(msrp)) > 0)::int AS msrp,
      COUNT(*) FILTER (WHERE length IS NOT NULL AND length(trim(length)) > 0)::int AS length,
      COUNT(*) FILTER (WHERE depth IS NOT NULL AND length(trim(depth)) > 0)::int AS depth,
      COUNT(*) FILTER (WHERE height IS NOT NULL AND length(trim(height)) > 0)::int AS height,
      COUNT(*) FILTER (WHERE weight IS NOT NULL AND length(trim(weight)) > 0)::int AS weight,
      COUNT(*) FILTER (WHERE image_url IS NOT NULL AND length(trim(image_url)) > 0)::int AS image_url,
      COUNT(*)::int AS rows
    FROM finished_goods_catalog
  `);
  const lp = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE length_in IS NOT NULL)::int AS length_in,
      COUNT(*) FILTER (WHERE width_in IS NOT NULL)::int AS width_in,
      COUNT(*) FILTER (WHERE height_in IS NOT NULL)::int AS height_in,
      COUNT(*) FILTER (WHERE weight_lb IS NOT NULL)::int AS weight_lb,
      COUNT(*)::int AS rows
    FROM logistics_profiles
  `);
  const el = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE steel_msrp IS NOT NULL)::int AS steel_msrp,
      COUNT(*) FILTER (WHERE aluminum_msrp IS NOT NULL)::int AS aluminum_msrp,
      COUNT(*) FILTER (WHERE marketing_description IS NOT NULL AND length(trim(marketing_description)) > 0)::int AS marketing_description,
      COUNT(*)::int AS rows
    FROM ecommerce_listings
  `);
  const bom = await db.execute(sql`
    SELECT COUNT(*)::int AS edges, COUNT(DISTINCT parent_sku)::int AS parents
    FROM product_bom
  `);
  return {
    finished_goods_catalog: asCountMap(fg),
    logistics_profiles: asCountMap(lp),
    ecommerce_listings: asCountMap(el),
    product_bom: asCountMap(bom),
  };
}

function attachSowMatches(rows: MiaPdfRow[]): {
  rows: MiaPdfRow[];
  phase1Matched: number;
  phase2Matched: number;
  unmatchedPhase1: string[];
} {
  const phase1 = loadPhase1SowRows();
  const phase2 = fs.existsSync(PHASE2_CSV)
    ? parsePhase2SowCsv(fs.readFileSync(PHASE2_CSV, "utf8"))
    : [];

  const unmatchedPhase1: string[] = [];
  let phase1Matched = 0;
  let phase2Matched = 0;

  const byNorm = new Map(rows.map((r) => [normalizeDesc(r.description), r]));

  for (const sow of phase1) {
    // Milan missing ottomans handled synthetically
    if (MISSING_MILAN_OTTOMANS.some((m) => m.sku === sow.sku)) {
      continue;
    }

    const alias = lookupAliasPrice(sow.sku, sow.name);
    let row: MiaPdfRow | null = null;
    if (alias) {
      row =
        byNorm.get(normalizeDesc(alias.pdfDescription)) ??
        rows.find(
          (r) => normalizeDesc(r.description) === normalizeDesc(alias.pdfDescription),
        ) ??
        null;
      if (row && Math.abs(row.mia_aluminum_price - alias.price) > 0.001) {
        throw new Error(
          `Alias price mismatch ${sow.sku}: PDF ${row.mia_aluminum_price} vs expected ${alias.price}`,
        );
      }
    } else {
      row = matchDescriptionToPdf(sow.name, rows);
    }

    if (!row) {
      // Resale / pillows matched via NON_METAL later
      if (
        (PHASE1_RESALE_SKUS as readonly string[]).includes(sow.sku) ||
        sow.sku.startsWith("FIN-CAB-MIS-") ||
        sow.sku.startsWith("FIN-TJM-") ||
        sow.sku.startsWith("FIN-KIN-") ||
        sow.sku === "FIN-MLN-UMB" ||
        sow.sku === "FIN-CAN-UMB"
      ) {
        const soft = matchDescriptionToPdf(sow.name, rows);
        if (soft) {
          if (!soft.matched_skus.includes(sow.sku)) soft.matched_skus.push(sow.sku);
          phase1Matched += 1;
          continue;
        }
        // Kindle etc. still land in sku_price_index via NON_METAL_PDF_PRICES
        phase1Matched += 1;
        continue;
      }
      unmatchedPhase1.push(`${sow.sku} | ${sow.name}`);
      continue;
    }

    const nameU = sow.name.toUpperCase();
    if (sow.sku === "FIN-BRV-DYB-84X84" && nameU.includes("ROUND")) {
      for (const a of ["FIN-BRV-DYB-84X84-RND", "FIN-BRV-RND-DYB-84"]) {
        if (!row.matched_skus.includes(a)) row.matched_skus.push(a);
      }
    } else if (
      sow.sku === "FIN-BRV-MIN-LOV-48X34" &&
      nameU.includes("ARMLESS")
    ) {
      for (const a of [
        "FIN-BRV-MIN-LOV-48X34-ARMLESS",
        "FIN-BRV-ARM-SOF-48X34",
      ]) {
        if (!row.matched_skus.includes(a)) row.matched_skus.push(a);
      }
    } else if (!row.matched_skus.includes(sow.sku)) {
      row.matched_skus.push(sow.sku);
    }

    // Facing variants share parent price
    if (/COR-(SOF|CHS)/.test(sow.sku)) {
      for (const face of ["LS", "RS"]) {
        const faceSku = `${sow.sku}-${face}`;
        if (!row.matched_skus.includes(faceSku)) row.matched_skus.push(faceSku);
      }
    }
    // Height aliases (Fly Leg / Taylor) keep distinct BAR vs CNT PDF prices
    if (nameU.includes("BAR HEIGHT") || /\(BAR HEIGHT\)/.test(nameU)) {
      const barSku = `${sow.sku}-BAR`;
      if (!row.matched_skus.includes(barSku)) row.matched_skus.push(barSku);
    } else if (nameU.includes("COUNTER HEIGHT") || /\(COUNTER HEIGHT\)/.test(nameU)) {
      const cntSku = `${sow.sku}-CNT`;
      if (!row.matched_skus.includes(cntSku)) row.matched_skus.push(cntSku);
    }
    phase1Matched += 1;
  }

  for (const sow of phase2) {
    const sku = sow.canonicalSku.trim().toUpperCase();
    if (!sku) continue;
    const row = matchDescriptionToPdf(sow.sowProductName || sku, rows);
    if (row) {
      if (!row.matched_skus.includes(sku)) row.matched_skus.push(sku);
      phase2Matched += 1;
    }
  }

  return { rows, phase1Matched, phase2Matched, unmatchedPhase1 };
}

function buildFixture(rawText: string): MiaPdfFixture {
  const parsed = parseMiaAluminumPdfText(rawText);
  let rows = flagOddDollarRows(parsed.rows);

  // Ensure odd-dollar flags for the 6 known rows even if matcher missed
  for (const odd of ODD_DOLLAR_PDF_ROWS) {
    const hit = rows.find(
      (r) => normalizeDesc(r.description) === normalizeDesc(odd.pdfDescription),
    );
    if (!hit) {
      throw new Error(`Odd-dollar PDF row missing: ${odd.pdfDescription}`);
    }
    if (Math.abs(hit.mia_aluminum_price - odd.price) > 0.001) {
      throw new Error(
        `Odd-dollar price mismatch ${odd.pdfDescription}: got ${hit.mia_aluminum_price}`,
      );
    }
    hit.price_review_flag = PRICE_REVIEW_ODD;
    if (odd.skuHint && !hit.matched_skus.includes(odd.skuHint)) {
      hit.matched_skus.push(odd.skuHint);
    }
  }

  const attached = attachSowMatches(rows);
  rows = attached.rows;
  const synthetic = buildSyntheticMilanRows();
  rows = [...rows, ...synthetic];

  const sku_price_index = buildSkuPriceIndex(rows);

  // Golden spot checks
  const club = sku_price_index["FIN-BRV-CLB-CHA-34X34"];
  if (!club || club.price !== 2530) {
    throw new Error(`Bravada Club Chair must be $2530, got ${club?.price}`);
  }
  for (const m of MISSING_MILAN_OTTOMANS) {
    const hit = sku_price_index[m.sku];
    if (!hit || hit.price !== m.aluminum || hit.flag !== PRICE_REVIEW_MISSING) {
      throw new Error(`Missing Milan ottoman fixture failed for ${m.sku}`);
    }
  }

  const metal = rows.filter((r) => r.category === "metal" && r.source === "pdf").length;
  const nonMetal = rows.filter((r) => r.category !== "metal" || r.source === "synthetic").length;

  if (attached.unmatchedPhase1.length > 0) {
    console.warn(
      `[mia-pdf] unmatched Phase 1 (will rely on soft/non-metal index):\n` +
        attached.unmatchedPhase1.map((u) => `  - ${u}`).join("\n"),
    );
  }

  const fixture: MiaPdfFixture = {
    source_pdf: PDF_REL,
    extracted_at: new Date().toISOString(),
    parser_version: 1,
    page_count: parsed.pages,
    row_count: rows.length,
    metal_row_count: metal,
    non_metal_row_count: nonMetal,
    rows,
    sku_price_index,
    phase1_spot_check_skus: phase1SpotCheckSkus(),
  };

  console.log(
    `[mia-pdf] parsed pages=${fixture.page_count} rows=${fixture.row_count} metal≈${metal} nonMetal/synth=${nonMetal}`,
  );
  console.log(
    `[mia-pdf] phase1Matched=${attached.phase1Matched} phase2Matched=${attached.phase2Matched} skuIndex=${Object.keys(sku_price_index).length}`,
  );
  return fixture;
}

async function applyFixtureToHub(fixture: MiaPdfFixture): Promise<{
  updatedListings: number;
  updatedMappings: number;
  spotChecks: number;
}> {
  const db = getDb();
  let updatedListings = 0;
  let updatedMappings = 0;
  let spotChecks = 0;

  const entries = Object.entries(fixture.sku_price_index);
  for (const [sku, meta] of entries) {
    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, sku))
      .limit(1);

    // Also try canonical without facing / height suffixes for alias SKUs
    const listingSkus = [sku];
    if (sku.endsWith("-LS") || sku.endsWith("-RS")) {
      listingSkus.push(sku.replace(/-(LS|RS)$/, ""));
    }

    const listings = await db
      .select()
      .from(ecommerce_listings)
      .where(
        and(
          eq(ecommerce_listings.global_sku, sku),
          isNull(ecommerce_listings.archived_at),
        ),
      );

    // For alias SKUs (FIN-KIN-MIS-HEATER), update listing on alias if present,
    // else fall through to canonical stem listing via sku_aliases — keep simple:
    // update any listing whose global_sku equals the index key.
    if (!DRY_RUN) {
      if (mapping) {
        const attrs: Record<string, unknown> = {
          ...((mapping.attributes as Record<string, unknown>) ?? {}),
          mia_price_locked: true,
          woo_alu_msrp: meta.price,
          mia_pdf_price: meta.price,
          mia_pdf_raw_price: meta.price,
          mia_pdf_source: meta.source,
          frame_material:
            classifyFramePolicy({ globalSku: sku }).startsWith("aluminum")
              ? "Aluminum"
              : (mapping.attributes as Record<string, unknown>)?.frame_material,
        };
        if (meta.flag) {
          attrs.price_review_flag = meta.flag;
          spotChecks += 1;
          if (meta.flag === PRICE_REVIEW_ODD) {
            const odd = ODD_DOLLAR_PDF_ROWS.find((r) => r.skuHint === sku);
            attrs.mia_pdf_suggested_price =
              odd?.suggested ?? suggestedNearest5(meta.price);
          }
        } else if (attrs.price_review_flag) {
          delete attrs.price_review_flag;
          delete attrs.mia_pdf_suggested_price;
        }
        if (meta.oct1_msrp != null) {
          attrs.mia_oct1_msrp = meta.oct1_msrp;
        }
        // Keep existing frame_policy; stamp aluminum website price.
        if (!attrs.frame_policy) {
          attrs.frame_policy = classifyFramePolicy({ globalSku: sku });
        }
        await db
          .update(sku_mappings)
          .set({
            attributes: attrs,
            updated_at: new Date(),
            updated_by: UPDATED_BY,
            version: mapping.version + 1,
          })
          .where(eq(sku_mappings.global_sku, sku));
        updatedMappings += 1;
      }

      for (const listing of listings) {
        await db
          .update(ecommerce_listings)
          .set({
            aluminum_msrp: meta.price.toFixed(2),
            updated_at: new Date(),
            version: listing.version + 1,
          })
          .where(eq(ecommerce_listings.id, listing.id));
        updatedListings += 1;
      }

      // Facing parents: also push price onto -LS/-RS listings when index has face SKUs
      if (!sku.includes("-LS") && !sku.includes("-RS") && /COR-(SOF|CHS)/.test(sku)) {
        for (const face of ["LS", "RS"] as const) {
          const faceSku = `${sku}-${face}`;
          const faceListings = await db
            .select()
            .from(ecommerce_listings)
            .where(
              and(
                eq(ecommerce_listings.global_sku, faceSku),
                isNull(ecommerce_listings.archived_at),
              ),
            );
          for (const listing of faceListings) {
            await db
              .update(ecommerce_listings)
              .set({
                aluminum_msrp: meta.price.toFixed(2),
                updated_at: new Date(),
                version: listing.version + 1,
              })
              .where(eq(ecommerce_listings.id, listing.id));
            updatedListings += 1;
          }
        }
      }
    } else {
      if (mapping) updatedMappings += 1;
      updatedListings += listings.length;
      if (meta.flag) spotChecks += 1;
    }
  }

  // Ensure synthetic Milan ottomans land even if only canonical mapping exists
  for (const m of MISSING_MILAN_OTTOMANS) {
    const [mapping] = await db
      .select()
      .from(sku_mappings)
      .where(eq(sku_mappings.global_sku, m.sku))
      .limit(1);
    if (!mapping) continue;
    if (!DRY_RUN) {
      const attrs = {
        ...((mapping.attributes as Record<string, unknown>) ?? {}),
        mia_price_locked: true,
        woo_alu_msrp: m.aluminum,
        mia_pdf_price: m.aluminum,
        mia_pdf_source: "synthetic",
        price_review_flag: PRICE_REVIEW_MISSING,
        frame_policy: FRAME_POLICY_ALU10,
        frame_material: "Aluminum",
        storefront_metal: "MET-ALUM",
      };
      await db
        .update(sku_mappings)
        .set({
          attributes: attrs,
          updated_at: new Date(),
          updated_by: UPDATED_BY,
          version: mapping.version + 1,
        })
        .where(eq(sku_mappings.global_sku, m.sku));
      const listings = await db
        .select()
        .from(ecommerce_listings)
        .where(
          and(
            eq(ecommerce_listings.global_sku, m.sku),
            isNull(ecommerce_listings.archived_at),
          ),
        );
      for (const listing of listings) {
        await db
          .update(ecommerce_listings)
          .set({
            aluminum_msrp: m.aluminum.toFixed(2),
            updated_at: new Date(),
            version: listing.version + 1,
          })
          .where(eq(ecommerce_listings.id, listing.id));
      }
    }
  }

  return { updatedListings, updatedMappings, spotChecks };
}

async function main() {
  console.log(`[mia-pdf] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"}`);
  const text = extractPdfText();
  const fixture = buildFixture(text);

  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + "\n", "utf8");
  console.log(`[mia-pdf] wrote fixture ${MIA_PDF_FIXTURE_REL}`);

  const before = await snapshotNonNull();
  const applied = await applyFixtureToHub(fixture);
  const after = await snapshotNonNull();
  assertNoRegression(before, after);

  const oddCount = fixture.rows.filter((r) => r.price_review_flag === PRICE_REVIEW_ODD).length;
  const missingCount = fixture.rows.filter(
    (r) => r.price_review_flag === PRICE_REVIEW_MISSING,
  ).length;

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: DRY_RUN,
        row_count: fixture.row_count,
        metal_row_count: fixture.metal_row_count,
        sku_index: Object.keys(fixture.sku_price_index).length,
        odd_dollar_rows: oddCount,
        missing_milan: missingCount,
        spot_check_skus: fixture.phase1_spot_check_skus.length,
        updatedListings: applied.updatedListings,
        updatedMappings: applied.updatedMappings,
        golden: {
          club: fixture.sku_price_index["FIN-BRV-CLB-CHA-34X34"]?.price,
          swivel: fixture.sku_price_index["FIN-BRV-SWV-CHA-34X34"]?.price,
          loveseat: fixture.sku_price_index["FIN-BRV-LOV-SOF-60X34"]?.price,
          cantilever: fixture.sku_price_index["FIN-CAN-UMB"]?.price,
          kindle_heater: fixture.sku_price_index["FIN-KIN-MIS-HEATER"]?.price,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
