/**
 * Data side of the Institutional Quote Package: which products get a specification page,
 * what each page says, and how ready each product is. Reads only; QBO is never touched.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { logError } from "@/lib/log/structured";
import { getDb } from "@/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  product_assets,
} from "@/server/db/schema";
import { storyHtmlToPlainText } from "@/server/pim/html-sanitize";
import {
  PACKAGE_ISSUE_LABEL,
  renderQuotePackage,
  specIssues,
  type PackageIssue,
  type PackageResult,
  type SpecHero,
  type SpecPageData,
} from "@/server/quotes/package-pdf";
import type { OrderDeskLine, OrderDeskQuote } from "@/server/quotes/view";

/** A hero below this long edge prints soft on letter paper; it is flagged, not dropped. */
export const HERO_HIGH_RES_MIN_EDGE = 1200;
const HERO_BUCKET = "product-images";
const HERO_FETCH_CONCURRENCY = 3;

export type ImageTier = { maxEdge: number; quality: number };

/** Keeps the finished PDF small enough to email as the product count grows. */
export function imageTierFor(productCount: number): ImageTier {
  if (productCount <= 4) return { maxEdge: 1600, quality: 82 };
  if (productCount <= 10) return { maxEdge: 1200, quality: 78 };
  return { maxEdge: 900, quality: 72 };
}

export type PackageLine = {
  sku: string;
  qty: string;
  unitPrice: string | null;
  description: string;
};

/**
 * One entry per distinct stock SKU, in quote order. Custom lines have no catalog page.
 * Quantities add up; the first priced line supplies the unit price.
 */
export function distinctProductLines(lines: readonly OrderDeskLine[]): PackageLine[] {
  const order: string[] = [];
  const bySku = new Map<string, PackageLine>();
  for (const line of [...lines].sort((a, b) => a.lineNo - b.lineNo)) {
    if (line.lineKind === "custom") continue;
    const sku = line.sku.trim().toUpperCase();
    if (!sku) continue;
    const existing = bySku.get(sku);
    if (!existing) {
      order.push(sku);
      bySku.set(sku, {
        sku,
        qty: line.qty,
        unitPrice: line.unitPrice,
        description: line.description,
      });
      continue;
    }
    const total = Number(existing.qty) + Number(line.qty);
    existing.qty = Number.isFinite(total) ? String(total) : existing.qty;
    if (existing.unitPrice == null && line.unitPrice != null) existing.unitPrice = line.unitPrice;
  }
  return order.map((sku) => bySku.get(sku)!);
}

// ---------------------------------------------------------------------------
// Sources (database)
// ---------------------------------------------------------------------------

export type CatalogSource = typeof finished_goods_catalog.$inferSelect;
export type ListingSource = Pick<
  typeof ecommerce_listings.$inferSelect,
  "global_sku" | "product_name" | "collection_label" | "marketing_description" | "archived_at"
>;
export type HeroSource = { sku: string; storagePath: string };

export type SpecSources = {
  catalog: Map<string, CatalogSource>;
  listing: Map<string, ListingSource>;
  heroPath: Map<string, string>;
};

export async function loadSpecSources(skus: readonly string[]): Promise<SpecSources> {
  const sources: SpecSources = { catalog: new Map(), listing: new Map(), heroPath: new Map() };
  if (skus.length === 0) return sources;
  const db = getDb();
  const [catalogRows, listingRows, assetRows] = await Promise.all([
    db
      .select()
      .from(finished_goods_catalog)
      .where(inArray(sql<string>`upper(${finished_goods_catalog.global_sku})`, [...skus])),
    db
      .select({
        global_sku: ecommerce_listings.global_sku,
        product_name: ecommerce_listings.product_name,
        collection_label: ecommerce_listings.collection_label,
        marketing_description: ecommerce_listings.marketing_description,
        archived_at: ecommerce_listings.archived_at,
      })
      .from(ecommerce_listings)
      .where(inArray(sql<string>`upper(${ecommerce_listings.global_sku})`, [...skus])),
    db
      .select({
        global_sku: product_assets.global_sku,
        storage_path: product_assets.storage_path,
      })
      .from(product_assets)
      .where(
        and(
          inArray(sql<string>`upper(${product_assets.global_sku})`, [...skus]),
          eq(product_assets.kind, "primary_image"),
          eq(product_assets.is_current, true),
        ),
      ),
  ]);

  for (const row of catalogRows) sources.catalog.set(row.global_sku.trim().toUpperCase(), row);
  // Prefer a live listing that has copy, then any live listing, then an archived one.
  const rank = (row: ListingSource) =>
    (row.archived_at ? 0 : 2) + (row.marketing_description?.trim() ? 1 : 0);
  for (const row of listingRows) {
    const key = row.global_sku.trim().toUpperCase();
    const current = sources.listing.get(key);
    if (!current || rank(row) > rank(current)) sources.listing.set(key, row);
  }
  for (const row of assetRows) {
    sources.heroPath.set(row.global_sku.trim().toUpperCase(), row.storage_path);
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Assembly (pure)
// ---------------------------------------------------------------------------

function inches(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('"') ? trimmed : `${trimmed}"`;
}

export function dimensionParts(catalog: CatalogSource | undefined): string[] {
  if (!catalog) return [];
  const na = new Set(catalog.na_fields ?? []);
  const entries: Array<[string, string | null, string]> = [
    ["Length", catalog.length, "length"],
    ["Depth", catalog.depth, "depth"],
    ["Height", catalog.height, "height"],
    ["Arm", catalog.arm_height, "arm_height"],
    ["Seat", catalog.sit_height, "sit_height"],
  ];
  const parts: string[] = [];
  for (const [label, value, key] of entries) {
    if (value && value.trim() && !na.has(key)) parts.push(`${label}  ${inches(value)}`);
  }
  return parts;
}

export type HeroState =
  | { state: "ok"; hero: SpecHero }
  | { state: "low"; hero: SpecHero }
  | { state: "none" }
  | { state: "unreadable" };

export type AssembledSpec = { page: SpecPageData; issues: PackageIssue[] };

export function assembleSpec(
  line: PackageLine,
  sources: Pick<SpecSources, "catalog" | "listing">,
  hero: HeroState,
): AssembledSpec {
  const catalog = sources.catalog.get(line.sku);
  const listing = sources.listing.get(line.sku);
  const copyHtml = listing?.marketing_description?.trim() || catalog?.description?.trim() || "";
  const description = copyHtml ? storyHtmlToPlainText(copyHtml).trim() : "";
  const page: SpecPageData = {
    sku: line.sku,
    productName: listing?.product_name?.trim() || line.description || line.sku,
    collectionLabel: listing?.collection_label?.trim() || null,
    qty: line.qty,
    unitPrice: line.unitPrice,
    description: description || null,
    dimensions: dimensionParts(catalog),
    warrantyMonths: catalog?.warranty_term_months ?? null,
    hero: hero.state === "ok" || hero.state === "low" ? hero.hero : null,
  };
  return {
    page,
    issues: specIssues(page, { catalogRow: Boolean(catalog), imageState: hero.state }),
  };
}

export type ReadinessEntry = {
  sku: string;
  productName: string;
  issues: PackageIssue[];
  issueLabels: string[];
};

/** Cheap pre-flight: judged from rows only, no image download. A hero row counts as present. */
export function assessReadiness(
  lines: readonly PackageLine[],
  sources: SpecSources,
): ReadinessEntry[] {
  return lines.map((line) => {
    const hero: HeroState = sources.heroPath.has(line.sku)
      ? { state: "ok", hero: { jpegBase64: "", width: 0, height: 0 } }
      : { state: "none" };
    const { page, issues } = assembleSpec(line, sources, hero);
    return {
      sku: line.sku,
      productName: page.productName,
      issues,
      issueLabels: issues.map((issue) => PACKAGE_ISSUE_LABEL[issue]),
    };
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Fit inside the tier box, orient from EXIF, re-encode as JPEG. Never enlarges. */
export async function prepareHero(
  bytes: Uint8Array,
  tier: ImageTier,
): Promise<{ hero: SpecHero; sourceLongEdge: number }> {
  const source = Buffer.from(bytes);
  const meta = await sharp(source).metadata();
  const sourceLongEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const jpeg = await sharp(source)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: tier.maxEdge, height: tier.maxEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: tier.quality, mozjpeg: true })
    .toBuffer();
  const placed = await sharp(jpeg).metadata();
  return {
    hero: {
      jpegBase64: jpeg.toString("base64"),
      width: placed.width ?? 0,
      height: placed.height ?? 0,
    },
    sourceLongEdge,
  };
}

export type HeroDownloader = (bucket: string, path: string) => Promise<{ bytes: Uint8Array }>;

async function defaultDownloader(bucket: string, path: string) {
  const { getVaultStorage } = await import("@/lib/supabase-storage");
  return getVaultStorage().download(bucket, path);
}

export async function loadHeroes(
  skus: readonly string[],
  heroPath: Map<string, string>,
  tier: ImageTier,
  download: HeroDownloader = defaultDownloader,
): Promise<Map<string, HeroState>> {
  const result = new Map<string, HeroState>();
  const queue = [...skus];

  async function worker(): Promise<void> {
    for (let sku = queue.shift(); sku !== undefined; sku = queue.shift()) {
      const path = heroPath.get(sku);
      if (!path) {
        result.set(sku, { state: "none" });
        continue;
      }
      try {
        const file = await download(HERO_BUCKET, path);
        const { hero, sourceLongEdge } = await prepareHero(file.bytes, tier);
        result.set(
          sku,
          sourceLongEdge < HERO_HIGH_RES_MIN_EDGE ? { state: "low", hero } : { state: "ok", hero },
        );
      } catch (error) {
        // Degrade this one product to a placeholder page and leave a trail. Do not fail the quote.
        logError("quote-package-hero-failed", error, { sku });
        result.set(sku, { state: "unreadable" });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(HERO_FETCH_CONCURRENCY, queue.length) }, () => worker()),
  );
  return result;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type QuotePackageReport = {
  pageCount: number;
  estimatePages: number;
  specPages: number;
  /** Products that printed with a gap. Empty means every page is complete. */
  degraded: ReadinessEntry[];
  byteLength: number;
};

export async function buildQuotePackage(
  quote: OrderDeskQuote,
  deps: { download?: HeroDownloader } = {},
): Promise<{ bytes: Uint8Array; report: QuotePackageReport }> {
  const lines = distinctProductLines(quote.lines);
  const skus = lines.map((line) => line.sku);
  const sources = await loadSpecSources(skus);
  const heroes = await loadHeroes(skus, sources.heroPath, imageTierFor(lines.length), deps.download);

  const assembled = lines.map((line) =>
    assembleSpec(line, sources, heroes.get(line.sku) ?? { state: "none" }),
  );
  const rendered: PackageResult = renderQuotePackage(
    quote,
    assembled.map((entry) => entry.page),
  );

  return {
    bytes: rendered.bytes,
    report: {
      pageCount: rendered.pageCount,
      estimatePages: rendered.estimatePages,
      specPages: rendered.specPages,
      byteLength: rendered.bytes.byteLength,
      degraded: assembled
        .filter((entry) => entry.issues.length > 0)
        .map((entry) => ({
          sku: entry.page.sku,
          productName: entry.page.productName,
          issues: entry.issues,
          issueLabels: entry.issues.map((issue) => PACKAGE_ISSUE_LABEL[issue]),
        })),
    },
  };
}

export async function readQuotePackageReadiness(quote: OrderDeskQuote): Promise<ReadinessEntry[]> {
  const lines = distinctProductLines(quote.lines);
  const sources = await loadSpecSources(lines.map((line) => line.sku));
  return assessReadiness(lines, sources);
}
