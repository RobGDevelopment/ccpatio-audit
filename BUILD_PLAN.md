# BUILD_PLAN — `intake-media-certification-studio`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 31 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/intake-media-certification-studio.test.ts`

## Intent

Upgrade `/embed/admin/master-catalog` into a clean **4-tab certification pipeline** so Mia can visually inspect, crop-verify, classify, enrich, and certify every finish swatch and every product image / render / video / 3D asset **before** it enters certified storefront lists or pushes to WooCommerce:

1. **Tab 1 — Intake & Media Studio** (new default)
2. **Tab 2 — Certified Finishes & Add-Ons**
3. **Tab 3 — Certified Products**
4. **Tab 4 — WooCommerce Sync & Handoff**

Fix two CV bugs in `swatch-cv-pipeline.ts`, pre-stage all **27** raw studio shoot photos into Tab 1 (uncropped reference + hardware-safe squares), ship interactive browser re-cropper + direct-to-Supabase signed uploads (renders / MP4 / GLB / PDF), Katana-safe auto-SKU bind + cloud file rename on **Approve & Promote**, restore **102/102** Mia-approved SOW parity, and enforce a **Certified-only** Woo gate.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`). Keep all staging media in `C:\Workspace\ccpatio-media-staging\` (outside git). Never overwrite existing Mia-edited `display_name` values on already-customized rows. Schema changes are **strictly additive** (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — zero drops), applied cleanly to Supabase **before** `qa:lifecycle`.

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `drizzle/`, `scripts/`, `src/db/`, `src/app/embed/`, `src/app/api/`, `src/app/partner/primeview-handoff/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Workstreams

### 1. Fix Two CV Bugs + Pre-Stage All 27 Raw Studio Photos

**Files:** `scripts/ops/lib/swatch-cv-pipeline.ts`, `scripts/ops/`, `drizzle/`, `src/db/`, `src/server/db/`, `package.json` (script wiring only if under allowed `scripts/` flow — prefer `scripts/` package script entry via existing ops pattern)

**Staging inventory** (`C:\Workspace\ccpatio-media-staging\HighRezImages\` — outside git):

| Folder | Count | Notes |
|--------|------:|-------|
| `Fabrics/` | 16 | Mixes Sunbrella **and** Ultraleather; bold B/W stripes `PV205022.JPG`, blue/white stripes `PV205037.JPG`, shibori `PV205012.JPG`; two metal grommets along top ~18% |
| `Dekton/` | 6 | Bottom stand clips/ledge; fix typo `DKT-EDORA` → `DKT-ENTZO` |
| `PowderCoat/` | 5 | Metal Q-panels below top horizontal tape; circular punched hole near left **or** right end |

#### Bug A — `buildValidMask` punching holes inside dark stripes/patterns

Stop per-pixel `dBg` invalidation inside the sample interior. Compute outer sample bbox `[sampleLeft, sampleTop, sampleRight, sampleBottom]` clear of right/top tape, then enforce hardware-safe interior bounds:

- **`Fabrics/` (16):** Crop strictly below grommet band (`y >= sampleTop + 0.22 * sampleH`); inset `7%` from left/right/bottom. `PV205022`, `PV205037`, `PV205012` **must** extract full multi-band pattern squares.
- **`Dekton/` (6):** Crop strictly above bottom stand clips/ledge (`y <= sampleBottom - 0.12 * sampleH`); inset `6%` from top/left/right slab edges.
- **`PowderCoat/` (5):** Plate rect below `tapeBottom + 6%`; detect punched hole in left-third vs right-third; exclude hole zone; largest centered square from solid metal face.

#### Bug B — Remove `forceBorderNearCenter` flat rim smear

- Delete `forceBorderNearCenter` (`keep = 0` was painting a flat solid-color ~46px frame).
- Rely on `flattenIllumination` for grain-preserving vignette correction.
- Skip `seamlessToroidalWrap` when `is_striped || bimodal` or `patternMode === "striped"` so stripes never smear grey at tile edges.

#### Upload & seed 27 Intake cards

- Additive DDL for `finish_intake` (and any product-intake sibling columns) via `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` only; apply to Supabase before lifecycle.
- Idempotent `npm run intake:seed-photoshoot -- --apply` uploads **both**:
  1. **Uncropped Original Reference** → `intake/raw/{folder}/{file}-orig.jpg` (max `1400px`, full aspect, tape + grommets visible for Mia ID)
  2. Hardware-safe **`2048×2048` + `512×512`** squares with normalized `{ x, y, side }` crop coords in `0..1` source space
- Create/update **27** `finish_intake` rows ready for Tab 1.

### 2. Tab 1 — Intake & Media Studio (Finishes + Product Renders / MP4 / 3D)

**Files:** `src/app/embed/`, `src/app/api/ecommerce/`, `src/components/`, `src/server/`, `src/lib/`

- Full-width dark workspace; default portal tab = `intake`.
- Sub-queues: `All Pending Intake` | `Photoshoot Finishes (27)` | `Products Needing Media / Dims` | `Recently Certified`.
- Portal tabs rename: `intake` | `finishes` | `products` | `sync` with labels **Intake & Media Studio** / **Certified Finishes & Add-Ons** / **Certified Products** / **WooCommerce Sync & Handoff**.

#### Signed upload pipeline (zero Vercel 4.5MB 413)

- `/api/ecommerce/intake-upload-sign` — `supabaseAdmin.storage.from(bucket).createSignedUploadUrl(...)`
- `/api/ecommerce/intake-upload-commit` — persist after client PUT
- Client Web Crypto `SHA-256` + real upload progress bars
- Multi-file DnD accept: finish swatches (jpg/png/webp), product studio + lifestyle renders (jpg/png/webp), videos (mp4/webm on Supabase CDN + optional YouTube/Vimeo URL), 3D (glb/usdz), PDF spec/tear sheets

#### Mode A — Finish / Swatch card + interactive re-cropper

- **Left:** Side-by-side Uncropped Original (draggable/resizable 1:1 crop overlay `{ cropX, cropY, cropSide }`) beside Full-Bleed Square Thumb + `2048px` Loupe + `3×3` Tile Preview. `Apply Crop` / `Approve & Promote` re-crops high-res via `sharp` + illumination flatten → fresh 2048 + 512 JPEGs.
- **Right (required before promote):**
  1. Material Class: Sunbrella Fabric | Ultraleather | Dekton Stone | Aluminum Powder Coat | Storefront Add-On → auto APF Target Group (`Cushion & Pillow` | `Dekton Tabletop` | `Aluminum Frame`) + default UV Scale `8` / `6` / `24` / `4`
  2. Storefront Display Name (required)
  3. Vendor / Mill SKU + Material Description / Grade
  4. Pattern Mode (`Solid / Textured` vs `Striped / Patterned`) + Repeat W″ × H″
  5. Live Katana / Canonical SKU Preview: search Hub/Katana (`FAB-*`, `DKT-*`, `STN-DKT-*`, `PWD-*`); bind existing (preserve inventory/BOM; bridge `DKT-*` ↔ `STN-DKT-*` so showroom Dekton Slabs **and** Fabrics cards get the approved square) **or** mint deterministic canonical SKU from Display Name + `sku_aliases` placeholder

#### Mode B — Product media / render / video / readiness

- Pre-populate `Products Needing Media / Dims` with the **6 Missing Dims** SKUs (Kindle heaters/lamps + Tropics pool).
- Keep **all 102** Mia-approved SOW products active in Tab 3 — restore `102 / 102` if regressed to `91 / 102`.
- Every Tab 3 row: 1-click `+ Stage Renders / Video / 3D`; support staging `+ New Product`.
- **Left:** Multi-image gallery (`Hero Primary`, `Studio Angle`, `Lifestyle Render` reorder/remove); HTML5 `<video controls loop muted playsInline>` for CDN mp4/webm; glb/usdz + Material Slots (**`table_top` only on Tables** — never Sofas/Chairs).
- **Right Storefront Gate:** Searchable Visual Product Combobox (`Storefront Title — FIN-*`), Title-Cased Display Title, Customer Description, Aluminum MSRP, Surface Profile, Freight Weight + Boxed L×W×H (warn if dims exceed `90″ × 40″ × 45″` LTL envelope).

### 3. Approve & Promote Engine — Cloud Rename + Propagation + Local Pull CLI

**Files:** `src/server/`, `src/app/embed/`, `src/app/api/`, `scripts/ops/`

On **`Approve & Promote to Certified`**:

1. Validate required fields + `2048×2048` (finishes) or product readiness gates.
2. Rename/copy cloud files to canonical slugs:
   - Finishes: `finishes/{CANONICAL_SKU}/{CANONICAL_SKU}-{kebab-display-name}-2048.jpg` + `-512.jpg` (`?v=<sha8>`; record `raw_source_file` provenance).
   - Products: `products/{CANONICAL_SKU}/{CANONICAL_SKU}-hero.{ext}`, `-render-01.{ext}`, `-video-01.mp4`, `{CANONICAL_SKU}.glb` (Tab 3, Dark Product Drawer, Woo exports all read gallery / renders / CDN video / 3D).
3. Lock canonical SKU; set `miaApproved = true` (`certified_at`, `certified_by`); move out of Pending Intake into Tab 2 or Tab 3; sync matching `FAB-*` / `STN-DKT-*` thumbs onto `/embed/showroom` Current Inventory.

- Add `npm run finishes:pull-approved` → download all Mia-approved renamed files + manifest into `C:\Workspace\ccpatio-media-staging\approved\`.
- **Hard rule:** never overwrite Mia-edited `display_name` on already-customized rows (seed/upsert/promote only fill empty or stale-canonical names).

### 4. Zero-Shortcut Cleanup Across Tabs 2–4 + Certified-Only Woo Gate

**Files:** `src/app/embed/`, `src/server/ecommerce/`, `src/server/woocommerce/`, `src/app/api/`, `src/app/partner/primeview-handoff/`

#### Tab 2 — Certified Finishes & Add-Ons

- Update live DB rows (not seed-only): `PWD-FANUC-GRAY` → **Gray**, `PWD-LITE-BEIGE` → **Beige**, `PWD-OIL-RUB-BRONZE` → **Bronze** — **only if** Mia has not already customized; keep factory name in subtitle.
- `Enter`-to-save + visible inline **Save** when dirty (`Saving…` → `Saved ✓`).
- Replace `"e.g. Canvas Ivory"` placeholders with category-aware `+ Stage in Intake Studio` triggers.
- Eliminate **every** remaining stark-white `bg-white` upload button across Tabs 1, 2, and 4 (dark slate/amber everywhere).

#### Tab 3 — Certified Products & Dark Drawer

- Title Case Storefront Display Title in rows **and** Dark Drawer (preserve `BH`, `SH`, `OD`, `LED`, `II`, `III`; factory ALL-CAPS as read-only reference only).
- Accurate variation badges: `Simple` | `Parent · 2 Vars (-LS / -RS)` | `Left-Side Facing (-LS)` | `Right-Side Facing (-RS)`.
- Drawer: gallery/render thumbs + video/3D badges; clean `View on Staging` when slug/URL exists.
- Header operator badge: `Rob · Mia · Kian · Executive`.
- Restore **102 / 102** Mia Approved SOW count.

#### Tab 4 — WooCommerce Sync & Handoff (hard certification gate)

- Replace plain `<input>` with searchable Combobox (products & finishes by Title or SKU).
- Woo connection badge synced to live Stack Health probe — never Green `Connected` when `ccpatiodev2.primeview.com` returns HTTP 500 / HTML critical error.
- **Hard Gate:** `Push Swatches & Scales to Staging`, `Push Certified Catalog to Staging`, Woo Dry-Run JSON, and PrimeView CSV/JSON exports include **only Certified** finishes/products (never unapproved Intake). Include gallery/render arrays + Supabase CDN mp4 meta (`_ccpatio_product_video_url` / gallery video) when present; preserve WP images when Hub gallery empty.
- Read env flags only — leave `*_MODE` / `DOWNSTREAM_MUTATIONS` at `log` / `false`.

### 5. Verification

**Files:** `tests/`, `e2e/`, `.cursor/aar.json`, `.cursor/phase.lock`

`tests/intake-media-certification-studio.test.ts` (+ Playwright) must prove:

1. CV extracts real multi-band stripes from `PV205022.JPG` & `PV205037.JPG` (below grommets); no `forceBorderNearCenter`; all **27** Tab 1 cards have `rawReferenceUrl` + cropped `2048px` preview.
2. Interactive re-crop + Approve & Promote re-crops via `sharp`, binds existing Hub/Katana SKU (incl. `DKT-*` ↔ `STN-DKT-*`) or mints deterministic SKU from Display Name, renames Storage to `{SKU}-{slug}-2048.jpg`, promotes into Tab 2.
3. Signed upload signs `.webp` / `.mp4` / `.glb`; approved product media renders `<video>` + gallery and flows into Woo Dry-Run JSON; unapproved Intake excluded from staging push/exports.
4. Zero `bg-white` upload buttons; `102 / 102` Mia Approved intact; Title Case in Tab 3 + Drawer; Tab 4 searchable combobox + accurate Woo probe status.

Then:

- Target Vitest + `npm run qa:lifecycle` → exit 0
- Sync `expected_blast_radius` (tolerance 0, exclude `.cursor/aar.json`)
- `node .cursor/skills/aar/scripts/emit.mjs`
- `node .cursor/skills/qca/scripts/qca.mjs` → `CERTIFIED` (`audit_exit: 0`); paste verbatim QCA JSON

## Guardrails

- Keep outbound `*_MODE` / `DOWNSTREAM_MUTATIONS` at `log` / `false` — never edit `.env*` to flip them.
- Staging media stays outside git (`C:\Workspace\ccpatio-media-staging\`); approved pulls land in `...\approved\`.
- Additive schema only; apply to Supabase before lifecycle. No `drizzle-kit push`, no drops, no wipes.
- Never overwrite Mia-edited `display_name` on customized rows.
- Never delete a paid order; ledger failures retry, not rollback.
- Katana is a single live tenant — auto-SKU bind is hub-side / log-mode safe (no live catalog mutations while flags are `log` / `false`).
- Edits stay inside `phase.lock` `allowed_files` (Track 2).
