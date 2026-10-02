/**
 * Read WooCommerce products and attach images[0].src to matching FIN-* rows.
 * Writes only on an exact SKU (or exact alias) or a case-insensitive exact name.
 *
 * GET only. Does not POST to Woo, Katana, or Clover.
 *
 *   npm run migrate:sync-woo
 *   npm run migrate:sync-woo -- --dry-run
 *
 * Requires WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET.
 * Writes scripts/data_migration/woo-variants-map.json for attribute audit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { like } from "drizzle-orm";
import { upsertCatalogImageUrl, type CatalogImageWrite } from "../../src/lib/catalog-image";
import { normalizeCatalogText } from "../../src/lib/finished-good-sku";
import { closeDb, getDb } from "../../src/server/db/client";
import { sku_aliases, sku_mappings } from "../../src/server/db/schema";

const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const OUT_PATH = join(process.cwd(), "scripts/data_migration/woo-variants-map.json");

type WooAttribute = {
  name?: string;
  option?: string;
  options?: string[];
};

type WooProduct = {
  id?: number;
  name?: string;
  sku?: string;
  type?: string;
  images?: Array<{ src?: string }>;
  attributes?: WooAttribute[];
};

type WooVariation = {
  id?: number;
  sku?: string;
  attributes?: WooAttribute[];
};

type DictRow = { sku: string; name: string };

type ImageWrite =
  | CatalogImageWrite
  | "dry-run"
  | "skipped-no-match"
  | "skipped-no-image"
  | "ambiguous";

type VariantMapProduct = {
  wooId: number;
  wooSku: string | null;
  name: string;
  matchedGlobalSku: string | null;
  matchReason: string | null;
  imageSrc: string | null;
  imageWrite: ImageWrite;
  attributes: Array<{ name: string; options: string[] }>;
  variations: Array<{
    variationId: number;
    sku: string | null;
    attributes: Array<{ name: string; option: string }>;
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

function wooConfig(): { url: string; consumerKey: string; consumerSecret: string } {
  const url = unquote(process.env.WOOCOMMERCE_URL ?? "").replace(/\/$/, "");
  const consumerKey = unquote(process.env.WOOCOMMERCE_CONSUMER_KEY ?? "");
  const consumerSecret = unquote(process.env.WOOCOMMERCE_CONSUMER_SECRET ?? "");
  if (!url || !consumerKey || !consumerSecret) {
    throw new Error(
      "Missing WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, or WOOCOMMERCE_CONSUMER_SECRET",
    );
  }
  return { url, consumerKey, consumerSecret };
}

/**
 * ccpatio.com is behind LiteSpeed and Cloudflare.
 * Basic auth is handled as a WordPress username login (invalid_username).
 * Plain consumer_key query params are dropped before PHP.
 * OAuth 1.0a is the package's non-HTTPS path, and it is what reaches Woo.
 */
function wooClient(config: {
  url: string;
  consumerKey: string;
  consumerSecret: string;
}): WooCommerceRestApi {
  const api = new WooCommerceRestApi({
    url: config.url,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
    version: "wc/v3",
    queryStringAuth: true,
  });
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
  if (code === "woocommerce_rest_authentication_error" && /consumer key is invalid/i.test(message)) {
    return new Error(
      "WooCommerce rejected WOOCOMMERCE_CONSUMER_KEY (Consumer key is invalid). Create a new Read key under WooCommerce → Settings → Advanced → REST API for an Administrator or Shop Manager on this store, then replace the key and secret in .env.local.",
    );
  }
  if (status === 401 || status === 403) {
    return new Error(`WooCommerce ${status} (${code || "unauthorized"}): ${message}`);
  }
  return new Error(status ? `WooCommerce ${status}: ${message}` : message);
}

function isFrameOrFabric(name: string): boolean {
  return /powder|frame|fabric|cushion|sunbrella/i.test(name);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

async function listAll<T>(api: WooCommerceRestApi, endpoint: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let response: { data?: unknown; headers?: Record<string, string> };
    try {
      response = await api.get(endpoint, { per_page: PAGE_SIZE, page });
    } catch (error: unknown) {
      throw wooFailure(error);
    }
    const payload = response?.data;
    if (payload == null) break;
    if (!Array.isArray(payload)) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message?: unknown }).message)
          : "WooCommerce returned a non-list payload";
      throw new Error(`${endpoint}: ${message}`);
    }
    rows.push(...(payload as T[]));
    const totalPages = Number(response?.headers?.["x-wp-totalpages"]);
    if (payload.length < PAGE_SIZE) break;
    if (Number.isFinite(totalPages) && totalPages > 0 && page >= totalPages) break;
  }
  return rows;
}

function parentAttributes(product: WooProduct): Array<{ name: string; options: string[] }> {
  const attributes = Array.isArray(product.attributes) ? product.attributes : [];
  return attributes
    .filter((attribute) => isFrameOrFabric(String(attribute.name ?? "")))
    .map((attribute) => ({
      name: String(attribute.name ?? ""),
      options: Array.isArray(attribute.options)
        ? attribute.options.map((option) => String(option))
        : attribute.option
          ? [String(attribute.option)]
          : [],
    }));
}

function variationAttributes(
  variation: WooVariation,
): Array<{ name: string; option: string }> {
  const attributes = Array.isArray(variation.attributes) ? variation.attributes : [];
  return attributes
    .filter((attribute) => isFrameOrFabric(String(attribute.name ?? "")))
    .map((attribute) => ({
      name: String(attribute.name ?? ""),
      option: String(attribute.option ?? attribute.options?.[0] ?? ""),
    }));
}

function matchFinishedGood(
  product: WooProduct,
  bySku: Map<string, DictRow>,
  aliasToCanonical: Map<string, string>,
): { sku: string; reason: string } | { ambiguous: string } | null {
  const wooSku = String(product.sku ?? "").trim().toUpperCase();
  if (wooSku && bySku.has(wooSku)) {
    return { sku: wooSku, reason: "exact-sku" };
  }
  if (wooSku && aliasToCanonical.has(wooSku)) {
    return { sku: aliasToCanonical.get(wooSku)!, reason: "exact-sku" };
  }

  const key = normalizeCatalogText(String(product.name ?? ""));
  if (!key) return null;
  const exact = [...bySku.values()].filter(
    (row) => normalizeCatalogText(row.name) === key,
  );
  if (exact.length === 1) return { sku: exact[0]!.sku, reason: "exact-name" };
  if (exact.length > 1) {
    return { ambiguous: exact.map((row) => row.sku).join(", ") };
  }
  return null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const config = wooConfig();
  const api = wooClient(config);

  const db = getDb();
  const mappings = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(like(sku_mappings.global_sku, "FIN-%"));
  const bySku = new Map<string, DictRow>();
  for (const row of mappings) {
    bySku.set(row.sku.trim().toUpperCase(), { sku: row.sku.trim().toUpperCase(), name: row.name });
  }

  const aliases = await db
    .select({
      alias: sku_aliases.alias_sku,
      canonical: sku_aliases.canonical_sku,
    })
    .from(sku_aliases);
  const aliasToCanonical = new Map<string, string>();
  for (const row of aliases) {
    const canonical = row.canonical.trim().toUpperCase();
    if (canonical.startsWith("FIN-") && bySku.has(canonical)) {
      aliasToCanonical.set(row.alias.trim().toUpperCase(), canonical);
    }
  }

  const products = await listAll<WooProduct>(api, "products");
  const mapped: VariantMapProduct[] = [];
  const counts = {
    products: products.length,
    matched: 0,
    updated: 0,
    skippedSupabase: 0,
    unmatched: 0,
    ambiguous: 0,
  };

  for (const product of products) {
    const wooId = Number(product.id);
    if (!Number.isFinite(wooId) || wooId <= 0) continue;
    const variations =
      product.type === "variable"
        ? await listAll<WooVariation>(api, `products/${wooId}/variations`)
        : [];
    const imageSrc = httpUrl(product.images?.[0]?.src);
    const match = matchFinishedGood(product, bySku, aliasToCanonical);

    let matchedGlobalSku: string | null = null;
    let matchReason: string | null = null;
    let imageWrite: ImageWrite = "skipped-no-match";

    if (match && "ambiguous" in match) {
      imageWrite = "ambiguous";
      counts.ambiguous += 1;
      console.log(`[ambiguous] woo ${wooId} ${product.name ?? ""} -> ${match.ambiguous}`);
    } else if (match) {
      matchedGlobalSku = match.sku;
      matchReason = match.reason;
      counts.matched += 1;
      if (!imageSrc) {
        imageWrite = "skipped-no-image";
      } else if (dryRun) {
        imageWrite = "dry-run";
      } else {
        imageWrite = await upsertCatalogImageUrl({
          globalSku: match.sku,
          imageUrl: imageSrc,
          updatedBy: "migrate:sync-woo",
          preserveSupabaseUrl: true,
        });
        if (imageWrite === "updated") counts.updated += 1;
        if (imageWrite === "skipped-supabase") counts.skippedSupabase += 1;
      }
    } else {
      counts.unmatched += 1;
      console.log(
        `[unmatched] woo ${wooId} ${product.name ?? ""} sku=${product.sku?.trim() || "(none)"}`,
      );
    }

    mapped.push({
      wooId,
      wooSku: product.sku?.trim() ? product.sku.trim() : null,
      name: String(product.name ?? ""),
      matchedGlobalSku,
      matchReason,
      imageSrc,
      imageWrite,
      attributes: parentAttributes(product),
      variations: variations.flatMap((variation) => {
        const attributes = variationAttributes(variation);
        if (attributes.length === 0) return [];
        const variationId = Number(variation.id);
        if (!Number.isFinite(variationId)) return [];
        return [
          {
            variationId,
            sku: variation.sku?.trim() ? variation.sku.trim() : null,
            attributes,
          },
        ];
      }),
    });
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dryRun,
        counts,
        products: mapped,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      dryRun,
      ...counts,
      audit: OUT_PATH,
    }),
  );
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
