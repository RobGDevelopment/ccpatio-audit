# BUILD_PLAN — `woocommerce-payload-pricing-integrity`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 21 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)

## Intent

Enforce **single-price Aluminum storefront truth** across Tab 2, Dark Product
Drawer, Partner Handoff, CSV export, and WooCommerce REST/Dry-Run payloads;
purge legacy showroom swatches from `acf_*_swatches_json` and export feeds so
only the active 32-finish e-commerce roster ships; fix bulk
`Push Certified Catalog to Staging [Preserve WP Images]` so catalog/finishes
batch modes no longer return `"Listing not found."`; emit clean Title-Cased
storefront names, protect `Simple` SKU integrity (no fake `-LS`/`-RS`), and
auto-derive accurate Surface Profiles; complete residual Tab 2 product-row
Archive/Restore wiring and real SHA-256 asset digests.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`).

## Workstreams

### 1. Enforce Single-Price Aluminum Storefront Truth (`resolveCanonicalStorefrontPrice`)

**Bug:** SKU `FIN-BRV-CLB-CHA-34X34` simultaneously showed `$2,080` in Tab 2,
`$2,300` in the `Edit Details` drawer, and `"regular_price": "2680.00"` in the
WooCommerce Dry Run JSON.

**Fix:** Route every Aluminum storefront price surface through ONE shared
canonical resolver:

```
resolveCanonicalStorefrontPrice:
  1. explicit storefront Aluminum override
  2. certified Mia Aluminum PDF price
  3. base Aluminum MSRP
  (strictly exclude legacy steel / +10% upcharges)
```

Surfaces that MUST call the same resolver (exact dollar/cent parity):

- Tab 2 (`Catalog`) price column
- `PortalProductDrawer` / Edit Details
- Partner Handoff (`/partner/primeview-handoff`)
- Live WooCommerce CSV export
- WooCommerce REST / Dry-Run payload builder (`regular_price`)

Assert exact parity for `FIN-BRV-CLB-CHA-34X34` across all five surfaces.

### 2. Purge Legacy Showroom Swatches from `acf_*_swatches_json` & Export Feeds

**Bug:** Woo Dry Run JSON (`acf_fabric_swatches_json`) still emitted legacy
showroom swatches (`FAB-ACT-ASH` / `Action_Ash_LOW.jpg`) instead of the active
32-finish roster.

**Fix:** Filter these emitters strictly through the **active (non-archived)
e-commerce finish roster**:

- `acf_fabric_swatches_json`
- `acf_powder_swatches_json`
- `acf_dekton_swatches_json`
- CSV swatch columns
- 3D finish manifests

Roster contract: `16 Sunbrella + 4 Ultraleather + 6 Dekton + 6 Aluminum Powder
Coats` (+ any operator-added active e-commerce finishes). Include calibrated
`repeat_inches` / `repeat_w_in` / `repeat_h_in` and `texture_scale`. Exclude
steel frame options and `+10%` upcharges. Legacy codes such as `FAB-ACT-ASH`
must be absent; active codes such as `FAB-CAB-CLA` (`Cabana Classic`) must be
present.

### 3. Fix Bulk `Push Certified Catalog to Staging [Preserve WP Images]`

**Bug:** Clicking `Push Certified Catalog to Staging` failed with
`{ "ok": false, "error": "Listing not found." }` because
`/api/ecommerce/portal-staging-push` attempted a single-SKU lookup when invoked
for the full catalog.

**Fix:**

- Support batch modes:
  - `mode: "catalog"` → all active certified SOW products
  - `mode: "finishes"` → all active e-commerce finishes
  - plus single-SKU push (existing path)
- Enforce `"preserveWpGalleryWhenEmpty": true` by omitting destructive empty
  `images: []` overwrites when Hub gallery media is empty
- Run pre-flight readiness checks
- Return a clear batch summary:
  - `totalProducts`
  - `variationsCount`
  - `wpGalleryPreservedCount`
  - `missingDimsCount`
  - `mutationMode: "simulated" | "live"`
- Honor `DOWNSTREAM_MUTATIONS=false` (simulated writes; never live Woo mutate
  under current flags)
- Zero `"Listing not found."` when invoked for full certified catalog

### 4. Clean Storefront Titles, `Simple` SKU Integrity & Accurate Surface Profiles

**Titles:** Emit clean Title-Cased Storefront Display Titles in Woo Dry Run
JSON `"name"` and CSV exports:

- Strip raw `[FIN-...]` bracket suffixes
- Never export raw ALL-CAPS factory names unless explicitly saved by operator
- Preserve uppercase acronyms: `BH`, `SH`, `AH`, `OD`, `ID`, `LED`, `UV`,
  `LP`, `NG`, `BBQ`, `3D`, `II`, `III`

**Simple SKU integrity:** Products such as `FIN-BRV-CLB-CHA-34X34` must never
display or emit synthetic `-LS` / `-RS` variation SKUs in the drawer, CSV, or
Woo payloads.

**Surface Profiles (auto-derive when not explicitly overridden):**

| Product class | Default profile |
|---|---|
| Dining / Coffee / Side / Chat / Bar Tables | `Dekton Tabletop + Frame` (never `Cushion`) |
| Umbrellas (`CANTILEVER UMBRELLA`, etc.) | `Umbrella Canopy + Frame` |
| Heaters, Lamps & Non-Cushion Pool Loungers (`KINDLE LIVING HEATER`, `KINDLE LIVING LAMP`, `TROPICS` pool items) | `Finish / Hardware Only` |

### 5. Complete Residual Polish (Tab 2 Product-Row Archive + Real SHA-256)

**Archive wiring:** Wire Tab 2 product-row `Archive` and `Restore` end-to-end
through:

1. Dark **Impact Warning Modal**
2. Sticky **Staged Commit Bar**
3. `Archived (N)` filter vault

Strict soft-archive only — zero hard deletes in Hub or WooCommerce.

**SHA-256 digests:** Compute and persist real `crypto.createHash("sha256")` hex
digests on `.glb`, `.usdz`, and swatch/texture asset commits/uploads. Dark 3D
studio must display the real digest or `Pending upload` — never fake
placeholder hashes.

### 6. Verification (`qa:lifecycle` + Vitest/Playwright + QCA)

**Vitest + Playwright assertions:**

1. `FIN-BRV-CLB-CHA-34X34` price matches identically across Tab 2, Dark Drawer,
   CSV export, and Woo Dry Run JSON
2. `acf_fabric_swatches_json` contains `FAB-CAB-CLA` (`Cabana Classic`) and
   ZERO legacy showroom swatches (`FAB-ACT-ASH` absent)
3. `Push Certified Catalog to Staging` returns `ok: true` batch summary
   (zero `"Listing not found"`) under `DOWNSTREAM_MUTATIONS=false`
4. Tab 2 product `Archive` → Warning Modal → Staged Commit → `Archived` view
   → `Restore` round-trip works cleanly

**Target Vitest:**

```bash
npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts
```

**Gate sequence:**

1. Target Vitest green
2. `npm run qa:lifecycle` → `exit_code: 0`
3. Sync `expected_blast_radius` in `.cursor/phase.lock` + this file
   (`tolerance: 0`, exclude `.cursor/aar.json`)
4. `node .cursor/skills/aar/scripts/emit.mjs`
5. `node .cursor/skills/qca/scripts/qca.mjs` → `CERTIFIED` (`audit_exit: 0`);
   paste verbatim QCA JSON

## Allowed files

1. `.cursor/phase.lock`
2. `.cursor/session-stamp.json`
3. `.cursor/aar.json`
4. `BUILD_PLAN.md`
5. `src/app/embed/`
6. `src/app/api/`
7. `src/app/partner/primeview-handoff/`
8. `src/components/`
9. `src/lib/`
10. `src/server/`
11. `tests/`
12. `e2e/`

## Target test

```bash
npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts
```

## Hard constraints

- No `*_MODE` / `DOWNSTREAM_MUTATIONS` flag flips (`log` / `false` stay)
- No hard-deletes of middleware DB rows; no destructive WooCommerce `DELETE`
- No schema drops; additive only if any schema touch (prefer none)
- Never modify tests to fake Phase 2 DB proof
- Never delete a paid order; ledger failure is retried, not rolled back
- Katana remains single live tenant — no sandbox writes from this phase
- Staging / sync actions must clearly distinguish simulation vs live write under
  existing guardrails (`mutationMode: "simulated" | "live"`)
- Edits strictly inside `allowed_files` (Track 2)
- Soft-archive only for products and finishes
