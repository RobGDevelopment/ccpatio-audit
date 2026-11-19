/**
 * Live PrimeView Phase 1 handoff artifacts — Technical Spec (.md), 169-col CSV,
 * and 24-fabric swatch manifest — generated on the fly from Hub Postgres.
 */
import { inArray, like } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  sku_mappings,
} from "@/server/db/schema";
import {
  PHASE1_ADDON_ACF_KEYS,
  PHASE1_FABRICS,
  PHASE1_POWDERS,
  readMiaApproval,
  shippingClassFromLb,
} from "@/server/ecommerce/phase1-portal";
import {
  PHASE1_FABRIC_DISPLAY_NAMES,
  PHASE1_POWDER_DISPLAY_NAMES,
} from "@/server/woocommerce/finish-keys";
import {
  PRODUCTION_WOO_WEBHOOK_URL,
} from "@/lib/primeview-handoff-auth";
import {
  buildFabricSwatchesJson,
  buildPhase1ImportBundle,
  csvEscape,
  fabricSwatchPublicUrl,
  lbToKg,
  rowsToCsvText,
  type CsvRow,
  type HandoffLine,
  type Phase1ImportBundle,
} from "../../../scripts/ops/generate-primeview-phase1-csv";
import { PHASE1_RESALE_SKUS } from "../../../scripts/ops/enable-phase1-hub-data";

export const PHASE1_PARENT_COUNT = 47;
export const PHASE1_VARIATION_COUNT = 100;
export const PHASE1_SIMPLE_COUNT = 7;
export const PHASE1_PURCHASABLE_SKU_COUNT = 107;
export const PHASE1_SOW_ITEM_COUNT = 102;

export type LiveStorefrontRow = {
  collection: string;
  productName: string;
  wooSku: string;
  canonicalSku: string;
  regularPrice: string;
  salePrice: string;
  weightLb: string;
  shippingClass: string;
  options: string;
  miaApproved: boolean;
  miaApprovedAt: string | null;
  isWebVisible: boolean;
  parentId: string;
  fulfillment: "Make" | "Resale";
};

export type FabricSwatchManifestEntry = {
  sku: string;
  label: string;
  color: string;
  image_url: string;
};

export type LiveHandoffBundle = {
  generatedAtUtc: string;
  generatedAtMst: string;
  miaApprovedCount: number;
  miaLatestApprovedAt: string | null;
  parentCount: number;
  variationCount: number;
  simpleCount: number;
  uniquePurchasableSkus: number;
  sowItemCount: number;
  storefrontRows: LiveStorefrontRow[];
  handoffMarkdown: string;
  csvText: string;
  csvFilename: string;
  swatchesManifest: FabricSwatchManifestEntry[];
  webhookUrl: string;
};

function formatMst(isoUtc: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      dateStyle: "medium",
      timeStyle: "medium",
      hour12: false,
    }).format(new Date(isoUtc));
  } catch {
    return isoUtc;
  }
}

function money(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(2);
}

function overlayLivePortalEdits(
  rows: CsvRow[],
  liveBySku: Map<
    string,
    {
      regularPrice: string | null;
      salePrice: string | null;
      weightLb: string | null;
      isWebVisible: boolean;
    }
  >,
): CsvRow[] {
  return rows.map((row) => {
    const type = (row.Type || "").toLowerCase();
    if (type !== "simple" && type !== "variation") return row;
    const sku = (row.SKU || "").trim();
    if (!sku) return row;
    const live = liveBySku.get(sku);
    if (!live) return row;
    const next = { ...row };
    if (live.regularPrice) next["Regular price"] = money(live.regularPrice);
    if (live.salePrice) next["Sale price"] = money(live.salePrice);
    const wt = live.weightLb ? Number(live.weightLb) : NaN;
    if (Number.isFinite(wt) && wt > 0) {
      next["Weight (kg)"] = lbToKg(wt);
      next["Shipping class"] = shippingClassFromLb(wt);
    }
    if (!live.isWebVisible) {
      next.Published = "0";
      next["Visibility in catalog"] = next["Visibility in catalog"] || "hidden";
    }
    return next;
  });
}

function cartToOrderPhpSnippet(): string {
  return `<?php
/**
 * CC Patio / Hub — persist configurator meta onto cart + order line items.
 * Target: ccpatiodev2.primeview.com
 */
add_filter('woocommerce_add_cart_item_data', function ($cart_item_data, $product_id, $variation_id) {
    $keys = [
        'fabric', 'fabric_sku', 'powder_coat', 'frame', 'frame_material',
        'ironwood', 'umbrella_cover', 'casters', 'wheels',
        'fly_tables', 'fly_table', 'fly_table_13_x_30',
        'fly_table_12_x_36_welded_on_back', 'fly_table_12_x_48_welded_on_back',
        'arms', 'arms_8_thick_textile-wrapped', 'dekton_sidearm', 'umbrella_holder',
        'coated_led_weight', 'pillow_for_loungers_w_pocket',
        'base_w_wheels', 'base_price', 'custom_welded_fly_table',
        'facing', 'select_facing',
    ];
    foreach ($keys as $key) {
        if (!isset($_REQUEST[$key])) continue;
        $val = wc_clean(wp_unslash($_REQUEST[$key]));
        if ($val === '' || $val === null) continue;
        $cart_item_data['ccp_' . $key] = $val;
    }
    return $cart_item_data;
}, 10, 3);

add_action('woocommerce_checkout_create_order_line_item', function ($item, $cart_item_key, $values, $order) {
    foreach ($values as $key => $val) {
        if (strpos($key, 'ccp_') !== 0) continue;
        $meta_key = substr($key, 4);
        $item->add_meta_data($meta_key, $val, true);
    }
}, 10, 4);`;
}

function renderAcfMatrix(): string {
  return `| Meta key | Hub behavior on \`"1"\` / \`"yes"\` / \`"true"\` |
| --- | --- |
| \`fabric\` / \`fabric_sku\` | finish slot → \`FAB-*\` |
| \`powder_coat\` | finish slot → \`PWD-*\` (Ready-Make hardcoded powder swap supported) |
| \`frame\` / \`frame_material\` | **Aluminum-only:** omit or \`Aluminum\` / \`MET-ALUM\` → \`MET-ALUM\`; \`Steel\` / \`MET-STEEL\` → quarantine \`steel_discontinued_on_ecommerce\`. **Website Regular Price = Mia Aluminum PDF (not Steel MSRP × 1.10) — DO NOT add separate APF/ACF frame upcharges.** |
| \`facing\` / \`select_facing\` / \`pa_select-facing\` | **ignored** (facing already in variation SKU) |
| \`ironwood\` | \`FIN-ESY-MIS-ADDIRONWOOD\` (SO-only) |
| \`umbrella_cover\` | \`FIN-ESY-MIS-WEATHERPROOFCO\` (SO-only) |
| \`casters\` / \`wheels\` | \`FIN-ESY-CHS\` (SO-only) |
| \`fly_tables\` / \`fly_table\` | \`FIN-OCN-TAB-34X12\` (Make) |
| \`fly_table_13_x_30\` | \`FIN-OCN-TAB-13X30\` (Make) |
| \`fly_table_12_x_36_welded_on_back\` | \`FIN-ESY-MIS-FLYTBL-12X36-WLD\` (SO-only) |
| \`fly_table_12_x_48_welded_on_back\` | \`FIN-ESY-MIS-FLYTBL-12X48-WLD\` (SO-only) |
| \`arms\` | \`FIN-ESY-MIS-ARMS\` (SO-only) |
| \`arms_8_thick_textile-wrapped\` | \`FIN-ESY-MIS-ARMS-8TEXTILE\` (SO-only) |
| \`dekton_sidearm\` | \`FIN-ESY-MIS-DKT-SIDEARM\` (SO-only) |
| \`umbrella_holder\` | \`FIN-ESY-MIS-UMBHOLDER\` (SO-only) |
| \`coated_led_weight\` | \`FIN-TJM-MIS-ONECOATED\` (SO-only / Tenjam) |
| \`pillow_for_loungers_w_pocket\` | \`FIN-TJM-MIS-PILLOWLOUNGERS\` (SO-only / Tenjam) |
| \`base_w_wheels\` / \`base_price\` | \`FIN-ESY-MIS-ZENBASE\` (SO-only) |
| \`custom_welded_fly_table\` | **quarantine** \`custom_quote_addon_requires_sales\` (Contact Sales) |`;
}

export function renderLiveHandoffMarkdown(input: {
  generatedAtUtc: string;
  generatedAtMst: string;
  miaApprovedCount: number;
  miaLatestApprovedAt: string | null;
  variationCount: number;
  simpleCount: number;
  uniquePurchasableSkus: number;
  parentCount: number;
  sowItemCount: number;
  makeCount: number;
  resaleCount: number;
  handoff: HandoffLine[];
  storefrontRows: LiveStorefrontRow[];
  swatchSampleUrls: string[];
}): string {
  const latest =
    input.miaLatestApprovedAt != null
      ? `${input.miaLatestApprovedAt} (UTC) / ${formatMst(input.miaLatestApprovedAt)} MST`
      : "—";
  const storefrontTable = input.storefrontRows
    .map((r) => {
      const approved = r.miaApproved ? "Yes" : "No";
      return `| ${r.collection.replace(/\|/g, "/")} | ${r.productName.replace(/\|/g, "/")} | \`${r.wooSku}\` | ${r.regularPrice}${r.salePrice ? ` / ${r.salePrice}` : ""} | ${r.weightLb} lb · ${r.shippingClass} | ${r.options.replace(/\|/g, "/")} | ${approved} |`;
    })
    .join("\n");

  const sowTable = input.handoff
    .map(
      (h) =>
        `| ${h.sowRow} | ${h.sowName.replace(/\|/g, "/")} | ${h.parentId} | ${h.parentName.replace(/\|/g, "/")} | ${h.variationId} | \`${h.wooSku}\` | \`${h.canonicalSku}\` | ${h.fulfillment} | ${h.price} | ${h.weightLb} | ${h.shipping} |`,
    )
    .join("\n");

  const swatchLines = input.swatchSampleUrls
    .slice(0, 3)
    .map((u) => `- ${u}`)
    .join("\n");

  return `# PrimeView Phase 1 Handoff Spec (Yardi / ccpatiodev2.primeview.com)

## Live Approval & Sync Header

| Field | Value |
| --- | --- |
| **Generated (UTC)** | ${input.generatedAtUtc} |
| **Generated (MST / America/Phoenix)** | ${input.generatedAtMst} |
| **Mia Approval Status** | **${input.miaApprovedCount} / ${input.sowItemCount} Approved** |
| **Latest Mia approval** | ${latest} |
| **Storefront parents** | ${input.parentCount} |
| **Purchasable Woo SKUs** | ${input.variationCount} variations + ${input.simpleCount} simple = **${input.uniquePurchasableSkus}** unique SKUs covering all **${input.sowItemCount}** Phase 1 SOW items |
| **Make / Resale rows** | ${input.makeCount} / ${input.resaleCount} |
| **Import file** | \`primeview-phase1-102-import.csv\` (169 columns, generated live from Hub DB) |
| **Production webhook** | \`${PRODUCTION_WOO_WEBHOOK_URL}\` |

> **Katana native WooCommerce plugin must remain disabled.** Hub owns Path B ingress at the production webhook above (\`order.created\` + \`order.updated\`, HMAC \`X-WC-Webhook-Signature\`).

---

## 1. Executive Summary

CC Patio Hub owns catalog authority. This live CSV is the turnkey WooCommerce Product CSV Import for PrimeView/Yardi on \`ccpatiodev2.primeview.com\`:

- **Aluminum Website Price (Mia PDF):** \`Regular price\` comes from Mia's Aluminum column (Oct 1 base + manual \`$0\`/\`$5\` rounding). Disregard Steel MSRP on the storefront. Steel is removed from storefront options. **DO NOT add separate APF/ACF frame upcharges.** Cabana pillows + 3P resale use Mia's non-metal prices 1:1.
- Exact 169 headers from \`product_export_import_headers.csv\` (UTF-8, \`ID\` without BOM corruption)
- Preserved PrimeView parent IDs and existing variation IDs where present
- **${input.uniquePurchasableSkus} unique purchasable SKUs** on every \`simple\` / \`variation\` row (variable parents keep blank SKU)
- Corner Sofa (\`27674\`) + Corner Chaise (\`27687\`) Attribute 2 = **Select Facing** (\`Left-Side Facing\`, \`Right-Side Facing\`), default Left
- Metric weights/dimensions, shipping class (\`parcel\` < 50 lb, \`freight-ltl\` ≥ 50 lb)
- \`acf_fabric_swatches_json\` on upholstered parents (24 FAB-* swatches with **live HTTP-200** Supabase public URLs)
- Inline retail / sale price, weight, and visibility edits Mia saves in the GHL master-catalog portal are reflected live
- All \`Meta: _w3d_*\` columns forced blank (3D excluded from Phase 1)

## 2. Import Instructions (PrimeView WP / Yardi)

1. Backup the staging site (DB + uploads) on \`ccpatiodev2.primeview.com\`.
2. WooCommerce → Products → Import → upload \`primeview-phase1-102-import.csv\` (download from Hub partner portal or GHL catalog).
3. Map columns 1:1 (header names already match Woo export/import).
4. Choose **Update existing products** keyed by \`ID\` where ID is present; create when ID blank.
5. After import, spot-check Bravada Club Chair fabric JSON, Corner Sofa/Chaise Select Facing + \`-LS\`/\`-RS\`, Fly Leg Chair under \`28147\`, Ripple/Cantilever unique simples.
6. Install the Cart→Order metadata PHP hook in §4, then configure NMI + webhook (§5) before flipping live traffic.

## 3. Live 107-SKU Storefront Table (Hub portal truth)

| Collection | Product & Size | Woo SKU | Regular/Sale Price | Weight & Shipping Class | Options | Mia Approved |
| --- | --- | --- | --- | --- | --- | --- |
${storefrontTable}

### Parent → Variation SKU Reference (all ${input.sowItemCount})

| SOW# | Product | Parent ID | Parent | Variation ID | Woo SKU | Canonical | Fulfillment | Price | Wt (lb) | Ship |
| ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | --- |
${sowTable}

## 4. Cart → Order Metadata PHP Hook (drop-in for PrimeView)

Paste into the child theme \`functions.php\` (or a small MU-plugin). This persists fabric / powder / frame and every checked ACF add-on onto the order line so WooCommerce webhooks include them in \`line_items[].meta_data\`.

\`\`\`php
${cartToOrderPhpSnippet()}
\`\`\`

## 5. Webhook & Domain Contract + 16-key ACF map

**Production endpoint (required):**

\`POST ${PRODUCTION_WOO_WEBHOOK_URL}\`

Topics: \`order.created\` + \`order.updated\`

Headers:

- \`X-WC-Webhook-Topic\`: \`order.created\` or \`order.updated\`
- \`X-WC-Webhook-Signature\`: base64(HMAC-SHA256(secret, raw body))
- \`X-WC-Webhook-Delivery-ID\`: unique delivery id

**Disable Katana's native WooCommerce plugin** on the PrimeView store. Dual ingress will double-book Katana.

### Advanced Product Fields Compatibility

- PrimeView's Advanced Product Fields plugin exposes \`./wp-json/wc-product-fields/v1/products/\` for field definitions.
- Hub REST sync (\`wc/v3\`) continues to write \`acf_fabric_swatches_json\` and \`*_price\` meta keys on the product.
- Keep both: ACF JSON for storefront swatches; \`wc/v3\` meta for Hub-authoritative add-on prices (\`${PHASE1_ADDON_ACF_KEYS.slice(0, 4).join("`, `")}\`, …).

${renderAcfMatrix()}

### Live fabric swatch URLs (sample)

${swatchLines || "- (swatches resolve from Supabase public \`fabrics/fab-*.jpg\` paths)"}

Full 24-entry manifest is available as \`Download 24 Fabric Swatches Manifest (.json)\` from the partner portal.

### 24 Fabric Swatches (real Hub SKUs — map every APF dropdown here)

| Hub SKU | Display Name |
| --- | --- |
${PHASE1_FABRICS.map(
  (sku) => `| \`${sku}\` | ${PHASE1_FABRIC_DISPLAY_NAMES[sku] ?? sku} |`,
).join("\n")}

### 6 Powder-Coat Finishes (real Hub SKUs — never use fictional \`PWD-BLK-MAT\`)

| Hub SKU | Display Name | Finish |
| --- | --- | --- |
${PHASE1_POWDERS.map((sku) => {
  const label = PHASE1_POWDER_DISPLAY_NAMES[sku] ?? sku;
  return `| \`${sku}\` | ${label} | Powder coat / ${label} |`;
}).join("\n")}

> Example APF values PrimeView may send: \`Ash (FAB-ACT-ASH)\`, \`Black (PWD-BLACK)\`, bare \`FAB-ACT-ASH\` / \`PWD-BLACK\`. Hub resolves all three forms. **Do not** send fictional SKUs like \`FAB-SUN-5453-CAN\` or \`PWD-BLK-MAT\`.

Fulfillment routing (Hub authority):

- **Make** (no \`third_party_sources\`): Katana Sales Order **+** Manufacturing Order when \`ORDER_PIPELINE_MODE=live\`
- **Resale / SO-only add-ons** (\`third_party_sources\` present): Katana Sales Order **only** (MO skipped)

Phase 1 launch gate uses \`ORDER_PIPELINE_MODE=log\` (dry-run saga, zero Katana writes) until smoke passes.

## 6. Joint Test-Order Checklist (\`ccpatiodev2\` → Hub)

- [ ] WP webhook URL = \`${PRODUCTION_WOO_WEBHOOK_URL}\`; secret = Hub \`WOOCOMMERCE_WEBHOOK_SECRET\`
- [ ] Katana WooCommerce plugin **disabled**
- [ ] NMI keys present in WP + Hub vault; test-mode charge succeeds
- [ ] Paid order fires \`order.updated\` with \`date_paid\` set
- [ ] Corner Sofa **Right-Side Facing** → line SKU ends in \`-RS\`
- [ ] Club Chair with \`ironwood=1\` + fabric/powder/frame → 202, zero quarantine
- [ ] \`ORDER_PIPELINE_MODE=log\` dry-run completes before staged \`live\` flip

---

*End of live Phase 1 handoff for Yardi / PrimeView. Generated from Hub Postgres — do not rely on static \`tmp/\` artifacts.*
`;
}

async function loadLivePortalOverlay(): Promise<{
  liveBySku: Map<
    string,
    {
      regularPrice: string | null;
      salePrice: string | null;
      weightLb: string | null;
      isWebVisible: boolean;
      collection: string;
      productName: string;
      options: string;
    }
  >;
  miaByCanonical: Map<string, { approved: boolean; approvedAt: string | null }>;
  miaApprovedCount: number;
  miaLatestApprovedAt: string | null;
}> {
  const db = getDb();
  const [listings, attrs, fgc] = await Promise.all([
    db
      .select({
        sku: ecommerce_listings.global_sku,
        productName: ecommerce_listings.product_name,
        collection: ecommerce_listings.collection_label,
        aluminum: ecommerce_listings.aluminum_msrp,
        sale: ecommerce_listings.sale_price,
        construction: ecommerce_listings.construction_details,
      })
      .from(ecommerce_listings),
    db
      .select({
        sku: sku_mappings.global_sku,
        attributes: sku_mappings.attributes,
      })
      .from(sku_mappings)
      .where(like(sku_mappings.global_sku, "FIN-%")),
    db
      .select({
        sku: finished_goods_catalog.global_sku,
        weight: finished_goods_catalog.weight,
        isWebVisible: finished_goods_catalog.is_web_visible,
      })
      .from(finished_goods_catalog),
  ]);

  const fgcBySku = new Map(fgc.map((r) => [r.sku, r]));
  const liveBySku = new Map<
    string,
    {
      regularPrice: string | null;
      salePrice: string | null;
      weightLb: string | null;
      isWebVisible: boolean;
      collection: string;
      productName: string;
      options: string;
    }
  >();
  for (const row of listings) {
    const hub = fgcBySku.get(row.sku);
    liveBySku.set(row.sku, {
      // Mia Aluminum PDF is the storefront Regular price authority — never steel_msrp.
      regularPrice: row.aluminum != null ? String(row.aluminum) : null,
      salePrice: row.sale != null ? String(row.sale) : null,
      weightLb: hub?.weight != null ? String(hub.weight) : null,
      isWebVisible: Boolean(hub?.isWebVisible ?? true),
      collection: row.collection || "",
      productName: row.productName || row.sku,
      options: row.construction?.trim() || "",
    });
  }

  const miaByCanonical = new Map<
    string,
    { approved: boolean; approvedAt: string | null }
  >();
  let miaApprovedCount = 0;
  let miaLatestApprovedAt: string | null = null;
  for (const row of attrs) {
    const mia = readMiaApproval(row.attributes as Record<string, unknown>);
    miaByCanonical.set(row.sku, mia);
    if (mia.approved) {
      miaApprovedCount += 1;
      if (
        mia.approvedAt &&
        (!miaLatestApprovedAt || mia.approvedAt > miaLatestApprovedAt)
      ) {
        miaLatestApprovedAt = mia.approvedAt;
      }
    }
  }

  return { liveBySku, miaByCanonical, miaApprovedCount, miaLatestApprovedAt };
}

function buildSwatchesManifest(
  fabricNames: ReadonlyArray<{ sku: string; name: string }>,
): FabricSwatchManifestEntry[] {
  const json = buildFabricSwatchesJson(fabricNames);
  const parsed = JSON.parse(json) as Array<{
    label: string;
    color: string;
    image_url: string;
    fabric_sku: string;
  }>;
  return parsed.map((p) => ({
    sku: p.fabric_sku,
    label: p.label,
    color: p.color,
    image_url: p.image_url || fabricSwatchPublicUrl(p.fabric_sku),
  }));
}

function buildStorefrontRows(
  handoff: HandoffLine[],
  liveBySku: Map<
    string,
    {
      regularPrice: string | null;
      salePrice: string | null;
      weightLb: string | null;
      isWebVisible: boolean;
      collection: string;
      productName: string;
      options: string;
    }
  >,
  miaByCanonical: Map<string, { approved: boolean; approvedAt: string | null }>,
): LiveStorefrontRow[] {
  return handoff.map((h) => {
    const live =
      liveBySku.get(h.wooSku) ??
      liveBySku.get(h.canonicalSku) ??
      null;
    const mia =
      miaByCanonical.get(h.canonicalSku) ??
      miaByCanonical.get(h.wooSku) ??
      { approved: false, approvedAt: null };
    const weightLb = live?.weightLb ? Number(live.weightLb) : Number(h.weightLb);
    const regular = money(live?.regularPrice ?? h.price);
    const sale = money(live?.salePrice ?? "");
    return {
      collection: live?.collection || h.parentName,
      productName: live?.productName || h.sowName,
      wooSku: h.wooSku,
      canonicalSku: h.canonicalSku,
      regularPrice: regular,
      salePrice: sale,
      weightLb: Number.isFinite(weightLb) ? weightLb.toFixed(2) : h.weightLb,
      shippingClass: Number.isFinite(weightLb)
        ? shippingClassFromLb(weightLb)
        : h.shipping,
      options: live?.options || h.attr1 || "",
      miaApproved: mia.approved,
      miaApprovedAt: mia.approvedAt,
      isWebVisible: live?.isWebVisible ?? true,
      parentId: h.parentId,
      fulfillment: h.fulfillment,
    };
  });
}

/**
 * Generate the full live handoff bundle (CSV + markdown + swatches + summary).
 * Does not re-upload fabric swatches; URLs point at already-hosted Supabase objects.
 */
export async function generateLiveHandoffBundle(): Promise<LiveHandoffBundle> {
  const generatedAtUtc = new Date().toISOString();
  const generatedAtMst = formatMst(generatedAtUtc);

  const [base, overlay, fabricRows] = await Promise.all([
    buildPhase1ImportBundle({ hostSwatches: false }),
    loadLivePortalOverlay(),
    getDb()
      .select({
        sku: sku_mappings.global_sku,
        name: sku_mappings.original_name,
      })
      .from(sku_mappings)
      .where(inArray(sku_mappings.global_sku, [...PHASE1_FABRICS])),
  ]);

  // Also resolve alias SKUs onto live overlay so -LS/-RS / -BAR rows inherit prices.
  const liveBySku = new Map(overlay.liveBySku);
  for (const h of base.handoff) {
    if (!liveBySku.has(h.wooSku) && liveBySku.has(h.canonicalSku)) {
      liveBySku.set(h.wooSku, liveBySku.get(h.canonicalSku)!);
    }
  }

  const overlaidRows = overlayLivePortalEdits(base.allRows, liveBySku);
  const csvText = rowsToCsvText(base.headers, overlaidRows);
  const storefrontRows = buildStorefrontRows(
    base.handoff,
    liveBySku,
    overlay.miaByCanonical,
  );
  const swatchesManifest = buildSwatchesManifest(fabricRows);

  // Count Mia approvals against unique SOW canonicals (max 102).
  const approvedSow = new Set(
    base.handoff
      .filter((h) => overlay.miaByCanonical.get(h.canonicalSku)?.approved)
      .map((h) => h.sowRow),
  );

  const handoffMarkdown = renderLiveHandoffMarkdown({
    generatedAtUtc,
    generatedAtMst,
    miaApprovedCount: approvedSow.size,
    miaLatestApprovedAt: overlay.miaLatestApprovedAt,
    variationCount: base.variationRows.length || PHASE1_VARIATION_COUNT,
    simpleCount:
      base.parentRows.filter((p) => p.Type === "simple").length ||
      PHASE1_SIMPLE_COUNT,
    uniquePurchasableSkus: base.uniqueSkus || PHASE1_PURCHASABLE_SKU_COUNT,
    parentCount: base.parentRows.length || PHASE1_PARENT_COUNT,
    sowItemCount: PHASE1_SOW_ITEM_COUNT,
    makeCount: base.makeCount,
    resaleCount: base.resaleCount,
    handoff: base.handoff,
    storefrontRows,
    swatchSampleUrls: swatchesManifest.map((s) => s.image_url),
  });

  return {
    generatedAtUtc,
    generatedAtMst,
    miaApprovedCount: approvedSow.size,
    miaLatestApprovedAt: overlay.miaLatestApprovedAt,
    parentCount: base.parentRows.length || PHASE1_PARENT_COUNT,
    variationCount: base.variationRows.length || PHASE1_VARIATION_COUNT,
    simpleCount:
      base.parentRows.filter((p) => p.Type === "simple").length ||
      PHASE1_SIMPLE_COUNT,
    uniquePurchasableSkus: base.uniqueSkus || PHASE1_PURCHASABLE_SKU_COUNT,
    sowItemCount: PHASE1_SOW_ITEM_COUNT,
    storefrontRows,
    handoffMarkdown,
    csvText,
    csvFilename: "primeview-phase1-102-import.csv",
    swatchesManifest,
    webhookUrl: PRODUCTION_WOO_WEBHOOK_URL,
  };
}

/** Pure helper for unit tests — render markdown from fixtures without DB. */
export function renderHandoffMarkdownForTest(
  partial: Parameters<typeof renderLiveHandoffMarkdown>[0],
): string {
  return renderLiveHandoffMarkdown(partial);
}

export type { Phase1ImportBundle, HandoffLine, CsvRow };
export { csvEscape, PRODUCTION_WOO_WEBHOOK_URL, PHASE1_RESALE_SKUS };
