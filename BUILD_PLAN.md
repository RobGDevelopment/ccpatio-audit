# BUILD_PLAN — `stack-live-sync-qbo-dlq-completion`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 28 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/stack-live-sync-qbo-dlq.test.ts`

## Intent

Close out the four remaining Stack Health & `/embed/showroom` backend/UI bugs from live GHL production testing:

1. **Direct awaited inbound Katana inventory pull** — kill the `"queued"` black hole that left `katana_sync_meta.last_synced_at` frozen at `2026-11-23T18:43:19.000Z`, and fix showroom staleness so `> 2h` renders **Red**.
2. **QBO `invalid_client` sanitizer + dark OAuth callback** — strip Windows/`vercel env add` whitespace/quotes, render a dark Executive HTML popup (never raw JSON), and probe live tokens so QuickBooks never fakes Green.
3. **Inngest / DLQ real-time Green refresh** — unify `openDlqCount` with the listed rows, refresh `stackHealth` after resolve/archive, and ship drawer `×` + Escape close.
4. **Woo HTML error polish + FedEx LTL Amber + 4-tab missing-dims shortcut** — strip WordPress `<p>` noise, demote dims-only FedEx to Amber, navigate cleanly into Tab 3 / Tab 1.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`). Inbound Katana `GET` → Hub Postgres is allowed; outbound Katana/Woo/QBO writes stay gated. **Never** seed/reset/cleanup that mutates `finish_intake` or `ecommerce_finishes` (Mia is certifying live). Tests use isolated `QA-TEST-*` records or mocked fixtures only.

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `src/app/embed/`, `src/app/showroom/`, `src/app/api/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Live production guardrails

| Guard | Rule |
|-------|------|
| Mia Tab 1 | No writes to `finish_intake` / `ecommerce_finishes` in seeds, resets, or test cleanup |
| Outbound modes | Leave `*_MODE=log` and `DOWNSTREAM_MUTATIONS=false` untouched |
| Katana | Inbound `GET` inventory pull only; no ERP `POST/PUT/PATCH/DELETE` |
| Schema | Additive only if needed; never `drizzle-kit push` / drops / wipes |

## Workstreams

### 1. Direct Awaited Inbound Katana Inventory Pull

**Files (expected):**  
`src/server/stock/showroom-snapshot.ts`, `src/server/stock/hub-sync-freshness.ts`, `src/server/sre/katana-throttle.ts`, `src/app/embed/admin/master-catalog/actions.ts`, `src/app/embed/admin/master-catalog/ecommerce/ExecutiveStackHealthStrip.tsx`, `src/app/embed/showroom/`, `src/app/showroom/stock/`, `src/app/api/` (manual sync / stack action route if present)

**Bug:** `RESET BUCKET & SYNC KATANA NOW` / `RUN KATANA SYNC NOW` only enqueued a background job (`priority inventory sync queued`) and never advanced `last_synced_at`. Showroom stayed Amber at ~50h instead of Red (`> 2h`).

**Fix:**

- Export `maxDuration = 60` on the Katana manual sync / stack action API route (or equivalent Server Action host path that Vercel will honor).
- Replace `enqueueBackgroundShowroomSync` in the Executive CTAs with a **direct, awaited chunked inbound `GET` pull**:
  - When `resetBucket: true`, reset wedged rate-limit bucket + release showroom sync lock first.
  - Pull current stock/variant balances via the existing `<= 65s` clamped rate-limiter / priority lane.
  - Upsert Hub inventory cache rows; set `katana_sync_meta.last_synced_at = new Date()`; clear stale `last_error`.
  - Return `{ ok: true, syncedItemsCount, lastSyncedAt, durationMs }` (not a queue toast).
- UI: inline `Syncing live Katana inventory…` spinner on the button; toast actual synced item count; `await refreshStackHealth()` so **Katana MRP** flips **Green (`Healthy · Synced just now`)**.
- `/embed/showroom` (`Current Inventory`): keep thresholds `< 30m` Green / `30m–2h` Amber / `> 2h` Red (`Snapshot Stale — Refresh`). Fix any age-math / badge copy that still shows Amber past 2h. Wire non-blocking stale refresh `fetch()` to the working inbound sync endpoint with a short DB/Redis lock (`KATANA_SYNC_LOCK_KEY` / showroom sync lock) so concurrent viewers do not stampede Katana.
- Confirm inbound pull is **not** blocked by `DOWNSTREAM_MUTATIONS=false`.

### 2. QuickBooks Online — Credential Sanitizer, Dark Callback, Honest Probe

**Files (expected):**  
`src/server/integrations/qbo/oauth.ts`, `src/server/integrations/qbo/client.ts`, `src/server/integrations/qbo/token-refresh.ts`, `src/app/api/auth/qbo/connect/route.ts`, `src/app/api/auth/qbo/callback/route.ts`, stack health probe in `src/app/embed/admin/master-catalog/actions.ts` + `src/server/ecommerce/executive-stack-health.ts`, `ExecutiveStackHealthStrip.tsx` / portal message listener

**Bug:** QBO pill Green without token verification; reconnect dumps raw JSON `invalid_client`; Verify Live Token returns HTTP 400 `invalid_client` (often from `\r\n` / quoted Vercel env values).

**Fix:**

- Shared `getSanitizedQboConfig()` that strips leading/trailing whitespace, `\r`, `\n`, and surrounding `"` / `'` from `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` (and aliases like `QBO_OAUTH_REDIRECT_URI`), and `QBO_ENVIRONMENT`. Use it in connect, callback, token refresh, and live probes.
- Connect + callback must compute the **exact same `redirect_uri`**: prefer sanitized `QBO_REDIRECT_URI` when set and origin-compatible; else canonical `${origin}/api/auth/qbo/callback`.
- **Dark Executive HTML callback** when `Accept` includes `text/html` (or standard browser OAuth redirect):
  - Success `200`: `"QuickBooks Online Connected"`; `postMessage({ type: "ccpatio:qbo-oauth-result", ok: true })` to `window.opener`; auto-close after `1200ms`; fallback **Return to Control Center** button.
  - Failure (`invalid_client` / `invalid_grant` / mismatch): dark diagnostic card with Intuit error + safe diagnostics (`environment`, `redirectUri`, `clientIdPrefix` first 6, `clientIdLength`, `clientSecretLength`, `trimmedWhitespaceOrQuotes`) and **Try Reconnect Again**. Never dump raw JSON to browser navigations; JSON only for non-HTML Accept if still needed by scripts.
- ECC listens for `ccpatio:qbo-oauth-result` and immediately refreshes `stackHealth`.
- **Honest initial probe (60s server cache):** validate stored QBO token; on `invalid_client` / `invalid_grant` / missing token mark QuickBooks **Red/Amber (`Reconnect Required`)** on load — never fake Green.

### 3. Inngest / DLQ Real-Time Green Refresh & Drawer Close UX

**Files (expected):**  
`src/app/embed/admin/master-catalog/actions.ts`, `src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx`, `ExecutiveStackHealthStrip.tsx`, DLQ helpers under `src/server/` / `src/inngest/` as needed for shared open-filter

**Bug:** Header `4 open DLQ failure(s)` while listing `6` rows; Resolve / archive empties the list but leaves header + Inngest pill Red because `stackHealth` never refreshed. Missing drawer close affordance.

**Fix:**

- Single shared open-DLQ filter predicate for `openDlqCount` in `stackHealth` **and** the open DLQ list endpoint (1:1 badge ↔ rows).
- After resolving one item **or** resolving/archiving all stale failures: re-fetch DLQ list **and** `stackHealth` so `openDlqCount → 0` and Inngest pill flips **Green (`Healthy · 0 open DLQ`)** in place.
- Visible dark `×` in the top-right of the Stack Health diagnostic drawer + `Escape` dismissal.

### 4. WooCommerce HTML Error Parsing + FedEx LTL Amber + 4-Tab Shortcut

**Files (expected):**  
Woo diagnostic builders in `actions.ts` / `src/server/` / `src/lib/`, FedEx severity in stack health (`actions.ts` / `executive-stack-health.ts`), `EcommerceCertificationPortal.tsx` (4-tab nav to Missing Dims)

**Fix:**

- Parse WordPress HTML/JSON bodies (`{"code":"internal_server_error","message":"<p>…</p>…"}`) into clean plain English, e.g. `WordPress PHP Critical Error (HTTP 500) on ccpatiodev2.primeview.com — PrimeView plugin/theme fatal error`. Keep **Re-Test Connection** and **Copy Diagnostic Report for PrimeView** working; stash raw JSON/HTML in a collapsed `<details>`.
- When FedEx API credentials are configured/healthy and the **only** warning is `N SKU(s) missing freight dims`, severity = **Amber (`Readiness Warning`)** not Red. **View N SKUs Missing Dims →** must navigate cleanly into the 4-tab portal (`Tab 3: Certified Products` filtered to `Missing Dims`, or `Tab 1: Intake` `Products Needing Media / Dims`).

### 5. Verification

**Files:** `tests/stack-live-sync-qbo-dlq.test.ts`, Playwright under `e2e/` as needed, `.cursor/phase.lock` blast sync, AAR + QCA

Prove with Vitest (+ Playwright where UI-critical):

1. `getSanitizedQboConfig()` strips `\r\n`, spaces, wrapping quotes; HTML callback is dark styled (zero raw JSON dump on browser Accept); `stackHealth` marks QBO Red/Amber on `invalid_client`.
2. Manual Katana sync runs direct inbound pull (allowed under `DOWNSTREAM_MUTATIONS=false`), updates `last_synced_at`, returns synced count; showroom Red when `last_synced_at` is `> 2h`.
3. Resolving DLQ refreshes `stackHealth` and flips Inngest Red → Green (`0 open`); `×` / Escape closes drawer.
4. Woo strips `<p>` from main summary; FedEx Amber when only dims missing; missing-dims shortcut switches portal view cleanly.

**Run order:**

1. `npx vitest run tests/stack-live-sync-qbo-dlq.test.ts`
2. `npm run qa:lifecycle` → `exit_code: 0` (no `finish_intake` / `ecommerce_finishes` mutation)
3. Sync `expected_blast_radius` in `.cursor/phase.lock` + this plan (`tolerance: 0`, exclude `.cursor/aar.json`)
4. `node .cursor/skills/aar/scripts/emit.mjs`
5. `node .cursor/skills/qca/scripts/qca.mjs` → `CERTIFIED` (`audit_exit: 0`); paste verbatim QCA JSON

## Acceptance criteria

| # | Criterion |
|---|-----------|
| A1 | Katana Executive CTAs await inbound pull, return `syncedItemsCount` / `lastSyncedAt`, refresh pill to Green |
| A2 | Showroom badge: `<30m` Green · `30m–2h` Amber · `>2h` Red; stale refresh uses locked inbound endpoint |
| A3 | QBO env sanitized everywhere; HTML dark callback; honest 60s-cached token probe |
| A4 | DLQ count == listed open rows; resolve refreshes pill to Green; drawer `×` + Escape |
| A5 | Woo plain-English summary + `<details>` raw; FedEx dims-only → Amber; missing-dims 4-tab nav works |
| A6 | Target Vitest + `qa:lifecycle` exit 0; QCA `CERTIFIED`; blast radius synced; Mia tables untouched |

## Out of scope

- Flipping any outbound `*_MODE` / `DOWNSTREAM_MUTATIONS`
- Katana/Woo/QBO outbound mutations beyond OAuth token exchange
- Seeds or cleanup touching `finish_intake` / `ecommerce_finishes`
- DLQ admin redrive UI / `/api/admin/redrive` (still forbidden)
- Schema drops or live hub wipes
