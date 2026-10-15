/**
 * Seed and teardown for the Phase 13 browser specs (Mission Control, Order Desk quote package).
 *
 * Everything created here is namespaced by a per-spec random `run` token and removed in teardown,
 * so a failed run cannot leave rows that another run (or the real hub) would trip over.
 *
 * Mission Control deliberately REJECTS the e2e god-mode cookie (src/proxy.ts), so the Mission Control
 * spec signs in as a real Supabase user created with the service-role admin API and given a real
 * `user_roles` row. The Order Desk spec uses the god-mode cookie like every other embed spec.
 */
import path from "path";
import { randomBytes } from "crypto";
import * as dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { closeDb, getDb } from "../../../src/server/db/client";
import { createSupabaseFetch } from "../../../src/lib/supabase-env";
import {
  finished_goods_catalog,
  pim_audit_log,
  product_assets,
  quote_line_items,
  quotes,
  sku_mappings,
  user_roles,
} from "../../../src/server/db/schema";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

if (process.env.POSTGRES_URL_TX?.trim()) {
  process.env.POSTGRES_URL = process.env.POSTGRES_URL_TX.trim();
} else if (process.env.POSTGRES_URL?.includes(".pooler.supabase.com:5432")) {
  process.env.POSTGRES_URL = process.env.POSTGRES_URL.replace(":5432", ":6543");
}

export { getDb };

export function newRunToken(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export async function closePhase13Db(): Promise<void> {
  await closeDb();
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and a Supabase secret key are required for the Phase 13 specs.");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createSupabaseFetch(key) },
  });
}

// ---------------------------------------------------------------------------
// Mission Control operator (real Supabase user + SuperAdmin role)
// ---------------------------------------------------------------------------

export type QaOperator = { id: string; email: string; password: string };

export async function createMissionControlOperator(run: string): Promise<QaOperator> {
  const email = `qa.mc.${run.toLowerCase()}@ccpatio.com`;
  const password = `Qa!${randomBytes(9).toString("base64url")}`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Could not create the QA operator (auth status ${error?.status ?? "none"}).`);
  }
  await getDb()
    .insert(user_roles)
    .values({ id: data.user.id, role: "SuperAdmin" })
    .onConflictDoUpdate({ target: user_roles.id, set: { role: "SuperAdmin", updated_at: new Date() } });
  return { id: data.user.id, email, password };
}

export async function deleteMissionControlOperator(operator: QaOperator): Promise<void> {
  const db = getDb();
  await db.delete(pim_audit_log).where(eq(pim_audit_log.operator_email, operator.email));
  await db.delete(user_roles).where(eq(user_roles.id, operator.id));
  const { error } = await adminClient().auth.admin.deleteUser(operator.id);
  if (error) throw new Error(`Could not delete the QA operator (auth status ${error.status ?? "none"}).`);
}

// ---------------------------------------------------------------------------
// Catalog Hygiene Radar product
// ---------------------------------------------------------------------------

/** A leading "0" sorts first, so the radar's worst-first ranking keeps these rows inside its 100-row window. */
export function hygieneSku(run: string, which: "MAIN" | "PREFILL" = "MAIN"): string {
  return `0QA-E2E-HYGIENE-${run}-${which}`;
}

const HYGIENE_VARIANTS = ["MAIN", "PREFILL"] as const;

/**
 * MAIN is bare (no price, no dimensions, no 3D asset). PREFILL has a catalog row with length and height already
 * stored, so it still shows all three issues (no price, blank depth, no 3D asset) but its Quick Access form
 * must open pre-filled from the stored row.
 */
export async function seedHygieneProduct(run: string): Promise<{
  sku: string;
  name: string;
  prefill: { sku: string; name: string };
}> {
  await cleanupHygieneProduct(run);
  const make = (which: (typeof HYGIENE_VARIANTS)[number]) => ({
    sku: hygieneSku(run, which),
    name: `QA Hygiene Radar ${which === "MAIN" ? "Sofa" : "Chair"} ${run}`,
  });
  const main = make("MAIN");
  const prefill = make("PREFILL");
  const db = getDb();
  await db.insert(sku_mappings).values(
    [main, prefill].map((product) => ({
      global_sku: product.sku,
      category: "QA",
      item_type: "finished_good" as const,
      original_name: product.name,
      source_file: "qa-e2e-phase13",
      is_active: true,
    })),
  );
  await db.insert(finished_goods_catalog).values({ global_sku: prefill.sku, length: "84", height: "32" });
  return { ...main, prefill };
}

export async function cleanupHygieneProduct(run: string): Promise<void> {
  const db = getDb();
  const skus = HYGIENE_VARIANTS.map((which) => hygieneSku(run, which));
  await db.delete(pim_audit_log).where(inArray(pim_audit_log.global_sku, skus));
  await db.delete(finished_goods_catalog).where(inArray(finished_goods_catalog.global_sku, skus));
  await db.delete(sku_mappings).where(inArray(sku_mappings.global_sku, skus));
}

export async function readHygieneState(run: string, which: (typeof HYGIENE_VARIANTS)[number] = "MAIN") {
  const db = getDb();
  const sku = hygieneSku(run, which);
  const [catalog] = await db
    .select()
    .from(finished_goods_catalog)
    .where(eq(finished_goods_catalog.global_sku, sku))
    .limit(1);
  const audit = await db.select().from(pim_audit_log).where(eq(pim_audit_log.global_sku, sku));
  return { catalog, audit: audit.filter((row) => row.action === "hygiene_radar_patch") };
}
// ---------------------------------------------------------------------------
// Quote package fixture
// ---------------------------------------------------------------------------

const HERO_BUCKET = "product-images";

export type PackageSeed = {
  quoteId: string;
  readySku: string;
  gapSku: string;
  customerName: string;
  heroPath: string;
};

function phoenixToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
}

/**
 * A walk-in draft with two stock lines:
 *   A  complete catalog row, copy, dimensions, warranty and a real 1600 px hero in Supabase Storage
 *   B  no catalog row and no image (prints with gaps)
 * Freight is pre-set so the portal does not call a carrier when the page loads.
 */
export async function seedQuotePackage(run: string): Promise<PackageSeed> {
  await cleanupQuotePackage(run);
  const db = getDb();
  const readySku = `FIN-QA-E2E-PKG-${run}-A`;
  const gapSku = `FIN-QA-E2E-PKG-${run}-B`;
  const customerName = `QA Package Customer ${run}`;
  const heroPath = `${readySku}/qa-hero-${run}.png`;

  await db.insert(sku_mappings).values(
    [readySku, gapSku].map((global_sku, index) => ({
      global_sku,
      category: "QA",
      item_type: "finished_good" as const,
      original_name: `QA Package Lounge ${index === 0 ? "Complete" : "Bare"} ${run}`,
      source_file: "qa-e2e-phase13",
      is_active: true,
    })),
  );
  await db.insert(finished_goods_catalog).values({
    global_sku: readySku,
    msrp: "2450.00",
    length: "96",
    depth: "40",
    height: "30",
    description: "<p>Hand-welded aluminum frame with solution-dyed cushions.</p>",
    warranty_term_months: 60,
  });

  const png = await sharp({
    create: { width: 1600, height: 1100, channels: 3, background: { r: 197, g: 160, b: 89 } },
  })
    .png()
    .toBuffer();
  const upload = await adminClient().storage.from(HERO_BUCKET).upload(heroPath, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (upload.error) {
    throw new Error(`Could not upload the QA hero image to ${HERO_BUCKET} (${upload.error.message}).`);
  }
  await db.insert(product_assets).values({
    global_sku: readySku,
    kind: "primary_image",
    storage_path: heroPath,
    original_filename: `qa-hero-${run}.png`,
    content_type: "image/png",
    byte_size: png.byteLength,
    is_current: true,
  });

  const [quote] = await db
    .insert(quotes)
    .values({
      ghl_user_id: `qa-e2e-${run}`,
      ghl_user_name: "QA E2E",
      customer_name: customerName,
      customer_email: "qa-package@ccpatio.test",
      bill_to_address: "1 Test Way\nScottsdale, AZ 85260",
      ship_to_address: "2 Delivery Ln\nLos Angeles, CA 90005",
      status: "draft",
      dest_zip: "85260",
      merchandise_total: "5900.00",
      freight_method: "INTERNAL_FLEET",
      freight_total: "250.00",
      executed_by: phoenixToday(),
      promise_date: phoenixToday(),
    })
    .returning({ id: quotes.id });
  if (!quote) throw new Error("Could not insert the QA quote.");

  await db.insert(quote_line_items).values([
    {
      quote_id: quote.id,
      line_no: 1,
      line_kind: "stock_hold",
      sku: readySku,
      qty: "2.0000",
      unit_price: "2450.00",
      description: "QA Package Lounge Complete",
    },
    {
      quote_id: quote.id,
      line_no: 2,
      line_kind: "stock_hold",
      sku: gapSku,
      qty: "1.0000",
      unit_price: "1000.00",
      description: "QA Package Lounge Bare",
    },
  ]);

  return { quoteId: quote.id, readySku, gapSku, customerName, heroPath };
}

export async function cleanupQuotePackage(run: string): Promise<void> {
  const db = getDb();
  const skus = [`FIN-QA-E2E-PKG-${run}-A`, `FIN-QA-E2E-PKG-${run}-B`];
  const heroPath = `${skus[0]}/qa-hero-${run}.png`;
  await db.delete(quotes).where(eq(quotes.customer_name, `QA Package Customer ${run}`));
  await db.delete(product_assets).where(inArray(product_assets.global_sku, skus));
  await db.delete(finished_goods_catalog).where(inArray(finished_goods_catalog.global_sku, skus));
  await db.delete(sku_mappings).where(inArray(sku_mappings.global_sku, skus));
  const removed = await adminClient().storage.from(HERO_BUCKET).remove([heroPath]);
  if (removed.error) {
    throw new Error(`Could not remove the QA hero image (${removed.error.message}).`);
  }
}

export async function readQuoteState(quoteId: string) {
  const [quote] = await getDb().select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  return quote;
}
