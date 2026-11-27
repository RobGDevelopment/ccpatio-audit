# BUILD_PLAN — `katana-sync-meta-ssot-and-catalog-truth`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 26 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/katana-ssot-and-catalog-truth.test.ts`

## Intent

Unify E-Commerce, Current Inventory (`/embed/showroom`), and Katana variant bindings onto **one canonical SKU / Title / High-Res Image SSOT** with zero duplicates; fix the split `katana_sync_meta` watermark and stuck `"Updating..."` spinner; fix FedEx LTL / WooCommerce / KPI routing / Title Case / bogus `-LS/-RS` variation bugs; and upgrade the PrimeView Diagnostic Report generator to a formal 5-section enterprise report.

Live production walkthroughs of `/embed/admin/master-catalog` and `/embed/showroom` (`Current Inventory`) exposed split data silos and UI regressions that must be resolved cleanly with **ZERO shortcuts**.

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `scripts/`, `src/db/`, `src/app/embed/`, `src/app/showroom/`, `src/app/api/`, `src/app/partner/primeview-handoff/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Live production guardrails

| Guard | Rule |
|-------|------|
| Mia Tab 1 photoshoot | **DO NOT** overwrite or reset `finish_intake` photoshoot rows |
| Mia display names | **DO NOT** overwrite any `display_name` Mia has already manually customized |
| Outbound modes | Leave all `*_MODE` and `DOWNSTREAM_MUTATIONS` env flags strictly untouched (`log` / `false`) |
| Katana writes | Staging / summary only while `DOWNSTREAM_MUTATIONS=false` — never create duplicate Katana items; any rename is strictly `PATCH` in-place by `katana_variant_id` and held until mutations are enabled |
| Schema | Additive only if needed; never `drizzle-kit push` / drops / wipes / paid-order deletes |
| Tests | Isolated fixtures / `QA-TEST-*` only; no seed/reset that mutates live Mia certification rows |

## Workstreams

### 1. Stack-Wide SSOT — E-Commerce ↔ Current Inventory ↔ Katana MRP (Zero Duplicates)

**Files (expected):**  
`src/server/ecommerce/ecommerce-32-finish-roster.ts`, `src/server/assets/finish-assets.ts`, `src/server/ecommerce/finish-intake.ts`, `src/server/katana/catalog-reconcile.ts`, `src/lib/hub-katana-sync.ts`, `src/server/stock/showroom-snapshot.ts`, showroom embed/API under `src/app/embed/showroom/` + `src/app/api/`, `src/app/embed/admin/master-catalog/actions.ts`, `ExecutiveStackHealthStrip.tsx`, `EcommerceCertificationPortal.tsx`, ops/scripts under `scripts/` for one-shot dedupe/alias bridge (if required)

#### 1a. Reconcile & Deduplicate Finishes + Catalog Against 617 Synced Katana Items

- Audit `ecommerce_finishes` / `ecommerce_finish_assets` and `master_catalog` (~107 E-Commerce products) against synced Katana inventory/variant rows (`FAB-*`, `STN-DKT-*` / `DKT-*`, `PWD-*`, `FIN-*`, `RTL-*`).
- **Powder Coats `7/6` → `6/6`:** Tab 2 currently shows both `Beige` (`PWD-BEIGE`) and `Lite Beige` (`PWD-LITE-BEIGE`) plus uncleaned `Fanuc Gray` / `Oil Rubbed Bronze`.
  - Merge `PWD-BEIGE` / `PWD-LITE-BEIGE` into **ONE** canonical row; store the retired code in `sku_aliases`.
  - Ensure exactly **6/6** active powder coats.
  - Soft-update DB `display_name` (only when **not** Mia-customized / still stale) to clean Storefront names: **`Gray`**, **`Beige`**, **`Bronze`**, **`Black`**, **`Bone`**, **`White`**.
  - Preserve Katana/factory reference (`Fanuc Gray`, `Lite Beige`, `Oil Rubbed Bronze`, Vendor/Mill code) in a clean **subtitle badge** for powder-coat operators.
- **Bridge `DKT-*` ↔ `STN-DKT-*` & bind `katana_variant_id`:** Link every matching finish and E-Commerce product to its exact Katana Variant ID / inventory SKU by:
  - exact SKU match
  - `DKT-*` ↔ `STN-DKT-*` prefix bridge
  - Vendor/Mill code (e.g. `44285-0002`)
  - normalized name
  so E-Commerce **never** creates duplicate SKUs for items already in Katana.
- Clean up `Rue Coastal` (`FAB-RUE-COA`) pattern repeat if set to bogus `27 | 27 | 27` — solid/textured weave should use standard `0` repeat / `8" × 8"` tile unless striped.

#### 1b. Live High-Res Image & Naming Sync Into `/embed/showroom` (Current Inventory)

- Update showroom server/API read query across **all 4 inventory tabs** (`Fabrics`, `Dekton Slabs`, `3rd-Party Retail`, `Floor & Ready-to-Ship`) so every item dynamically joins/resolves from the unified E-Commerce Finishes + Master Catalog SSOT:
  - **High-Res Square Image** (`swatch_512` / `texture_2048` / product `hero_image`)
  - **Canonical Title Case Display Name**
  - **Vendor/Mill Code** subtitle
  - **E-Commerce Certified** badge
- Resolution keys: canonical SKU, `katana_variant_id`, `STN-DKT-*` ↔ `DKT-*` bridge, `sku_aliases`.
- Every edit or `Approve & Promote` in E-Commerce must immediately reflect on `/embed/showroom` without manual re-upload.
- Add an **`E-Commerce Website` filter toggle pill** next to `In stock only` (with count badge) so operators can toggle between all ~617 showroom/factory items and the active Website/E-Commerce finishes & products (Scottsdale / Solana / Factory stock side-by-side).

#### 1c. Staged Katana Upstream Naming Alignment (`DOWNSTREAM_MUTATIONS=false` Safe)

- Compute a live, deduplicated **Katana Naming & SKU Alignment Summary** comparing E-Commerce canonical names/SKUs against synced Katana variant names:
  - `linkedCount`
  - `alignedCount`
  - `stagedRenameCount`
- Renames are strictly **`PATCH` in-place by `katana_variant_id`** — NEVER create duplicate Katana items; hold outbound until `DOWNSTREAM_MUTATIONS=true`.
- Surface in the **Katana MRP** Stack Health drawer:  
  `"Katana Alignment: X Linked · Y Name Updates Staged (Safe Hold until DOWNSTREAM_MUTATIONS=true)"`.

### 2. Fix Split `katana_sync_meta` Watermark (`11/27` vs `11/23`) & Stuck `"Updating..."` Spinner

**Files (expected):**  
`src/server/stock/showroom-snapshot.ts`, `src/server/stock/hub-sync-freshness.ts`, `src/app/api/stack/katana-sync/route.ts`, `src/app/api/katana/showroom-inventory/route.ts`, `src/app/api/embed/katana-inventory/route.ts`, stack health reader in `actions.ts` / `executive-stack-health.ts`, `ExecutiveStackHealthStrip.tsx`, `/embed/showroom` client freshness UI

**Bug:** `/embed/showroom` shows Green `Hub synced: 11/27/2026…` after syncing 617 Katana items, while ECC **Katana MRP** stayed Red (`Stale 85h ago · 2026-11-23T18:43:19.000Z`) because `/api/stack/katana-sync` wrote a different table/key than `stackHealth` reads (or `stackHealth` cached stale data). Showroom can also leave `"Updating..."` stuck beside a fresh Green badge.

**Fix:**

- Unify `/api/stack/katana-sync`, `/embed/showroom`, and `stackHealth` onto the **exact same canonical sync timestamp** (`SHOWROOM_SYNC_META_ID` / single `katana_sync_meta` row).
- Use `no-store` / immediate cache bust on sync so both ECC **Katana MRP** and Current Inventory immediately show **Green (`Synced 11/27/2026… · 617 items`)**.
- On `/embed/showroom`, do **not** auto-fire background refresh or leave `"Updating..."` stuck when the snapshot is already fresh (`< 30m` old).

### 3. Fix Stack Pills (FedEx LTL, WooCommerce, QBO Popup) & Upgrade PrimeView Diagnostic Report

**Files (expected):**  
`src/server/ecommerce/executive-stack-health.ts`, `src/app/embed/admin/master-catalog/actions.ts`, `ExecutiveStackHealthStrip.tsx`, `EcommerceCertificationPortal.tsx` (Tab 3 / Tab 4), `src/app/api/auth/qbo/connect/route.ts`, `src/app/api/auth/qbo/callback/route.ts`, partner handoff if clipboard report is shared

#### 3a. Professional-Grade PrimeView Diagnostic Report

Upgrade clipboard report generator used in **both** the top WooCommerce drawer and **Tab 4** so `Copy Diagnostic Report for PrimeView` copies a formal **Enterprise Integration Diagnostic Report**:

1. Document ID · Generated UTC · Source/Target Hosts · Severity: **P1 BLOCKER**
2. Executive Summary
3. Live Telemetry & Probe Evidence (HTTP code, endpoint probed, WP error code, stripped response)
4. Isolation & Change-Control Attestation (`DOWNSTREAM_MUTATIONS=false` & `WOO_LEDGER_MODE=log`; zero outbound writes sent)
5. Required PrimeView Engineering Actions (`wp-content/debug.log`, plugin/theme hook check, `/wp-json/wc/v3` verification)
6. Staged Payload Summary (`32` finishes + `107` Aluminum SKUs)

Also:

- Sync **Tab 4's WooCommerce connection badge** to the live probe — NEVER show Green `Connected to ccpatiodev2.primeview.com` when probe is Red `HTTP 500`.
- Remove legacy **`Download Full 38 Finishes`** button.

#### 3b. FedEx LTL Pill & Clickable Drawer

- When ANY certified storefront product is missing freight weight or boxed `L × W × H` (currently **6** Kindle/Tropics SKUs), mark **FedEx LTL** **Amber (`Readiness Warning · 6 SKUs Missing Dims`)** — not fake Green `Dims OK`.
- Fix dead click handler on the FedEx LTL pill so it opens its diagnostic drawer with **`View 6 SKUs Missing Dims →`**, which switches directly to `Tab 3: Certified Products` filtered to `Missing Dims`.

#### 3c. QuickBooks OAuth Popup + Exact Vercel Env Var Alignment (`QBO_OAUTH_REDIRECT_URI`)

**CRITICAL (Vercel Production):** Redirect variable is named **`QBO_OAUTH_REDIRECT_URI`** (NOT only `QBO_REDIRECT_URI`). `QBO_ENVIRONMENT` may be capitalized (`"Production"`).

- Update `getSanitizedQboConfig()` and ALL QBO routes (`/api/auth/qbo/connect`, `/api/auth/qbo/callback`, token refresh, `stackHealth` probe) so:
  1. Redirect URI resolves `QBO_OAUTH_REDIRECT_URI || QBO_REDIRECT_URI || "${origin}/api/auth/qbo/callback"` identically in BOTH `/connect` and `/callback` (strip whitespace/`\r\n`/quotes; when accessed via `https://hub.ccpatio.com`, exact-match Intuit's registered redirect URI).
  2. `QBO_ENVIRONMENT` is normalized case-insensitively (`.trim().toLowerCase()`).
  3. Token exchange & refresh `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` strictly follow **RFC 6749**: `Authorization: Basic ${Buffer.from(\`${clientId}:${clientSecret}\`, "utf8").toString("base64")}`, `Accept: application/json`, `Content-Type: application/x-www-form-urlencoded`, with form body containing ONLY `grant_type` + `code` + `redirect_uri` (or `grant_type=refresh_token&refresh_token=...`) — NEVER duplicate `client_id`/`client_secret` in the form body or URL-encode the secret prior to Base64.
  4. Add a safe, non-secret **`secretSha256Prefix8`** (first 8 hex chars of `SHA-256(clientSecret)`) + **`Verify QBO Credentials Pair`** diagnostic action in the QuickBooks drawer/callback card (zero-side-effect RFC 6749 probe: `invalid_grant` = `Credentials Pair Valid — Ready to Authorize` vs `invalid_client` = `Client ID / Secret Mismatch`).
  5. Open `Reconnect QuickBooks` via `window.open(connectUrl, 'ccpatio_qbo_oauth', 'popup,width=680,height=780')` so it never hijacks the GHL iframe/tab; preserve `?key=` embed auth on any fallback return link.
- Callback fallback button must close the popup or return safely **without stripping `?key=` embed auth**.

### 4. Fix KPI Tab Routing, `102 / 102` Mia Approved, Bogus `-LS/-RS`, Title Case DB Normalization

**Files (expected):**  
`EcommerceCertificationPortal.tsx`, `MasterCatalogClient.tsx`, `Phase1PortalViews.tsx` / portal helpers, `src/server/ecommerce/phase1-portal.ts`, `grouped-sku-resolve.ts`, catalog query/normalize helpers in `actions.ts` / `src/server/`, product title columns in Hub schema (additive secondary factory-reference field only if missing)

#### 4a. KPI & Header Navigation

- Clicking `PARENTS (47)`, `VARIATIONS (100)`, `SIMPLE (7)`, or `PURCHASABLE SKUS (107)` from **ANY** tab MUST switch `activeTab` to **`products` (`Tab 3: Certified Products`)** — fix bug where `PARENTS (47)` jumped to Tab 1 Intake and `SIMPLE (7)` did nothing.
- Restore **`Mia Approved: 102 / 102`** SOW parity.
- Update header subtitle to **`Rob · Mia · Kian · Executive`**.
- Clicking `Mia Approved` / `Storefront Readiness` navigates directly to the filtered table; remove unclosable static banner divs above the KPIs.
- Remove legacy `+ Add Finish` / `"e.g. Canvas Ivory"` inputs on Tab 2 category headers; replace with clean **`+ Stage New [Category] in Intake →`** buttons that open Tab 1.

#### 4b. Bogus `-LS / -RS` on Heaters / Lamps / Loungers + Title Case Normalization

- In Hub DB & catalog queries, `KINDLE LIVING HEATER (d15cm)`, `KINDLE LIVING LAMP (d15cm)`, `LAY'D LOUNGER`, and any freestanding non-sectional item MUST NOT carry `2 Vars (-LS / -RS)` sectional facing badges.
- Restrict `-LS / -RS` strictly to genuine Left-Side / Right-Side **sectional modules**; mark standalone heaters/lamps/loungers **`Simple`** (reconcile parent / variation / simple KPI counts).
- Normalize ALL-CAPS `display_title` / storefront product names in Hub DB to clean **Title Case** (e.g. `Bravada Club Chair (34" × 34")`, `Kindle Living Heater (d15cm)`), preserving `BH`, `SH`, `OD`, `LED`, `II`, `III`, `d15cm`, while keeping the raw factory ALL-CAPS string in a secondary reference column/subtitle.
- Ensure every Tab 3 row includes its **`+ Stage Media / 3D`** button routing into Tab 1 for that SKU.

### 5. Verification

**Files:** `tests/katana-ssot-and-catalog-truth.test.ts`, Playwright under `e2e/` / `tests/e2e` as needed, `.cursor/phase.lock` blast sync, AAR + QCA

Prove with Vitest + Playwright E2E:

1. **Katana Watermark & SSOT Parity**
   - `stackHealth` Katana MRP reads the exact fresh sync watermark (`617` items, Green when `< 30m`)
   - Powder Coats is `6/6` (zero duplicate `Beige`/`Lite Beige`; clean `Gray`/`Beige`/`Bronze` titles with factory subtitle)
   - `/embed/showroom` renders high-res E-Commerce images across Fabrics and Dekton Slabs (`STN-DKT-*` ↔ `DKT-*` bridged)
   - `E-Commerce Website` toggle filters cleanly without stuck `Updating...`
2. **FedEx / Woo / Diagnostic Report**
   - FedEx LTL Amber when 6 SKUs lack dims; pill opens drawer → filters Tab 3 to `Missing Dims`
   - Tab 4 Woo badge matches Red HTTP 500 probe
   - `Copy Diagnostic Report for PrimeView` outputs structured formal report (Document ID, Generated UTC, Executive Summary, Live Telemetry, Isolation Attestation, Required Actions, Staged Payload Summary)
3. **KPI Routing & Product Truth**
   - Clicking `PARENTS` and `SIMPLE` switches to Tab 3 with matching rows
   - Kindle Living Heater / Lamp / Lay'd Lounger show `Simple` (never `-LS / -RS`)
   - Product titles render in Title Case
   - `Mia Approved` reads `102 / 102`

**Run order:**

1. `npx vitest run tests/katana-ssot-and-catalog-truth.test.ts`
2. `npm run qa:lifecycle` → `exit_code: 0`
3. Sync `expected_blast_radius` in `.cursor/phase.lock` + this plan (`tolerance: 0`, exclude `.cursor/aar.json`)
4. `node .cursor/skills/aar/scripts/emit.mjs`
5. `node .cursor/skills/qca/scripts/qca.mjs` → `CERTIFIED` (`audit_exit: 0`); paste verbatim QCA JSON

## Acceptance criteria

| # | Criterion |
|---|-----------|
| A1 | Powder Coats exactly `6/6`; `PWD-BEIGE` retired into `sku_aliases`; clean storefront names + factory subtitle badges; Mia-customized `display_name` preserved |
| A2 | Finishes + catalog bound to Katana via SKU / `STN-DKT-*`↔`DKT-*` / mill code / `katana_variant_id`; no duplicate E-Commerce SKUs for existing Katana items |
| A3 | `/embed/showroom` all 4 tabs resolve high-res SSOT images/names/vendor codes/certified badge; `E-Commerce Website` toggle works; Approve & Promote reflects without re-upload |
| A4 | Katana MRP drawer shows Alignment summary (`linked` / `stagedRename`); no outbound Katana create while `DOWNSTREAM_MUTATIONS=false` |
| A5 | ECC Katana MRP + showroom share one canonical sync watermark; Green when fresh; no stuck `"Updating..."` on `<30m` snapshot |
| A6 | Formal PrimeView 5-section diagnostic report; Tab 4 Woo badge matches live probe; legacy `Download Full 38 Finishes` removed |
| A7 | FedEx LTL Amber for 6 missing-dims SKUs; pill → drawer → Tab 3 `Missing Dims` |
| A8 | QBO resolves `QBO_OAUTH_REDIRECT_URI` identically on connect/callback; case-insensitive `QBO_ENVIRONMENT`; RFC 6749 Basic Auth (no secret in form body); `secretSha256Prefix8` + Verify Credentials Pair probe; Reconnect opens named popup; callback preserves embed `?key=` |
| A9 | KPI chips always route to Tab 3; `Mia Approved: 102 / 102`; header `Rob · Mia · Kian · Executive`; Tab 2 `+ Stage New … in Intake →` |
| A10 | Heaters/lamps/loungers are `Simple` (no bogus `-LS/-RS`); Title Case storefront names with factory ALL-CAPS secondary; Tab 3 `+ Stage Media / 3D` → Tab 1 |
| A11 | Target Vitest + `qa:lifecycle` exit 0; QCA `CERTIFIED`; blast radius synced; Mia `finish_intake` / customized names untouched; outbound modes untouched |

## Out of scope

- Flipping any outbound `*_MODE` / `DOWNSTREAM_MUTATIONS` to `live` / `true`
- Creating new Katana ERP items or applying staged renames while mutations are held
- Overwriting Mia `finish_intake` photoshoot rows or customized `display_name` values
- DLQ admin redrive UI / `/api/admin/redrive` (still forbidden)
- Schema drops, live hub wipes, or paid-order deletes
- Auto-Approve of catalog products from CAD
