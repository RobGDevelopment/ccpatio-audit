/**
 * Seed the E-Commerce roster (Master Catalog blueprint).
 *
 * Sources (data_migration/Pricing):
 *   - E-Commerce - Website Product Info.xlsx
 *       Katana_SKU               → roster membership + steel MSRP
 *       Website Products w Links → Product Link, Drawing section, sheet order
 *       Website Products         → Description, Details, MSRP w/Aluminum Frame
 *   - Website Product Info.xlsx
 *       Website Products w Links → legacy Base SKU
 *
 * Listing identity is the raw product name (unique index
 * ecommerce_listings_product_name_uidx = upsert target); a hub SKU may back
 * several listings. Steel MSRP lives on ecommerce_listings.steel_msrp and is
 * mirrored to finished_goods_catalog.msrp ONLY for hub SKUs with exactly one
 * listing. Does NOT call WooCommerce.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/db/seed-ecommerce-roster.ts [--dry-run]
 */
import path from "node:path";
import * as xlsx from "xlsx";
import { inArray, sql } from "drizzle-orm";
import { getDb, closeDb } from "../../src/server/db/client";
import {
  ecommerce_listings,
  ecommerce_roster_gaps,
  finished_goods_catalog,
  sku_mappings,
} from "../../src/server/db/schema";
import {
  deriveCollection,
  flagSharedCanonical,
  flagSharedLegacy,
  inheritFamilyUrls,
  normalizeText,
  parseMoney,
  type LinkRow,
} from "../../src/lib/ecommerce-roster";

const DRY_RUN = process.argv.includes("--dry-run");
const DIR = path.resolve(process.cwd(), "data_migration/Pricing");
const ECOM_WB = path.join(DIR, "E-Commerce - Website Product Info.xlsx");
const LEGACY_WB = path.join(DIR, "Website Product Info.xlsx");

/* ───────────── workbook helpers ───────────── */

interface SheetRow {
  section: string;
  cells: Record<string, string>;
}

/**
 * Finds the header row (the one containing "Memo/Description"), then returns
 * data rows tagged with the Drawing section they sit under. Section rows have
 * text in the Drawing column and no memo. For duplicate header names the
 * FIRST occurrence wins.
 */
function readSheet(wb: xlsx.WorkBook, sheetName: string): SheetRow[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);
  const grid = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const hIdx = grid.findIndex((r) =>
    r.some((c) => String(c).trim() === "Memo/Description"),
  );
  if (hIdx < 0) throw new Error(`No header row in "${sheetName}"`);
  const header = grid[hIdx].map((c) => String(c).trim());
  const colOf = (name: string) => header.indexOf(name);
  const drawingCol = colOf("Drawing");
  const memoCol = colOf("Memo/Description");

  const out: SheetRow[] = [];
  let section = "";
  for (let r = hIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const memo = String(row[memoCol] ?? "").trim();
    const drawing = String(row[drawingCol] ?? "").trim();
    if (!memo) {
      if (drawing) section = drawing;
      continue;
    }
    const cells: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h && !(h in cells)) cells[h] = String(row[i] ?? "").trim();
    });
    out.push({ section, cells });
  }
  return out;
}

const nz = (s: string | undefined) => (s && s.toUpperCase() !== "N/A" ? s : null);

/* ───────────── main ───────────── */

async function main() {
  console.log(`E-Commerce roster seed${DRY_RUN ? "  (DRY RUN — no writes)" : ""}`);
  const ecom = xlsx.readFile(ECOM_WB);
  const legacy = xlsx.readFile(LEGACY_WB);

  // 1. Roster (membership + steel MSRP). One entry per sheet row.
  const rosterRaw = xlsx.utils.sheet_to_json<Record<string, unknown>>(
    ecom.Sheets["Katana_SKU"],
  );
  const roster: { name: string; sku: string; steel: string | null }[] = [];
  // Identity is the RAW product name (never normalized: two armless-sofa names
  // differ only by whitespace and carry different prices). Hub SKUs may repeat.
  const seenNames = new Set<string>();
  for (const r of rosterRaw) {
    const sku = String(r["Canonical Hub SKU"] ?? "").trim();
    const name = String(r["Original Name"] ?? "").trim();
    if (!sku || !name) continue;
    if (seenNames.has(name)) {
      throw new Error(`Duplicate Original Name in Katana_SKU: "${name}"`);
    }
    seenNames.add(name);
    roster.push({ name, sku, steel: parseMoney(r["MSRP"]) });
  }

  // 2. Links sheet → section, order, URL (with family inheritance over ALL rows)
  const linkRows = readSheet(ecom, "Website Products w Links");
  const orderByMemo = new Map<string, number>();
  const sectionByMemo = new Map<string, string>();
  const links: LinkRow[] = linkRows.map((r, i) => {
    const key = normalizeText(r.cells["Memo/Description"]);
    if (!orderByMemo.has(key)) {
      orderByMemo.set(key, i);
      sectionByMemo.set(key, r.section);
    }
    return {
      memo: r.cells["Memo/Description"],
      section: r.section,
      url: nz(r.cells["Product Link"]),
    };
  });
  const urlByMemo = inheritFamilyUrls(links);

  // 3. Copy sheet → description, details, aluminum
  const copyByMemo = new Map<string, Record<string, string>>();
  const copySectionByMemo = new Map<string, string>();
  for (const r of readSheet(ecom, "Website Products")) {
    const key = normalizeText(r.cells["Memo/Description"]);
    if (!copyByMemo.has(key)) {
      copyByMemo.set(key, r.cells);
      copySectionByMemo.set(key, r.section);
    }
  }

  // 4. Legacy base SKU
  const legacyByMemo = new Map<string, string>();
  for (const r of readSheet(legacy, "Website Products w Links")) {
    const base = nz(r.cells["Base SKU"]);
    const key = normalizeText(r.cells["Memo/Description"]);
    if (base && !legacyByMemo.has(key)) legacyByMemo.set(key, base);
  }

  // 5. Hub existence
  const db = getDb();
  const skus = [...new Set(roster.map((r) => r.sku))];
  const hubRows = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(inArray(sku_mappings.global_sku, skus));
  const inHub = new Set(hubRows.map((r) => r.sku));
  const fgcRows = await db
    .select({ sku: finished_goods_catalog.global_sku })
    .from(finished_goods_catalog)
    .where(inArray(finished_goods_catalog.global_sku, skus));
  const hasFgc = new Set(fgcRows.map((r) => r.sku));

  // 6. Assemble
  const matched = roster.filter((r) => inHub.has(r.sku));
  const gaps = roster.filter((r) => !inHub.has(r.sku));

  const legacyFor = (name: string) => legacyByMemo.get(normalizeText(name)) ?? null;
  // Shared flags are keyed by product name (a SKU-keyed map keeps only the last sibling).
  const sharedLegacy = flagSharedLegacy(
    matched.map((r) => ({ productName: r.name, legacyBaseSku: legacyFor(r.name) })),
  );
  const sharedCanonical = flagSharedCanonical(
    matched.map((r) => ({ productName: r.name, globalSku: r.sku })),
  );
  // Hub SKUs backing exactly one listing may mirror their price to FGC.
  const listingsPerSku = new Map<string, number>();
  for (const r of matched) {
    listingsPerSku.set(r.sku, (listingsPerSku.get(r.sku) ?? 0) + 1);
  }

  const listings = matched.map((r, idx) => {
    const key = normalizeText(r.name);
    const url = urlByMemo.get(key) ?? { url: null, source: "missing" as const };
    const copy = copyByMemo.get(key);
    return {
      global_sku: r.sku,
      product_name: r.name,
      steel_msrp: r.steel,
      legacy_base_sku: legacyFor(r.name),
      legacy_sku_shared: sharedLegacy.get(r.name) ?? false,
      canonical_sku_shared: sharedCanonical.get(r.name) ?? false,
      product_url: url.url,
      url_source: url.source,
      drawing_section:
        sectionByMemo.get(key) ?? copySectionByMemo.get(key) ?? "Uncategorized",
      collection_label: deriveCollection(r.name, r.sku),
      aluminum_msrp: parseMoney(copy?.["MSRP w/Aluminum Frame"]),
      marketing_description: nz(copy?.["Description"]),
      construction_details: nz(copy?.["Details"]),
      sheet_order: orderByMemo.get(key) ?? 10_000 + idx,
    };
  });

  const mirrorToFgc = matched.filter(
    (r) => listingsPerSku.get(r.sku) === 1 && r.steel,
  );

  // 7. Report
  const count = (f: (l: (typeof listings)[number]) => boolean) =>
    listings.filter(f).length;

  const bySku = new Map<string, { name: string; steel: string | null }[]>();
  for (const r of roster) {
    const g = bySku.get(r.sku) ?? [];
    g.push({ name: r.name, steel: r.steel });
    bySku.set(r.sku, g);
  }
  const reused = [...bySku].filter(([, v]) => v.length > 1);

  const sharedGroups = new Map<string, string[]>();
  for (const l of listings) {
    if (l.legacy_sku_shared && l.legacy_base_sku) {
      const g = sharedGroups.get(l.legacy_base_sku) ?? [];
      g.push(l.product_name);
      sharedGroups.set(l.legacy_base_sku, g);
    }
  }
  const byCollection = new Map<string, number>();
  const bySection = new Map<string, number>();
  for (const l of listings) {
    byCollection.set(l.collection_label, (byCollection.get(l.collection_label) ?? 0) + 1);
    bySection.set(l.drawing_section, (bySection.get(l.drawing_section) ?? 0) + 1);
  }

  console.log(`\nKatana_SKU sheet rows:      ${rosterRaw.length}`);
  console.log(`Unique product names:       ${roster.length}`);
  console.log(`Unique hub SKUs:            ${bySku.size}`);
  console.log(
    `Hub SKUs reused:            ${reused.length} SKUs across ${reused.reduce((n, [, v]) => n + v.length, 0)} rows`,
  );
  reused.forEach(([sku, rows]) =>
    rows.forEach((r) => console.log(`   ${sku}  $${r.steel ?? "-"}  ${r.name}`)),
  );
  console.log(`Skipped duplicate-SKU rows: 0`);
  console.log(`\nMatched in hub:             ${matched.length}`);
  console.log(`Hub gaps:                   ${gaps.length}`);
  gaps.forEach((g) => console.log(`   gap  ${g.sku}  (${g.name})`));
  console.log(`\nURLs — own (row):           ${count((l) => l.url_source === "row")}`);
  console.log(`URLs — sibling:             ${count((l) => l.url_source === "sibling")}`);
  console.log(`URLs — missing:             ${count((l) => l.url_source === "missing")}`);
  listings
    .filter((l) => l.url_source === "missing")
    .forEach((l) => console.log(`   no url  ${l.global_sku}  ${l.product_name}`));
  console.log(`\nLegacy SKU — found:         ${count((l) => !!l.legacy_base_sku)}`);
  console.log(`Legacy SKU — missing:       ${count((l) => !l.legacy_base_sku)}`);
  console.log(`Shared legacy SKUs:         ${sharedGroups.size} base SKUs`);
  sharedGroups.forEach((names, base) =>
    console.log(`   ${base}  ←  ${names.length} listings`),
  );
  console.log(`Listings w/ shared hub SKU: ${count((l) => l.canonical_sku_shared)}`);
  console.log(`\nAluminum MSRP present:      ${count((l) => !!l.aluminum_msrp)}`);
  console.log(`Description present:        ${count((l) => !!l.marketing_description)}`);
  console.log(`Details present:            ${count((l) => !!l.construction_details)}`);
  console.log(`\nCollections: ${[...byCollection].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`Sections:`);
  bySection.forEach((v, k) => console.log(`   ${v}\t${k}`));
  const fgcToCreate = mirrorToFgc.filter((r) => !hasFgc.has(r.sku)).length;
  console.log(
    `\nfinished_goods_catalog.msrp: ${mirrorToFgc.length - fgcToCreate} to update, ${fgcToCreate} to create (single-listing hub SKUs only)`,
  );
  console.log(
    `Shared hub SKUs left untouched on finished_goods_catalog: ${
      new Set(
        matched.filter((r) => (listingsPerSku.get(r.sku) ?? 0) > 1).map((r) => r.sku),
      ).size
    }`,
  );

  if (DRY_RUN) {
    console.log("\nDry run complete — nothing written.");
    return;
  }

  // 8. Write (single transaction)
  await db.transaction(async (tx) => {
    const now = new Date();
    for (const l of listings) {
      await tx
        .insert(ecommerce_listings)
        .values({ ...l, updated_at: now })
        .onConflictDoUpdate({
          target: ecommerce_listings.product_name,
          set: {
            global_sku: sql`excluded.global_sku`,
            steel_msrp: sql`excluded.steel_msrp`,
            legacy_base_sku: sql`excluded.legacy_base_sku`,
            legacy_sku_shared: sql`excluded.legacy_sku_shared`,
            canonical_sku_shared: sql`excluded.canonical_sku_shared`,
            product_url: sql`excluded.product_url`,
            url_source: sql`excluded.url_source`,
            drawing_section: sql`excluded.drawing_section`,
            collection_label: sql`excluded.collection_label`,
            aluminum_msrp: sql`excluded.aluminum_msrp`,
            marketing_description: sql`excluded.marketing_description`,
            construction_details: sql`excluded.construction_details`,
            sheet_order: sql`excluded.sheet_order`,
            updated_at: now,
          },
        });
    }
    // One listing per hub SKU → FGC mirrors it. Shared hub SKUs are skipped.
    for (const r of mirrorToFgc) {
      await tx
        .insert(finished_goods_catalog)
        .values({ global_sku: r.sku, msrp: r.steel! })
        .onConflictDoUpdate({
          target: finished_goods_catalog.global_sku,
          set: { msrp: r.steel!, updated_at: now },
        });
    }
    for (const g of gaps) {
      await tx
        .insert(ecommerce_roster_gaps)
        .values({
          product_name: g.name,
          global_sku: g.sku,
          reason: "Hub SKU not present in sku_mappings",
          updated_at: now,
        })
        .onConflictDoUpdate({
          target: ecommerce_roster_gaps.product_name,
          set: {
            global_sku: g.sku,
            reason: "Hub SKU not present in sku_mappings",
            updated_at: now,
          },
        });
    }
    // A name is either a listing or a gap, never both.
    if (matched.length) {
      await tx
        .delete(ecommerce_roster_gaps)
        .where(inArray(ecommerce_roster_gaps.product_name, matched.map((m) => m.name)));
    }
    if (gaps.length) {
      await tx
        .delete(ecommerce_listings)
        .where(inArray(ecommerce_listings.product_name, gaps.map((g) => g.name)));
    }
  });

  console.log(
    `\nUpserted ${listings.length} listings, ${gaps.length} gap rows, mirrored ${mirrorToFgc.length} prices to finished_goods_catalog.`,
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
