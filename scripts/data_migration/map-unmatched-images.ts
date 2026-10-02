/**
 * Attach WooCommerce hero images to FIN-* rows the strict sync could not match.
 *
 * REVIEW EVERY GUESS BEFORE RUNNING.
 * Woo products have no SKU. Values below are educated guesses from hub
 * collection codes (BRV Bravada, BRK Brooklyn, OCN Ocean, WFT Waterfall,
 * DAI Daisy, TAY Taylor). A blind 3-letter code (BRA, BRO, OCE, WAT, MIL)
 * does not match the dictionary. Sized families have more than one FIN-*
 * row; the SKU here is one candidate, and the comment lists the others.
 * A FIN- SKU missing from sku_mappings is minted as a finished good, using the
 * Woo name as original_name, and then the hero image is attached. The Hub
 * does not store third-party vendor SKUs.
 *
 * GET only toward Woo. Does not POST to Woo, Katana, or Clover.
 *
 *   npm run migrate:map-unmatched -- --dry-run
 *   npm run migrate:map-unmatched
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { eq } from "drizzle-orm";
import { upsertCatalogImageUrl } from "../../src/lib/catalog-image";
import { normalizeCatalogText } from "../../src/lib/finished-good-sku";
import { closeDb, getDb } from "../../src/server/db/client";
import { finished_goods_catalog, sku_mappings } from "../../src/server/db/schema";

const AUDIT_PATH = join(process.cwd(), "scripts/data_migration/woo-variants-map.json");

/**
 * woo marketing name → guessed Katana / hub SKU.
 * Edit these values, then run. Do not treat the current values as approved.
 */
export const WOO_NAME_TO_KATANA_SKU = {
  // Shade cabana. FIN-CAB-DYB-84X84 is the daybed below — do not reuse it here.
  "Cabana w/ Sunbrella Top & Curtains": "FIN-CAB-W-TOP",
  // Exact dictionary name. The other cantilever row is the cover, FIN-CAN-UMB.
  "Cantilever Umbrella w/Base": "FIN-CAN-UMB-W-BAS",
  // Dictionary name is CANTILEVER UMBRELLA COVER (not FIN-CAN-UMB-COV).
  "Cantilever Umbrella Cover": "FIN-CAN-UMB",
  // No Lido row in the dictionary.
  "Lido Umbrella (No Base)": "FIN-LID-UMB",
  // "Two" is a quantity. No Woosah row.
  "Two Woosah Chairs": "FIN-WOO-CHA",
  // No Mibster row.
  "Mibster Chair w/Cup Holders": "FIN-MIB-CHA",
  // No Moon row.
  "Moon Chair w/Cup Holders": "FIN-MOO-CHA",
  // "Two" is a quantity. Hub parent is FIN-SHA-LOU (minted when absent).
  "Two Shayz Loungers": "FIN-SHA-LOU",
  // Hub parent is FIN-LAY-LOU (minted when absent).
  "Laylo Lounger": "FIN-LAY-LOU",
  // Exists: KINDLE LIVING LAMP. The parenthetical blocked the strict name match.
  "Kindle Living Lamp (Allison)": "FIN-KIN-LIV-LAM",
  // Exists: FLEXY ZEN NO BASE (description: FLEXY ZEN SHADE SYSTEM, NO BASE).
  "Flexy Zen Shade System (No Base)": "FIN-FLE-ZEN-NO-BAS",
  // Exists: FLEXY TWIN NO BASE.
  "Flexy Twin (No Base)": "FIN-FLE-TWI-NO-BAS",
  // Hub parent is FIN-PIL (minted when absent).
  Pillow: "FIN-PIL",
  // Exists: CABANA 84X84 (description CABANA DAYBED).
  "Bravada Cabana Daybed": "FIN-CAB-DYB-84X84",
  // REVIEW size. Also FIN-BRV-SWG-66X42, FIN-BRV-SWG-96X60 (66 w/frame), FIN-BRV-SWG-102X60 (72 w/frame).
  "Bravada Swing": "FIN-BRV-SWG-72X42",
  // REVIEW size. Also FIN-CUS-OTT-82X23.
  "Custom Storage Ottoman": "FIN-CUS-OTT-72X22",
  // Exists: CUBE OTTOMAN 22 X 22.
  "Cube Ottoman": "FIN-MIS-OTT-22X22",
  // REVIEW size. Also FIN-OCN-OTT-30X22, FIN-OCN-OTT-60X22, FIN-OCN-OTT-72X22.
  "Ocean Ottoman": "FIN-OCN-OTT-42X22",
  // REVIEW size. Also FIN-BRK-OTT-60X22, FIN-BRK-OTT-72X22, FIN-BRK-OTT-34X34, FIN-BRK-OTT-42X34.
  "Brooklyn Ottoman": "FIN-BRK-OTT-42X22",
  // REVIEW size. Also FIN-BRV-OTT-30X22, FIN-BRV-OTT-60X22, FIN-BRV-OTT-72X22, FIN-BRV-OTT-34X34.
  "Bravada Ottoman": "FIN-BRV-OTT-42X22",
  // No rounded-bench row.
  "Bravada Rounded Bench": "FIN-BRV-RND-BCH",
  // Dictionary has Taylor barstools with arms, not a dining chair with arms.
  "Taylor Chair w/ Arms": "FIN-TAY-CHA-W-ARM",
  // No Taylor dining chair. Barstools and benches only.
  "Taylor Dining Chair": "FIN-TAY-DIN-CHA",
  // REVIEW height/size. Also FIN-TAY-BCH-24X23 (bar 42), FIN-TAY-BEN-BAR-HEI-72, FIN-TAY-BCH-72X23, FIN-TAY-BEN-DIN-HEI-42.
  "Taylor Bench": "FIN-TAY-BCH-42X23",
  // REVIEW height. Counter is FIN-TAY-BST-18X23. With arms: FIN-TAY-BST-24X23, FIN-TAY-BAR-W-ARM-COU-HEI.
  "Taylor Barstool": "FIN-TAY-BST-19X23",
  // Bar height. Counter height is FIN-MIS-FLY-BST-17X21.
  "Half Back Barstool": "FIN-HAL-BAC-BAR-BAR-HEI",
  // REVIEW height. Counter FIN-FLY-LEG-BEN-COU-HEI-42, dining FIN-FLY-LEG-BEN-DIN-HEI-42.
  "Fly Leg Bench": "FIN-FLY-BCH-42X18",
  // Bar height. Counter is FIN-FLY-LEG-BAR-COU-HEI.
  "Fly Leg Barstool": "FIN-FLY-FLY-BST-18X18",
  // REVIEW length. Also FIN-MIS-DIN-BCH-96X22.
  "Dining Bench w/ No Arms": "FIN-MIS-DIN-BCH-72X22",
  // REVIEW size. Also FIN-WFT-FIR-TAB-72X36.
  "Waterfall Fire Pit Table": "FIN-WFT-FIR-TAB-56X36",
  // Exists: PROPANE FIRE PIT TABLE 42 X 42.
  "Propane Fire Pit Table": "FIN-MIS-FIR-TAB-42X42",
  // REVIEW size. Also FIN-DAI-FIR-TAB-96X56.
  "Daisy Base Fire Pit Dining Table": "FIN-DAI-FIR-TAB-84X56",
  // REVIEW size. Bar-height family includes 28 and 36 depths at 72, 96, and 120.
  "Waterfall Table": "FIN-WFT-BAR-TAB-72X36",
  // REVIEW size. Bar and counter, 36 and 42 depths.
  "Star Leg Table": "FIN-STA-BAR-TAB-42X42",
  // REVIEW size. Bar-height family, 28 and 36 depths.
  "Brooklyn Table": "FIN-BRK-BAR-TAB-72X36",
  // REVIEW size. Bar-height family, 42 and 56 depths.
  "Daisy Base Table": "FIN-DAI-BAR-TAB-72X42",
  // Exists: DAISY BASE ROUND TABLE (DINING HEIGHT) 42.
  "Daisy Base Round Table": "FIN-DAI-DIN-TAB-42X42",
  // Exists: WATERFALL SIDE TABLE 40X13.
  "Waterfall Side Table": "FIN-WFT-SID-TAB-13X40",
  // REVIEW length. Also FIN-FLY-TAB-60X12, FIN-FLY-TAB-38X8, FIN-FLY-TAB-84X12, FIN-FLY-TAB-96X12.
  "Fly Table": "FIN-FLY-TAB-72X12",
  // REVIEW size. Also 28x42, 28x56, 36x36, 36x72.
  "Ocean Coffee Table": "FIN-OCN-COF-TAB-56X36",
  // REVIEW size. Also 28x42, 36x36, 36x72, 42x42.
  "Bravada Coffee Table": "FIN-BRV-COF-TAB-56X36",
  // Exists: OCEAN SIDE TABLE 20 X 20. Angular side table is already FIN-OCN-SID-TAB-12.
  "Ocean Side Table": "FIN-OCN-SID-TAB-20X20",
  // No Milan sofa rows. FIN-MLN-UMB is the Marina umbrella cover.
  "Milan Double-Sided Sofa": "FIN-MLN-DBL-SOF",
  "Milan One-Sided Sofa": "FIN-MLN-SOF",
  "Milan Ottoman": "FIN-MLN-OTT",
  "Milan Club Chair": "FIN-MLN-CLB-CHA",
  // No Ocean chaise row.
  "Ocean Chaise Lounge": "FIN-OCN-CHS",
  // Exists: OCEAN LOVESEAT 60.
  "Ocean Loveseat": "FIN-OCN-LOV-SOF-60X38",
  // REVIEW length. Also FIN-OCN-SOF-72X38 and FIN-OCN-SOF-96X38.
  "Ocean Sofa": "FIN-OCN-SOF-84X38",
  // Exists: OCEAN CLUB CHAIR.
  "Ocean Club Chair": "FIN-OCN-CLB-CHA-34X38",
  // No Brooklyn corner chaise. Corner sofas are FIN-BRK-COR-SOF-*.
  "Brooklyn Corner Chaise": "FIN-BRK-COR-CHS",
  // REVIEW length. Also FIN-BRK-COR-SOF-72X34 and FIN-BRK-COR-SOF-96X34.
  "Brooklyn Corner Sofa": "FIN-BRK-COR-SOF-84X34",
  // REVIEW length. Also FIN-BRK-SOF-60X34, FIN-BRK-SOF-72X34, FIN-BRK-SOF-96X34.
  "Brooklyn Sofa": "FIN-BRK-SOF-84X34",
  // Single lounge. Double is FIN-BRK-TRA-DOU-CHS-48X72.
  "Brooklyn Transitional Chaise Lounge": "FIN-BRK-TRA-SGL-CHS-36X72",
  // REVIEW size. Also FIN-BRV-DYB-78X72 and FIN-BRV-DYB-84X78.
  "Bravada Daybed": "FIN-BRV-DYB-78X78",
  // No round daybed row. Rectangular daybeds are FIN-BRV-DYB-*.
  "Bravada Round Daybed": "FIN-BRV-RND-DYB",
  // No Bravada chaise lounge row.
  "Bravada Chaise Lounge": "FIN-BRV-CHS",
  // No Bravada corner chaise. Corner sofas are FIN-BRV-COR-SOF-*.
  "Bravada Corner Chaise": "FIN-BRV-COR-CHS",
  // REVIEW length. Also FIN-BRV-COR-SOF-72X34 and FIN-BRV-COR-SOF-96X34.
  "Bravada Corner Sofa": "FIN-BRV-COR-SOF-84X34",
  // No armless sofa row.
  "Bravada Armless Sofa": "FIN-BRV-ARM-SOF",
  // REVIEW length. Also FIN-BRV-SOF-72X34 and FIN-BRV-SOF-96X34.
  "Bravada Sofa": "FIN-BRV-SOF-84X34",
  // Exists: BRAVADA SWIVEL CHAIR 34.
  "Bravada Swivel Chair": "FIN-BRV-SWV-CHA-34X34",
  // Exists: BRAVADA LOVESEAT 60.
  "Bravada Loveseat": "FIN-BRV-LOV-SOF-60X34",
  // No Brooklyn chaise lounge. Transitional chaises are FIN-BRK-TRA-*.
  "Brooklyn Chaise Lounge": "FIN-BRK-CHS",
} as const;

type WooProduct = {
  id?: number;
  name?: string;
  images?: Array<{ src?: string }>;
};

type AuditFile = {
  products: Array<{
    name: string;
    imageWrite: string;
    imageSrc: string | null;
  }>;
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function wooClient(): WooCommerceRestApi {
  const url = unquote(process.env.WOOCOMMERCE_URL ?? "").replace(/\/$/, "");
  const consumerKey = unquote(process.env.WOOCOMMERCE_CONSUMER_KEY ?? "");
  const consumerSecret = unquote(process.env.WOOCOMMERCE_CONSUMER_SECRET ?? "");
  if (!url || !consumerKey || !consumerSecret) {
    throw new Error(
      "Missing WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, or WOOCOMMERCE_CONSUMER_SECRET",
    );
  }
  const api = new WooCommerceRestApi({
    url,
    consumerKey,
    consumerSecret,
    version: "wc/v3",
    queryStringAuth: true,
  });
  // OAuth 1.0a is what reaches Woo on ccpatio.com. The library only signs when isHttps is false.
  (api as unknown as { isHttps: boolean }).isHttps = false;
  return api;
}

function wooFailure(error: unknown): Error {
  const err = error as {
    response?: { status?: number; data?: { code?: string; message?: string } };
    message?: string;
  };
  const status = err.response?.status;
  const code = err.response?.data?.code ?? "";
  const raw = err.response?.data?.message ?? err.message ?? "WooCommerce request failed";
  const message = raw.replace(/<[^>]+>/g, "");
  if (status === 401 || status === 403) {
    return new Error(`WooCommerce ${status} (${code || "unauthorized"}): ${message}`);
  }
  return new Error(status ? `WooCommerce ${status}: ${message}` : message);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function loadAudit(): AuditFile {
  return JSON.parse(readFileSync(AUDIT_PATH, "utf8")) as AuditFile;
}

/** Fail closed if the dictionary drifts from the unmatched / ambiguous audit names. */
function assertAuditCoverage(audit: AuditFile): void {
  const pending = audit.products.filter(
    (row) => row.imageWrite === "skipped-no-match" || row.imageWrite === "ambiguous",
  );
  const auditNames = new Set(pending.map((row) => row.name));
  const mapped = new Set(Object.keys(WOO_NAME_TO_KATANA_SKU));
  const missing = [...auditNames].filter((name) => !mapped.has(name));
  const extra = [...mapped].filter((name) => !auditNames.has(name));
  if (missing.length || extra.length) {
    throw new Error(
      `Translation map does not match ${AUDIT_PATH}. missing=${missing.length} extra=${extra.length} ${[...missing, ...extra].join(" | ")}`,
    );
  }
}

async function searchProducts(
  api: WooCommerceRestApi,
  search: string,
): Promise<WooProduct[]> {
  try {
    const response = (await api.get("products", {
      search,
      per_page: 100,
    })) as { data?: unknown };
    return Array.isArray(response.data) ? (response.data as WooProduct[]) : [];
  } catch (error: unknown) {
    throw wooFailure(error);
  }
}

async function findProductByExactName(
  api: WooCommerceRestApi,
  wooName: string,
): Promise<WooProduct | "none" | "ambiguous"> {
  const queries = [wooName];
  const short = wooName.split(/\s+/).slice(0, 3).join(" ");
  if (short !== wooName) queries.push(short);

  const seen = new Map<number, WooProduct>();
  for (const search of queries) {
    for (const row of await searchProducts(api, search)) {
      const id = Number(row.id);
      if (Number.isFinite(id)) seen.set(id, row);
    }
  }

  const exact = [...seen.values()].filter((row) => (row.name ?? "").trim() === wooName);
  const hits =
    exact.length > 0
      ? exact
      : [...seen.values()].filter(
          (row) => normalizeCatalogText(row.name ?? "") === normalizeCatalogText(wooName),
        );
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) return "ambiguous";
  return "none";
}

const MINT_ACTOR = "migrate:map-unmatched";

async function hubSkuExists(globalSku: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, globalSku))
    .limit(1);
  return Boolean(row);
}

/**
 * Strict insert. Caller has already confirmed the SKU is absent.
 * finished_goods_catalog.global_sku references sku_mappings, so the mapping
 * row is inserted first inside one transaction. The image is attached after.
 */
async function mintFinishedGood(globalSku: string, wooName: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.insert(sku_mappings).values({
      global_sku: globalSku,
      category: "Finished Good",
      item_type: "finished_good",
      original_name: wooName,
      source_file: "scripts/data_migration/map-unmatched-images.ts",
      updated_by: MINT_ACTOR,
    });
    await tx.insert(finished_goods_catalog).values({
      global_sku: globalSku,
      description: wooName,
      updated_by: MINT_ACTOR,
    });
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const audit = loadAudit();
  assertAuditCoverage(audit);
  const auditImage = new Map(audit.products.map((row) => [row.name, row.imageSrc]));
  const api = wooClient();

  const counts = {
    mapped: Object.keys(WOO_NAME_TO_KATANA_SKU).length,
    minted: 0,
    updated: 0,
    previewed: 0,
    skippedSupabase: 0,
    noImage: 0,
    notFound: 0,
    ambiguous: 0,
    auditFallback: 0,
  };

  for (const [wooName, katanaSku] of Object.entries(WOO_NAME_TO_KATANA_SKU)) {
    const found = await findProductByExactName(api, wooName);
    let imageSrc: string | null = null;
    let viaAudit = false;

    if (found === "ambiguous") {
      counts.ambiguous += 1;
      console.log(`[ambiguous] ${wooName} -> ${katanaSku}`);
      continue;
    }
    if (found === "none") {
      imageSrc = httpUrl(auditImage.get(wooName));
      if (!imageSrc) {
        counts.notFound += 1;
        console.log(`[not-found] ${wooName} -> ${katanaSku}`);
        continue;
      }
      viaAudit = true;
      counts.auditFallback += 1;
    } else {
      imageSrc = httpUrl(found.images?.[0]?.src);
    }

    if (!imageSrc) {
      counts.noImage += 1;
      console.log(`[no-image] woo ${found === "none" ? "?" : found.id} ${wooName}`);
      continue;
    }

    const exists = await hubSkuExists(katanaSku);
    const imageNote = viaAudit ? " (audit image)" : "";

    if (dryRun) {
      counts.previewed += 1;
      if (!exists) counts.minted += 1;
      console.log(
        `[dry-run] ${exists ? "update" : "mint"} ${wooName} -> ${katanaSku}${imageNote}`,
      );
      continue;
    }

    if (!exists) {
      await mintFinishedGood(katanaSku, wooName);
      counts.minted += 1;
    }

    const write = await upsertCatalogImageUrl({
      globalSku: katanaSku,
      imageUrl: imageSrc,
      updatedBy: MINT_ACTOR,
      preserveSupabaseUrl: true,
    });
    if (write === "missing-sku") {
      throw new Error(`${katanaSku} is not on sku_mappings after the mint check`);
    }
    if (write === "updated" && exists) counts.updated += 1;
    if (write === "skipped-supabase") counts.skippedSupabase += 1;
    console.log(
      `[${exists ? write : "minted"}] ${wooName} -> ${katanaSku}${imageNote}`,
    );
  }

  console.log(JSON.stringify({ dryRun, ...counts }));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
