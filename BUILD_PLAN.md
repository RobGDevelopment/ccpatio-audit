# BUILD_PLAN — `executive-dark-control-plane-unification`

**Base:** `HEAD` (`7ea3831`)  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 18 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)

## Intent

Unify the GHL E-Commerce Storefront Build and CC Patio Middleware Stack into
**one full-width dark Executive Control Center** at `/embed/admin/master-catalog`,
restricted to Mia (`mia@ccpatio.com`), Kian (`kian@ccpatio.com`), `SuperAdmin`,
and authorized executive GHL embed tokens. Retire every remaining white view /
drawer, restore `FAB-CAB-CLA` so Active Finishes is a live `32`, enforce
archive-warning → staged-commit → 1-click restore protection, make every KPI /
pill / stack-health chip clickable with guided actions, and certify via Vitest +
Playwright + `qa:lifecycle` + QCA.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`).

## Workstreams

### 1. Full-bleed 100% viewport width & single dark page (retire all white views/drawers)

**Problem:** Portal still centers content under `max-w-7xl` / `max-w-6xl`,
leaving unused iframe horizontal space; SKUs wrap; Swatch / 2048px Texture
controls stack vertically in tall white columns; broken `<img>` icons appear
when URLs are missing; three white drawers (`3D Media`, `E-Commerce Finishes
(3D)`, `System Health`) and unstyled white `<option>` menus remain;
`?view=legacy-admin` still exposes the white spreadsheet; header links
`Raw Catalog Grid ->` and broken `Mission Control ->` (`/admin/mission-control`
404) confuse operators.

**Fix:**

- Replace centering constraints with full-bleed layout:
  `w-full max-w-none px-5 xl:px-8` across the portal shell, tables, and drawers.
- Keep canonical SKUs on one crisp line (`whitespace-nowrap`).
- Lay out `Swatch` and `2048px Texture` upload controls **side-by-side**
  (not tall white vertical stacks).
- When an image URL is not yet uploaded, render a clean color-swatch fallback
  chip instead of a broken `<img>` icon.
- Redirect `?view=legacy-admin` cleanly into the unified dark portal (no
  spreadsheet escape hatch; no `Upcharge %` surface).
- Remove header links: `Raw Catalog Grid ->` and `Mission Control ->`.
- Eliminate **all three** remaining white drawers:
  - `Product3dMediaDrawer` (`+ Add 3D`)
  - white `E-Commerce Finishes (3D)` / `SwatchesFinishesDrawer`
  - white `System HealthDrawer`
- Style all `<select>` / `<option>` menus dark:
  `bg-slate-900 text-slate-100`.

**Migrate every legitimate input into the single dark portal:**

#### Merged Dark Product & 3D Drawer

Opened by `Edit Details`, `+ Add 3D`, or readiness pills. Must include:

- Locked read-only SKU(s) — show `-LS` / `-RS` **only** when the item actually
  has variation children; never append fake `-LS`/`-RS` to `Simple` items
- Storefront Title (preserve uppercase acronyms: `BH`, `SH`, `OD`, `LED`) & Copy
- Aluminum MSRP
- Expanded **Surface Profile**:
  - `Cushion + Frame`
  - `Cushion + Pillow + Frame`
  - `Dekton Tabletop + Frame`
  - `Umbrella Canopy + Frame`
  - `Finish / Hardware Only [Heaters, Lamps, Pool]`
  - `Frame Only`
- Visibly labeled **Freight Packaging** (`Weight lbs`, `Length in`, `Width in`,
  `Height in`)
- `Legacy SKU`, `Factory Approved` status, `View on Staging` link
- **3D & Gallery Studio:** `GLB`, `USDZ`, `SHA-256`, Material Slots
  (`frame_finish` / `cushion_fabric` / `table_top` / `accent_accents`),
  gallery photos, `Preserve WP Gallery Images` toggle

#### Tab 1 — Finishes, Swatches & Add-Ons

- Sub-filter pills: `All 32 Active`, `Sunbrella (16)`, `Ultraleather (4)`,
  `Dekton (6)`, `Powder Coats (6)`, `Storefront Add-Ons`,
  `Archived / Disabled (N)`
- `Repeat W × H (in)` + `Scale`
- Clear validation messages automatically on input/blur
- Only trigger row save + toast when a value actually changed (`dirty` check)

#### Tab 2 — Catalog & Pipeline

- Product Type pills: `All Types`, `Sofas & Sectionals`, `Chairs & Loungers`,
  `Tables`, `Ottomans`, `Swings`, `Umbrellas, Heaters & Misc`
- Readiness filter pills: `Missing Dims`, `Missing 3D/Media`,
  `Needs Mia Spot-Check`, `Mia Approved`, `Phase 2 / Drafts`, `Archived`
- `+ New Product` creation drawer (auto-locked SKU via SKU engine)
- Empty-state card when a filter matches `0` rows
  (e.g. *"0 items currently need Mia Spot-Check — all 102 SOW items are
  certified."*)

### 2. Restore `FAB-CAB-CLA` + Warning Modal, Staged Commit Bar & 1-Click Restore

**Problem:** `FAB-CAB-CLA` (`Cabana Classic`, `7"` vertical repeat) is inactive,
so Sunbrella shows less than `16/16` and Active Finishes drifts from live count;
instant `−` hard-delete risk exists for finishes/products with no confirmation,
no staged commit, and no restore path.

**Fix:**

- Immediately restore `FAB-CAB-CLA` to active so Sunbrella = **`16/16`** and
  Active Finishes dynamically reflects **`32`**.
- Top `ACTIVE FINISHES` KPI card must compute **live active count** (never a
  hardcoded `32`).
- **Zero Accidental Deletion Policy** (Finishes AND Products):
  - Never hard-delete middleware DB rows
  - Never send destructive `DELETE` calls to WooCommerce
  - Replace instant `−` with `Archive` that opens a dark **Impact Warning Modal**
    detailing Hub + WooCommerce impact (variation count affected, storefront
    visibility change, SKU preservation) and requiring explicit confirmation
  - Confirmed archive / restore / critical visibility actions stage into a sticky
    **Pending Commit Bar**:
    `N Uncommitted Roster/Catalog Changes — [Review & Commit Changes] [Discard]`
    with actor + timestamp audit logging
  - Any archived finish or product restores in **1 click** from the
    `Archived (N)` filter view

### 3. Interactive Full-Stack System Health Bar & "Every Pill Is Clickable" UX

**Problem:** System health is trapped in a white drawer / broken Mission Control
link; WooCommerce can report fake green while WordPress returns HTML / critical
PHP errors; KPIs and readiness pills are not actionable.

**Fix — Full-Stack Control Strip** (top of portal; every pill clickable):

| # | Layer | Status UX |
|---|--------|-----------|
| 1 | **Supabase DB & Storage** | Healthy / Degraded / Action Required |
| 2 | **Katana MRP** | Sync freshness + inline `Run Katana Sync Now` |
| 3 | **QuickBooks Online** | `CC Patio Scottsdale LLC` connection status, `QBO_LEDGER_MODE` indicator, inline `Reconnect QuickBooks` → `/api/auth/qbo/connect` |
| 4 | **WooCommerce (`ccpatiodev2.primeview.com`)** | **FIX FAKE GREEN:** probe real HTTP status + valid JSON; if WP returns HTML / `There has been a critical error on this website` / HTTP 5xx → **Red (`WP Critical Error`)**, show stripped error snippet, `Re-Test Connection`, `Copy Diagnostic Report for PrimeView`, Held/Quarantined Orders inspect |
| 5 | **GoHighLevel CRM** | Connection / embed session health |
| 6 | **FedEx LTL Freight** | Credentials status + `N SKUs Missing Dims — Click to Filter` shortcut |
| 7 | **Inngest Queue / DLQ** | Open DLQ count + inspect/retry control |

Status colors: `Healthy` Green / `Degraded` Amber / `Action Required` Red.

**Every KPI card, policy banner, and row badge is clickable:**

- KPI cards (`Parents`, `Variations`, `Simple`, `Purchasable SKUs`,
  `Active Finishes`) and header pills (`Mia Approved`, `Storefront Readiness`)
  → switch to matching tab + filter and show a dismissible dark info strip
  explaining what is shown and any required action steps
- Row pills (`Needs 2048px`, `Missing Dims`, `Freight Dims Ready`,
  `Cushion`/`Tabletop`, `WP Gallery Preserved`/`Hub Media`,
  `APF Target Group`, `Aluminum-Only Policy`) → open the targeted section of
  the dark drawer (auto-focused on that exact input) **or** an inline dark
  action popover explaining meaning + how to complete/change it

### 4. Executive Access Gate, Full `qa:lifecycle` & QCA Certification

**Access gate:**

- Allow: `mia@ccpatio.com`, `kian@ccpatio.com`, `SuperAdmin`, valid executive
  GHL embed session
- Deny: non-executive showroom/floor users → clean dark access-restricted card

**Tests (Vitest + Playwright):**

- Full-bleed layout (`max-w-none`), zero white drawers, `?view=legacy-admin` no
  longer exposes `Upcharge %` (migrate old legacy-admin assertions)
- `FAB-CAB-CLA` restored (`16/16` Sunbrella, `32` dynamic active finishes) +
  Archive Warning Modal → Staged Commit → `Archived` view → 1-click `Restore`
- Clickable 7-service Stack Health Strip (including red detection when Woo
  returns HTML/500 PHP error and inline `Reconnect QuickBooks`) + clickable
  KPI/readiness pills

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
  existing guardrails
- Edits strictly inside `allowed_files` (Track 2)
- Executive-only access for the unified control plane
