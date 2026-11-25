# BUILD_PLAN — `ghl-ecommerce-handoff-portal-unification`

**Base:** `HEAD` (`bb2feeb`)  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 10 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)

## Intent

Replace the cluttered GHL E-Commerce Master Catalog **default** view with the clean dark
3-tab Handoff & Certification Portal (parity with `/partner/primeview-handoff`). Gate the
legacy light-theme spreadsheet strictly behind `?view=legacy-admin` (Superadmin only).
Reconcile Mia Approved / finish counts across GHL + Partner Handoff. Do **not** flip any
`*_MODE` or `DOWNSTREAM_MUTATIONS` flags.

## Workstreams

### 1. Default view replacement & Superadmin escape hatch

**Route:** `/embed/admin/master-catalog`

- **Default (no query / no legacy flag):** render ONLY the unified dark-theme portal
  (`#0b0f17` / `#111827` slate surfaces, amber/gold accents) — zero white “Single Source
  of Truth” banner strip, zero `Upcharge % 10` / `Recalculate Upcharge %` bar, zero
  duplicate search bars, zero competing finish buttons, zero legacy light-gray spreadsheet
  chrome.
- **`?view=legacy-admin`:** Superadmin-only raw Master Catalog spreadsheet. Subtle
  top-right links on the dark portal: `Raw Catalog Grid →` and `Mission Control →`. On
  legacy view, show `← Back to E-Commerce Portal` bar.
- **Role gate (unchanged):** Mia (`mia@ccpatio.com`), Kian (`kian@ccpatio.com`),
  `SuperAdmin` / `Ops_Manager`, authorized GHL embed sessions.

### 2. Unified header, reconciled KPIs & 3 pill tabs

**Header / KPIs** (match Partner Handoff layout):

- Gold eyebrow: `CC PATIO · E-COMMERCE SINGLE SOURCE OF TRUTH`
- Title: `E-Commerce Certification & Handoff Portal`
- ONE canonical green `Mia Approved` pill — reconcile `102 / 102` vs `107 / 107` so
  `/partner/primeview-handoff` and `/embed/admin/master-catalog` show identical numbers
- KPI cards: `Parents`, `Variations`, `Simple`, `Purchasable SKUs`, `Active Finishes: 32`

**Tab 1 — `32 Finishes & Swatches`** (default active / 1-click pill):

- Inline dark cards/tables (not modals) for the 4 finish groups:
  Sunbrella (16), Ultraleather (4), Dekton (6), Aluminum Frame Powder Coats (6)
  with `Aluminum-Only Storefront Policy — Steel/+10% Excluded` badge
- Per row: swatch thumb + `2048px` texture badge, **LOCKED** gold monospace SKU
  (`FAB-*` / `DKT-*` / `PWD-*`), inline `Display Name`, `Pattern Repeat (in)` /
  `Texture Scale`, Woo/APF metadata, Upload Swatch / 2048px Texture
  (`finish-assets.ts`), `−` soft-disable
- `+ Add Finish` per category → SKU engine auto-generates + locks; manual SKU edit
  impossible

**Tab 2 — `107 E-Commerce Products`:**

- ONE dark search + collection pills + status filter
  (`All` | `Needs Mia Spot-Check` | `Mia Approved`)
- Dark product table: name, locked `FIN-*` hub SKU, Variations / `-LS`/`-RS` count,
  Aluminum MSRP, Media/3D badge, 1-click Mia Approved toggle, `Edit Details` → dark
  drawer (storefront copy, Aluminum MSRP, weights/dims, add-on labels; `FIN-*` RO)

**Tab 3 — `PrimeView Sync & Downloads`:**

- Artifact buttons (CSV, Technical Spec `.md`, Full 3D Finishes Manifest `.json`,
  32 Active Finishes Manifest `.json`)
- Woo staging (`ccpatiodev2.primeview.com`), Test Woo Connection, Dry Run Preview
- Webhook URL copy box + photoshoot / `.glb` upload dropzone

### 3. Partner Handoff parity (`/partner/primeview-handoff`)

- Replace stale “24 Fabric Swatches” headings/labels with the exact 32-finish breakdown:
  `20 Upholstery Swatches [16 Sunbrella + 4 Ultraleather]`, `6 Dekton Stones`,
  `6 Powder-Coat Finishes`
- Identical `Mia Approved` count logic as GHL portal

### 4. Tests, `qa:lifecycle`, AAR & QCA

- Update legacy Master Catalog Playwright specs to use `?view=legacy-admin` where they
  assert raw-grid tools
- Add Playwright + Vitest coverage: default `/embed/admin/master-catalog` renders dark
  3-tab portal with **zero** legacy `Upcharge %` bar and **zero** duplicate search bars
- Target Vitest: `npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts`
- `npm run qa:lifecycle` → `exit_code: 0`
- Sync `expected_blast_radius` in `.cursor/phase.lock` + this file (`tolerance: 0`,
  exclude `.cursor/aar.json`)
- `node .cursor/skills/aar/scripts/emit.mjs`
- `node .cursor/skills/qca/scripts/qca.mjs` → `CERTIFIED` (`audit_exit: 0`); paste
  verbatim QCA JSON

## Allowed files

1. `.cursor/phase.lock`
2. `.cursor/session-stamp.json`
3. `.cursor/aar.json`
4. `BUILD_PLAN.md`
5. `src/app/embed/admin/master-catalog/`
6. `src/app/partner/primeview-handoff/`
7. `src/components/`
8. `src/lib/ecommerce-roster.ts`
9. `src/server/ecommerce/`
10. `src/server/assets/finish-assets.ts`
11. `tests/`
12. `e2e/`

## Target test

```bash
npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts
```

## Hard constraints

- No `*_MODE` / `DOWNSTREAM_MUTATIONS` flag flips
- No schema drops; additive only if any schema touch (prefer none)
- Never modify tests to fake Phase 2 DB proof
- Do not leave legacy UI on the default route to satisfy old Playwright selectors —
  update selectors / `?view=legacy-admin` instead
