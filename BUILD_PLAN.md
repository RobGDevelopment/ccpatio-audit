# BUILD_PLAN — `embed-auth-ssr-stack-bar-hardening`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 19 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)

## Intent

Allowlist `rjg.cal@gmail.com` as Executive SuperAdmin; keep all 7 Stack Health
pills (including **Katana MRP**) permanently mounted with SSR hydration; mint
embed tokens reliably for valid GHL `?key=` embeds (handling literal
`{{user.email}}` safely); prevent half-authenticated shell renders; and remove
duplicate Tab 2 filter pills.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`).

## Diagnosed production bugs (live GHL iframe on hub.ccpatio.com)

1. **Missing allowlist entry:** `rjg.cal@gmail.com` (Rob's GHL/Google admin
   login) is absent from the executive email allowlist that currently includes
   only `mia@ccpatio.com` and `kian@ccpatio.com`.
2. **Stack Health bar unmounts:** The 7-pill Top Stack Health Bar shows
   `"Probing full stack..."` then **completely unmounts** whenever its client
   fetch returns an error or `401` — hiding Katana MRP, QuickBooks, WooCommerce,
   etc.
3. **Half-authenticated SSR shell:** `/embed/admin/master-catalog` can render
   product chrome (e.g. 107 products) without a signed client `embedToken` when
   cookies are blocked in GHL's cross-origin iframe or when
   `?email={{user.email}}` is uninterpolated/absent — Tab 1 finishes and
   `Edit Details` then fail with `Unauthorized embed session.` / `unauthorized`.
4. **Duplicate Tab 2 pills:** Tab 2 (`107 E-Commerce Products`) renders a 4th
   row of duplicate `Needs Mia Spot-Check` and `Mia Approved` pills below the
   Readiness filter row.

## Workstreams

### 1. Executive Allowlist + Bulletproof GHL `?key=` Embed Token Minting

**Files:** `src/lib/`, `src/server/`, `src/app/embed/`, `src/app/api/`

- Add `rjg.cal@gmail.com` (case-insensitive) to the canonical executive /
  SuperAdmin email allowlist alongside `mia@ccpatio.com` and `kian@ccpatio.com`
  across all portal SSR checks and `/api/ecommerce/*` routes.
- Confirm query param aliases for `/embed/showroom` and
  `/embed/admin/master-catalog`: `key` and `access_key`.
- On `/embed/admin/master-catalog` when `?key=<GHL_EMBED_SECRET>` is valid:
  - If `email` / `user_email` is a real interpolated email (ignore empty
    strings and literal uninterpolated `{{...}}` GHL placeholders), enforce the
    executive allowlist.
  - When valid `?key=` passes **or** a valid executive session cookie exists,
    **ALWAYS** mint and inject a signed `embedToken` into the client portal
    **and** set `SameSite=None; Secure; Partitioned` (CHIPS) cookie fallback so
    client fetches (`stack-health`, `finishes`, `portal-product`, Katana
    reset/sync) succeed with zero `401`s inside Chrome's cross-origin GHL iframe.
- If **neither** a valid `?key=` **nor** an authorized executive session
  exists: do **not** render a half-loaded portal shell — render a clean dark
  Executive Auth Gate card:
  - Copy: `"Missing or invalid GHL embed key (?key=...)"`
  - Setup instructions:
    `.../embed/admin/master-catalog?key=<GHL_EMBED_SECRET>&email={{user.email}}`

### 2. Permanently Mounted 7-Pill Stack Health Bar + SSR Initial Hydration

**Files:** `src/components/`, `src/app/embed/admin/master-catalog/`,
`src/server/`, `src/lib/`

- Hydrate initial **32 finishes** (`16/4/6/6`) **and** initial 7-service Stack
  Health state server-side, **or** guarantee immediate render of all 7 pills:
  **Supabase**, **Katana MRP**, **QuickBooks**, **WooCommerce**, **GHL CRM**,
  **FedEx LTL**, **Inngest** — so the top bar **never** vanishes from the DOM.
- During refresh/probe, keep all 7 pills visible; on probe error / `401` /
  `500`, mark the pill Amber/Red (`Probe Failed — Click to Diagnose & Retry`)
  with its diagnostic drawer still clickable (including
  **`Reset Bucket & Sync Katana Now`** on Katana MRP and **`Reconnect QuickBooks`**
  on QuickBooks).

### 3. Remove Duplicate Filter Pills on Tab 2

**Files:** `src/components/`, `src/app/embed/admin/master-catalog/`

- Remove the duplicate 4th row of `Needs Mia Spot-Check` and `Mia Approved`
  pills on Tab 2 so each filter appears once in the Readiness row.

### 4. Verification

**Target Vitest:**

```bash
npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts
```

**Playwright / Vitest assertions:**

1. `rjg.cal@gmail.com` is recognized as Executive / SuperAdmin.
2. Loading `/embed/admin/master-catalog?key=<valid>&email={{user.email}}` with
   **all browser cookies cleared** (`context.clearCookies()`):
   - Renders all **7 Stack Health pills** (explicitly assert **Katana MRP** is
     visible and clickable → reveals `Reset Bucket & Sync Katana Now`)
   - Renders **32** active finishes (`16/16` Sunbrella)
   - Opens `Edit Details` on `FIN-BRV-CLB-CHA-34X34` with zero `unauthorized`
     errors
3. Loading `/embed/admin/master-catalog` with **no** `?key=` and **no** cookies
   renders the clean dark Executive Auth Gate (not a half-broken `0/16` shell).
4. Simulated `/api/...` failures **never** unmount the 7-pill Stack Health Bar.

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
5. `src/proxy.ts`
6. `src/app/embed/`
7. `src/app/api/`
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
- No schema drops; additive only if required
- Never modify tests to fake Phase 2 DB proof
- Never delete a paid order; ledger failure is retried, not rolled back
- Katana remains single live tenant — no sandbox writes from this phase
- Edits strictly inside `allowed_files` (Track 2)
