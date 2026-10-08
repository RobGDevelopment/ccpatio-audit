# PIM God Mode Drawer — Master Architectural Blueprint

**Phase id:** `step-4-blueprint-generation`  
**Status:** Blueprint only. No application code changes in this phase.  
**Allowed files:** `.cursor/phase.lock`, `PIM_GOD_MODE_DRAWER_BUILD_PLAN.md`  
**Expected blast radius:** 2  
**Target test:** `npm run typecheck`  
**Stack (grounded):** Next.js 16.3.2 App Router, Drizzle ORM, Supabase SSR, Tailwind 4. Matches `package.json` and `PROJECT_STATE.md`.  
**Binding architecture:** `docs/MDM_MASTER_BLUEPRINT.md`. Do not implement the V8 transactional bus.

Antigravity executes the four phases below in order. This document is the execution map. It does not authorize channel writes, SKU renames, or logistics-profile inserts.

---

## Context & Philosophy

CC Patio middleware is the Master Data Management hub. GoHighLevel is the single pane of glass — the Command Center — for the executive team. The middleware is the bi-directional traffic cop and the firewall between the factory and every sellable channel.

A factory edit in Katana (wrong SKU, wrong dimension) can cascade into WooCommerce, Clover POS, and QuickBooks Online. The PIM God Mode Drawer is the UI of that firewall. It holds the Golden Record for canonical `FIN-` SKUs. It lives inside the GHL embed at `/embed/admin/master-catalog`. Once a hub row exists, the canonical SKU is locked. No downstream channel may override `sku_mappings.global_sku`.

Two identities share one drawer:

| Identity | Drizzle export | Postgres table | Owns |
| --- | --- | --- | --- |
| Listing | `ecommerce_listings` | `ecommerce_listings` | Product name, collection label, drawing section, steel MSRP, aluminum MSRP, legacy base SKU, marketing HTML |
| Hub (Golden Record) | `sku_mappings` + `finished_goods_catalog` | `sku_mappings`, `finished_goods_catalog` | Canonical `global_sku` (PK), dimensions, image, SEO, `is_web_visible`, local cost |
| Logistics (read-mostly) | `logistics_profiles` | `logistics_profiles` | Katana-keyed freight. `weight_lb` and `ltl_class` only when the row already exists |

`sku_mappings.global_sku` is the primary key. `finished_goods_catalog.global_sku`, `ecommerce_listings.global_sku`, `product_bom.parent_sku`, `cad_uploads`, `channel_sync.global_sku`, and `product_relations.from_sku` / `to_sku` all hang off it. `origin_check` on `sku_mappings` requires manufactured rows to match `FIN-%`.

A grid row is one `ecommerce_listings` record. Several listings may share one hub SKU (`canonical_sku_shared`). Listing saves touch that one row. Hub saves apply to every listing on that SKU. The drawer must say so before a hub edit, using the existing copy in `ProductDrawer`: "Shared by multiple listings. Hub edits apply to all of them."

Channel identifiers stay visible and read-only on the hub row: `sku_mappings.katana_variant_id`, `woo_product_id`, `clover_item_id`, `qbo_item_id`. This drawer never calls Katana, WooCommerce, Clover, QuickBooks, or GHL write APIs.

### Surfaces already in the tree

| Role | Path |
| --- | --- |
| Catalog page (client) | `src/app/embed/admin/master-catalog/page.tsx` |
| Roster grid and `?listing=` reader | `src/app/embed/admin/master-catalog/ecommerce/EcommerceGrid.tsx` |
| Existing-product drawer | `src/app/embed/admin/master-catalog/ecommerce/ProductDrawer.tsx` |
| New-product drawer and live SKU preview | `src/app/embed/admin/master-catalog/ecommerce/NewProductDrawer.tsx` |
| Story / SEO / asset tabs | `src/app/embed/admin/master-catalog/ecommerce/ListingContentPanels.tsx` |
| Freight tab (today writes the wrong table — see Phase 4) | `src/app/embed/admin/master-catalog/ecommerce/FreightPanel.tsx` |
| Server actions | `src/app/embed/admin/master-catalog/actions.ts` |
| SKU preview | `src/server/master-catalog/sku-preview.ts` (`previewSku`) |
| Gap mint (local tables only) | `src/server/master-catalog/mint-hub-sku.ts` (`mintHubSkuInTx`) |
| HTML allowlist | `src/server/pim/html-sanitize.ts` (`ALLOWED_STORY_TAGS`, `normalizeStoryInput`) |
| Drizzle schema | `src/server/db/schema.ts` |
| Nomenclature dictionaries | `nomenclature_collections`, `nomenclature_categories`, `nomenclature_sku_tokens` |
| Successor relation (schema only) | `product_relations.role = 'successor'` |

### Floating card aesthetic to keep

The catalog shell is a floating glass card, not a flat admin table:

- Page panels: `bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.06)]` in `page.tsx`.
- E-commerce grid: `rounded-2xl border border-slate-100 bg-white/90 backdrop-blur shadow-[0_8px_30px_rgb(0,0,0,0.04)]` in `EcommerceGrid.tsx`.
- Drawer: right-edge overlay, `bg-slate-900/30 backdrop-blur-sm`, panel `max-w-2xl bg-white shadow-2xl`, slide-in from the right (`ProductDrawer.tsx`).

New drawer sections stay inside that language. Do not introduce a second visual system.

### Hard rules for every phase

- Zero outbound channel API calls. No Katana, Woo, Clover, QuickBooks, or GHL mutations from drawer saves, preview, mint, or successor creation.
- Never `UPDATE` `sku_mappings.global_sku`. Never call the dictionary rename in `src/app/admin/dictionary/actions.ts`.
- Optimistic lock: listing writes compare `ecommerce_listings.version`; hub writes compare `sku_mappings.version`. Mismatch throws `This product was saved by someone else. Reload.` and writes nothing.
- After a successful local write, `revalidatePath("/embed/admin/master-catalog")`.
- `previewSku` is a read. It must not insert.

---

## Phase 1: `pim-drawer-identity` (The Identity Layer)

**Goal:** Show the Golden Record SKU before it exists, then freeze it forever.

### Dynamic SKU preview (before first save)

Entry: `+ Add New Product` opens `NewProductDrawer`. Preview runs through `previewSkuAction` → `previewSku` in `src/server/master-catalog/sku-preview.ts`.

Manufactured pattern, before any insert:

```text
FIN-{collection code}-{category code}-{L}X{W}
```

- `{collection code}` and `{category code}` come from active rows in `nomenclature_collections` and `nomenclature_categories`. Labels must match the dictionary label or an alias (`validateSubmittedLabel`). Free text is rejected.
- `{L}` is length in whole inches. `{W}` is the second dimension, stored as `finished_goods_catalog.depth` (the preview function names this argument `depth`). Format is `{length}X{depth}` via `formatSize`. Height is stored later and is not part of the SKU.
- Reserved codes `FIN`, `FAB`, `MIS`, `RM`, `PWD`, `3P` are rejected.
- If `sku_mappings.global_sku` already holds that string, `preview.isCollision` is true. Save is blocked. The drawer names `existingProductName`.
- Nothing is written until the operator saves. `createNewProduct` re-runs `previewSku` inside the request and mints `sku_mappings`, `finished_goods_catalog`, and one `ecommerce_listings` row in one transaction. Reuse `mintHubSkuInTx` rules: local hub tables only.

UI already renders the preview in `NewProductDrawer` (`font-mono`, collision badge, "This SKU is permanent upon creation."). Keep that line.

### Canonical lock (hub row already exists)

When `previewSku` is called with `existingGlobalSku`, it returns `{ sku: existingGlobalSku, isSaved: true }` and does not regenerate.

`ProductDrawer` opens an existing listing. Header shows `listing.globalSku` from `sku_mappings`. Collection, category, and dimension edits may change human labels and `finished_goods_catalog` dimension columns. They must not recompute or rewrite `global_sku`.

Required operator copy once the hub row exists: **This SKU is permanent.**

`EcommerceListing.canonicalSkuShared` (column `ecommerce_listings.canonical_sku_shared`) gates the shared-hub warning.

### URL reopening via `?listing=<id>`

`EcommerceGrid` already reads the query:

```ts
const activeDrawerId = searchParams.get("listing");
```

(`useSearchParams` from `next/navigation`). Clicking the product name must `router.replace` the master-catalog URL with `?listing={ecommerce_listings.id}` so a refresh inside the GHL embed reopens the same drawer. Close clears the param.

`page.tsx` is a client component and renders `EcommerceGrid` with no `<Suspense>` boundary. Next.js 16 requires `useSearchParams()` under `<Suspense>`. Wrap the grid (or a dedicated search-param reader that owns the drawer) in `<Suspense>` in `src/app/embed/admin/master-catalog/page.tsx`. Fallback: the existing glass-card shell with a non-blocking loading state. Do not read `searchParams` in a server page that opts the embed into dynamic rendering without that boundary.

`?hubOnly=<global_sku>` is a separate path in `EcommerceGrid` (`getHubProductForDrawer`). Identity deep-link for this phase is `?listing=` only.

### Zero outbound channel API calls

`createNewProduct`, `previewSku`, and `mintHubSkuInTx` stay inside Drizzle transactions on `sku_mappings`, `finished_goods_catalog`, and `ecommerce_listings`. Do not import Katana, Woo, Clover, or QBO clients into this phase. Do not set `sync_to_woo` or `sync_to_clover` as a side effect of minting. New rows appear with a null steel price (em dash in the grid) and no channel ids.

---

## Phase 2: `pim-drawer-listing` (The Listing Layer)

**Goal:** Marketing and price fields for one roster row. No hub SKU mutation.

### Write boundary

All listing saves go to **`ecommerce_listings`** only (`export const ecommerce_listings` in `src/server/db/schema.ts`).

Existing action: `updateListingInDrawer(id, expectedVersion, payload)` in `src/app/embed/admin/master-catalog/actions.ts`. Story HTML uses `saveListingStory`. Both bump `ecommerce_listings.version`.

Do not update `sku_mappings.global_sku`. Do not call channel APIs.

`updateListingInDrawer` currently mirrors a sole listing's steel price onto `finished_goods_catalog.msrp`. That mirror is a hub write. This phase stops it. Steel MSRP stays on `ecommerce_listings.steel_msrp`. Hub MSRP is out of this phase.

### Fields (exact columns)

| UI label | Column | Notes |
| --- | --- | --- |
| Product Name | `product_name` | `notNull`. Unique index `ecommerce_listings_product_name_uidx`. Not in `updateListingInDrawer` today — add it to the listing payload. |
| Collection Label | `collection_label` | `notNull`. Human label. Changing it does not change `global_sku`. |
| Drawing Section | `drawing_section` | `notNull`. Workbook product-type facet. Not in `updateListingInDrawer` today — add it. Grid filters already read `drawingSection` in `EcommerceFilters.tsx`. |
| Steel MSRP | `steel_msrp` | `numeric(10,2)`. Grid column. Null displays as an em dash. |
| Aluminum MSRP | `aluminum_msrp` | `numeric(10,2)`. |
| Legacy Base SKU | `legacy_base_sku` | Normalize with `normalizeLegacySku` from `src/lib/ecommerce-roster.ts`. Set `legacy_operator_set` when an operator saves a value. Recompute `legacy_sku_shared` via `sharedLegacyPatches`. |

`ListingDrawerPayload` in `ProductDrawer.tsx` must grow `productName` and `drawingSection` so the Details tab can save them. Product URL (`product_url`) may remain as it is today; it is not a Phase 2 required field.

### Sanitized marketing HTML

Column: `ecommerce_listings.marketing_description`. Construction copy (`construction_details`) uses the same sanitizer if the Story tab stays.

Server allowlist is already implemented. Do not widen it.

- Module: `src/server/pim/html-sanitize.ts`
- Constant: `ALLOWED_STORY_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a"]`
- Attributes: `a` may carry `href` (`http` or `https` only) plus `rel="noopener noreferrer"` injected by `transformTags`. No `style`, `class`, `src`, or event handlers.
- Save path: `normalizeStoryInput` then `saveListingStory`. Plain text (no tags) becomes `<p>` / `<br>` and is still sanitized.
- Render path: `SafeHtml` in `src/app/embed/admin/master-catalog/ecommerce/SafeHtml.tsx` and `EcommerceExpandedRow.tsx`. Grid excerpts stay plain text via `storyHtmlToPlainText`.

Reject or discard any tag outside the allowlist. Do not store the raw operator string.

---

## Phase 3: `pim-drawer-hub` (The Core Hub Layer)

**Goal:** Edit the Golden Record around a frozen SKU. A new shape is a new row.

### Write boundary

Hub saves write only:

- `sku_mappings` — local cost and concurrency (`base_cost`, `version`, `updated_at`, `updated_by`). Do not write `global_sku`, `katana_variant_id`, `woo_product_id`, `clover_item_id`, `qbo_item_id`, `sync_to_woo`, or `sync_to_clover` in this phase.
- `finished_goods_catalog` — dimensions, image, SEO, visibility, catalog cost.

Existing action: `updateHubInDrawer` in `actions.ts`. It already accepts dimension, image, SEO, `isWebVisible`, `baseCost`, and `cost`, and it locks on `sku_mappings.version`. Narrow it so this phase cannot flip channel sync flags or publish.

`product_assets` (`kind` includes `primary_image` and `gallery`) is the image-assignment table. Primary URL remains `finished_goods_catalog.image_url`. A hub SKU must exist before any asset row. Do not add a second CAD pipeline; `.dae` / `.skp` stay on `cad_uploads`.

### Fields (exact columns)

| UI label | Table.column | Notes |
| --- | --- | --- |
| Length | `finished_goods_catalog.length` | Text inches. Not part of a saved SKU. |
| Depth (second dimension / `{W}`) | `finished_goods_catalog.depth` | |
| Height | `finished_goods_catalog.height` | Stored. Excluded from the SKU pattern. |
| Arm height | `finished_goods_catalog.arm_height` | May be listed in `na_fields`. |
| Sit height | `finished_goods_catalog.sit_height` | May be listed in `na_fields`. |
| Catalog weight | `finished_goods_catalog.weight` | Display weight. Freight weight is Phase 4 (`logistics_profiles.weight_lb`). |
| Image assignment | `finished_goods_catalog.image_url` and `product_assets` | Executive-owned URL. Seeders must not clobber a saved URL. |
| SEO title | `finished_goods_catalog.seo_title` | Hub column. Listing SEO columns (`ecommerce_listings.seo_title`) are a separate surface; this phase writes the catalog columns. |
| SEO description | `finished_goods_catalog.seo_description` | |
| Slug | `finished_goods_catalog.slug` | |
| Web visibility | `finished_goods_catalog.is_web_visible` | Boolean, default false. |
| Local cost | `sku_mappings.base_cost` `numeric(12,4)` and `finished_goods_catalog.cost` | Both are local. |

### Local cost warning

The cost control must show this exact warning beside the field:

**Cost not synced to QuickBooks.**

`base_cost` and `cost` are hub-local numbers. Saving them must not refresh `qbo_auth_tokens`, must not call the QuickBooks item API, and must not write `qbo_item_id` or `finished_goods_catalog.qbo_item_code`.

### Successor SKU generation

A dimension or nomenclature change that should be a different product does not rename the current key.

Successor flow:

1. Run `previewSku` with no `existingGlobalSku` to build the new `FIN-{collection}-{category}-{L}X{W}`.
2. If that SKU collides, block. Name the existing product.
3. In one transaction, insert a **new** `sku_mappings` row, a **new** `finished_goods_catalog` row, and a **new** `ecommerce_listings` row copied from the source listing (name, labels, prices, marketing HTML, dimensions, image, SEO, visibility, local cost).
4. Insert `product_relations` with `role = 'successor'`, `from_sku` = old `global_sku`, `to_sku` = new `global_sku`. Unique index: `product_relations_unq` on `(from_sku, to_sku, role)`.
5. Leave the old listing and old `global_sku` in place. No `sku_aliases` row. No Katana rename. No dictionary rename.

The old header still says **This SKU is permanent.**

---

## Phase 4: `pim-drawer-logistics-readonly` (The Logistics Layer)

**Goal:** Show channel identity. Edit freight weight and class only when Katana already owns the variant.

### Read-only channel ids

Render these from the hub row. Inputs are disabled. Saves must not include them.

| UI label | Column |
| --- | --- |
| Katana Variant ID | `sku_mappings.katana_variant_id` (`integer`, nullable) |
| Woo ID | `sku_mappings.woo_product_id` (`varchar(255)`) |
| Clover ID | `sku_mappings.clover_item_id` (`varchar(255)`) |
| QBO ID | `sku_mappings.qbo_item_id` (`varchar(255)`) |

`getEcommerceRoster` already selects these (`actions.ts`). Thread them through `EcommerceListing` into `ProductDrawer` / `FreightPanel`. Empty values display as an em dash.

`finished_goods_catalog.qbo_item_code` and `sku_mappings.qbo_accounts` stay unread-only as well if shown. This phase does not edit them.

### Editable freight, only when the profile exists

Table: **`logistics_profiles`** (`src/server/db/schema.ts`).

| Column | Rule |
| --- | --- |
| `weight_lb` | `numeric(12,4)`. Editable only when a row exists. Check `logistics_profiles_dims_positive`: null or `> 0`. |
| `ltl_class` | `varchar(8)`. Editable only when a row exists. Check `logistics_profiles_ltl_class_known`: null or one of `50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500`. |

Lookup: `logistics_profiles.variant_sku = sku_mappings.global_sku` (both unique). Also require `logistics_profiles.katana_variant_id` to equal `sku_mappings.katana_variant_id`.

If no `logistics_profiles` row exists, `weight_lb` and `ltl_class` are read-only (or hidden) and the UI explains that freight waits on a Katana variant. Catalog display weight remains `finished_goods_catalog.weight` from Phase 3. Do not copy it into `logistics_profiles` automatically.

### Strict block: no insert without a Katana variant id

`logistics_profiles.katana_variant_id` is `notNull` and unique. **Do not insert a `logistics_profiles` row unless `sku_mappings.katana_variant_id` is already a non-null integer.**

A missing variant is a hard error, not a null insert:

```text
Cannot create a logistics profile without an established Katana variant ID.
```

No Katana API call to obtain that id. If the column is null, the drawer stops.

### Do not reuse the current freight upsert

`FreightPanel` today calls `getFreightProfile` / `saveFreightProfile`, which read and **upsert** `catalog_ship_profiles` (DFM ship mode, packaged dims, dim weight). That upsert inserts a row with no Katana variant. Phase 4 must not extend that upsert.

- `catalog_ship_profiles` stays the quoting/DFM table. This phase does not add inserts there either.
- New read: select `logistics_profiles` by `variant_sku`.
- New write: `UPDATE logistics_profiles SET weight_lb, ltl_class, updated_at` only when the row exists and `katana_variant_id` is not null.
- `INSERT INTO logistics_profiles` is forbidden in drawer code.

---

## Execution order for Antigravity

1. `pim-drawer-identity` — preview, lock copy, `<Suspense>` around `?listing=`, no channel calls.
2. `pim-drawer-listing` — `ecommerce_listings` fields plus `normalizeStoryInput` allowlist.
3. `pim-drawer-hub` — `sku_mappings` / `finished_goods_catalog` fields, cost warning, successor insert via `product_relations`.
4. `pim-drawer-logistics-readonly` — read-only channel ids; update `logistics_profiles.weight_lb` and `ltl_class` only; refuse insert without `katana_variant_id`.

Each later phase keeps the previous phase's locks. A listing save never rewrites a hub SKU. A hub save never calls a channel. A logistics save never creates a profile to fill a gap.

## Out of scope

- Dictionary rename and `sku_aliases` writes.
- Woo, Katana, Clover, QuickBooks, or GHL writes, including token refresh and journal entries.
- V8 transactional bus.
- Deleting channel products.
- Turning on `sync_to_woo` or `sync_to_clover`.
- Inserting `logistics_profiles` or `catalog_ship_profiles` from the drawer.
- Replacing ghost editors, factory pills, or the four factory states on the grid.
