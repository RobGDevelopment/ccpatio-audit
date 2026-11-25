# BUILD_PLAN — `ghl-ecommerce-portal-scroll-seed-readiness`

**Base:** `HEAD` (`2d6f7fe`)  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 20 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)

## Intent

Fix live GHL iframe UX, auth, finish seeding, and WooCommerce readiness gaps on
`/embed/admin/master-catalog` after handoff-portal unification. Restore reliable
vertical scrolling inside the fixed-height GHL iframe, auto-hydrate all 32
canonical finishes (`16/16`, `4/4`, `6/6`, `6/6`), make every client read/mutation
work under blocked third-party cookies via signed embed tokens, dark-theme the
`Edit Details` drawer with Woo push-prep fields, upgrade Tab 2/3 readiness UX,
and certify via Vitest + Playwright + `qa:lifecycle` + QCA.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`).

## Approved tightenings (2026-11-24)

1. **Allowlist guard:** Keep shared header-token verification in `src/lib/embed-auth.ts`
   and `src/server/ecommerce/` (import-only from `src/server/showroom/`). Do **not**
   edit `src/server/showroom/` or `src/server/catalog/` unless `.cursor/phase.lock`
   `allowed_files` is updated first.
2. **Spot-check vs 102/102:** Clear pending spot-check badge/filter membership when
   `miaApproved === true`. Move odd-dollar PDF notes into `Edit Details`. Only surface
   `Needs Spot-Check` when unapproved. Preserve GHL ↔ Partner `102 / 102` parity.
3. **Playwright DOM scroll + cookie-cleared drawer:** At `1280x720`, assert
   `scrollHeight > clientHeight`, set `scrollTop = scrollHeight`, assert `scrollTop > 0`,
   and verify 6th powder coat (Tab 1) + non-Bravada rows near Tab 2 bottom become visible.
   Clear cookies on tokenized embed URL and open `Edit Details` for grouped parent
   `FIN-FLY-LEF-ARM-SOF-88X34` — dark drawer, zero `"Failed to load"` errors.

## Workstreams

### 1. Fix GHL iframe scrolling & eliminate white reload flash (`src/app/embed/`)

**Problem:** `src/app/embed/layout.tsx` wraps children in
`h-dvh … overflow-hidden`, and master-catalog / portal shells inherit fixed
`100vh` / `overflow-hidden` from the legacy virtualized grid — mouse-wheel and
scrollbar cannot reach the bottom of Tabs 1–3 inside GHL’s fixed-height iframe.
Reloads flash a full white screen.

**Fix:**

- Give the default dark E-Commerce Portal root wrapper an explicit internal
  scroll container:
  `h-[100dvh] max-h-[100dvh] overflow-y-auto overscroll-contain bg-[#0b0f17] text-slate-100`
  with `min-h-0` on parent flex wrappers and `pb-24` bottom breathing room.
- Make the 3-tab navigation bar
  `sticky top-0 z-20 bg-[#0b0f17]/95 backdrop-blur`.
- Set dark background `#0b0f17` on route loading / Suspense fallbacks so GHL
  reloads never flash white.
- Inspect and neutralize clipping from
  `src/app/embed/layout.tsx`,
  `src/app/embed/admin/master-catalog/`, and related portal shells without
  breaking legacy `?view=legacy-admin`.

### 2. Auto-seed / hydrate all 32 canonical finishes (`16/4/6/6`)

**Problem:** KPI reports `ACTIVE FINISHES: 32` while live tables render
`Sunbrella (0/16)`, `Ultraleather (1/4)`, `Dekton (0/6)`, `Powder Coats (6/6)` —
25 roster SKUs missing from Supabase rows.

**Fix:**

- Idempotent upsert / merge-on-first-read from
  `src/server/ecommerce/ecommerce-32-finish-roster.ts` so Tab 1 immediately
  shows **16/16 Sunbrella**, **4/4 Ultraleather**, **6/6 Dekton**,
  **6/6 Aluminum Frame Powder Coats** (`32/32`).
- Populate canonical display names (e. g. `Beacon`, not stale
  `Beacon Ultraleather` unless user-customized), sensible default
  `Repeat (in)` / `Scale` (e. g. `Cabana Classic` vertical repeat `7`), and an
  **APF Target Group** badge per section:
  `Cushion & Pillow` | `Dekton Tabletop` | `Aluminum Frame`.
- Tab 1 inline editing & `+ Add Finish` UX:
  - High-contrast inputs:
    `bg-slate-900 border border-slate-600 text-slate-100 placeholder:text-slate-400 focus:border-amber-400`
  - Inline validation next to the button (not clipped at bottom)
  - Explicit `Save` / auto-save feedback on row edits
    (`Saving...` → `Saved ✓`) for `Display Name`, `Repeat (in)`, `Scale`

### 3. Cross-origin GHL iframe auth + dark `Edit Details` product drawer

**Problem:** `Edit Details` opens a white drawer that crashes with
`Failed to load FIN-FLY-LEF-ARM-SOF-88X34 detail…` because cross-origin
`fetch()` drops third-party cookies and/or grouped parent SKUs
(`FIN-…` with `-LS`/`-RS` children) fail single-row SKU lookup.

**Fix:**

- Pass signed embed auth token from the server page into client API requests via
  `x-ccpatio-embed-token` / `Authorization`, accepted by `/api/...` routes
  alongside cookies (extend existing dual-auth patterns in
  `src/lib/embed-auth.ts`, `src/server/showroom/embed-route-auth.ts`,
  `EmbedSessionProvider`).
- Every client read/mutation must work inside GHL’s cross-origin iframe when
  3rd-party cookies are blocked: `Edit Details`, product save, finish
  save/`+`/`−`, asset presign/commit, Woo dry-run/sync.
- Product detail API resolves both simple SKUs and grouped parent SKUs
  (including `-LS` / `-RS` variation pairs).
- Style `Edit Details` drawer in dark `#0b0f17` / `#111827` slate + gold theme
  and expose WooCommerce push-prep fields:
  - **Read-Only Locked SKUs:** Canonical Parent SKU (`FIN-*`) + child
    `-LS` / `-RS` variation SKUs
  - **Storefront Display Title & Description:** customer-facing title
    (Title Case; strip raw `[FIN-…]` brackets; separate from factory name) + copy
  - **Aluminum Storefront MSRP** (Aluminum-only policy)
  - **Customizable Surface / Add-On Profile:**
    `Cushion + Frame` | `Cushion + Pillow + Frame` |
    `Dekton Tabletop + Frame` | `Frame Only`
    (tables map to `Tabletop`, not `Cushion`)
  - **Freight Packaging Weight (`lbs`) & Boxed `L × W × H` (`in`)** with
    shipping-tier readiness indicator
  - **Product Media & 3D Upload:** photos (`.jpg/.png/.webp`) + `.glb` into
    Supabase Storage; default-ON
    `"Preserve existing WordPress gallery images when Hub media is empty"`
    toggle/badge

### 4. Upgrade Tab 2 (`107 E-Commerce Products`) readiness & spot-check badges

- Strip raw `[FIN-…]` bracket suffixes from customer-facing display titles
  (keep `FIN-*` in locked SKU column).
- Format `VARIATIONS / FACING` as `Simple` vs `2 Vars (-LS / -RS)`
  (not bare `1` / `2`).
- Per-row Woo readiness badges:
  - **Surface Profile:** `Cushion` / `Pillow` / `Tabletop`
  - **Freight Dims:** `Ready` vs `Missing Dims`
  - **Media:** `WP Gallery Preserved` vs `Hub Media` / `.glb`
- Reconcile contradictory `Needs Mia Spot-Check` + `Mia Approved`:
  either show `Needs Spot-Check` until Mia explicitly reviews/approves, **or**
  clear the pending spot-check flag once Mia confirms approval — never both.

### 5. Upgrade Tab 3 (`PrimeView Sync & Downloads`) & header health pill

- Replace raw-SKU text input on the upload dropzone with a **searchable Product
  & Finish SKU Combobox**; accept Product Gallery Images (`.jpg/.png/.webp`)
  and 3D Models (`.glb`).
- Under `WOOCOMMERCE STAGING SYNC`, add explicit staging push actions:
  - `Push 32 Swatches & Scales to Staging`
  - `Push Certified Catalog to Staging [Preserve WP Images]`
  - Run pre-push readiness checks
  - Respect `DOWNSTREAM_MUTATIONS` / `WOO_LEDGER_MODE` guardrails **without**
    flipping env flags
  - Clearly surface verified non-mutating staging simulation vs live write when
    `DOWNSTREAM_MUTATIONS=false`
- Scope top header status pill for Mia/Kian to **Storefront Readiness**; move
  back-office QBO/DLQ `System Health` into Superadmin’s
  `Mission Control →` tooltip/badge so merchandisers aren’t alarmed by admin
  QBO OAuth status.

### 6. Verification (`qa:lifecycle` + Playwright + QCA)

Add/update Vitest + Playwright E2E coverage verifying:

- Portal root scrolls to bottom of all 3 tabs inside a fixed-height iframe
  viewport (`overflow-y-auto`, sticky tabs, no white Suspense flash)
- Finish loader/seeder yields **32/32** (`16/16`, `4/4`, `6/6`, `6/6`) with
  APF badges + canonical names
- High-contrast `+ Add Finish` inputs + inline validation + `Saving…`/`Saved ✓`
- Embed token header auth succeeds when cookies are absent; product detail
  resolves grouped `FIN-*` parents with `-LS`/`-RS`
- Dark `Edit Details` drawer exposes locked SKUs, storefront title/desc,
  Aluminum MSRP, surface profile, freight dims, media/`.glb` upload,
  WP-gallery-preserve default ON
- Tab 2 title stripping, `Simple` / `2 Vars (-LS / -RS)`, readiness badges,
  non-contradictory spot-check vs Mia Approved
- Tab 3 SKU Combobox + image/`.glb` accept; staging push actions simulate
  safely under `DOWNSTREAM_MUTATIONS=false`
- Header pill = Storefront Readiness for Mia/Kian; System Health only on
  Superadmin Mission Control path

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
10. `src/server/ecommerce/`
11. `src/server/assets/`
12. `tests/`
13. `e2e/`

## Target test

```bash
npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts
```

## Hard constraints

- No `*_MODE` / `DOWNSTREAM_MUTATIONS` flag flips (`log` / `false` stay)
- No schema drops; additive only if any schema touch (prefer none)
- Never modify tests to fake Phase 2 DB proof
- Never delete a paid order; ledger failure is retried, not rolled back
- Katana remains single live tenant — no sandbox writes from this phase
- Staging push actions must clearly distinguish simulation vs live write under
  existing guardrails
- Edits strictly inside `allowed_files` (Track 2)
