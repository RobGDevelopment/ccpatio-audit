# BUILD_PLAN — `katana-inventory-resilience-fix`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 22 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)

## Intent

Eliminate 30s Katana rate-limit hangs on Current Inventory (`/embed/showroom`) via
instant Supabase-only UI reads; fix shared Katana rate-limit bucket
starvation / TTL deadlocks; add priority token reserve + checkpointed sync
recovery; wire bucket reset + live staleness into Executive Stack Health.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`).

## Diagnosed root cause (pre-fix)

The exact emitter is `src/server/sre/katana-throttle.ts` →
`createKatanaSharedBucketPacer` → `acquireToken(..., maxWaitMs: 30_000)` throwing:

> `Katana shared rate-limit bucket: no token available after ${waited}ms. Deferring.`

Contributing mechanisms:

1. **Bucket monopolization:** Postgres token bucket is capacity `1` / `1 req/s`
   (`KATANA_BUCKET_*`). Bulk inventory pagination
   (`src/server/stock/katana-inventory.ts` → `listResource`, up to 40 pages ×
   materials/products/variants/locations/inventory) consumes 100% of tokens for
   minutes. Interactive callers block the full `30_000ms` then throw — matching
   production `30221ms`.
2. **Unclamped 429 backoff:** `src/lib/katana.ts` computes
   `waitMs = resetAt * 1000 - Date.now()` assuming `X-Ratelimit-Reset` is epoch
   **seconds**. Poisoned / ms-scale / huge values (and the twin path in
   `src/inngest/katana-step.ts`) are not clamped to `≤ 65_000ms`, so a single
   429 can sleep far beyond the intended Katana window and keep the bucket
   starved.
3. **Showroom still surfaces the throw:** Failed
   `refreshShowroomSnapshotFromKatana` writes the raw `KatanaApiError` message
   into `katana_sync_meta.last_error`. Sales UI renders that string as the
   message / banner. Hub reads never call Katana, but the **badge ignores age**
   (`stale` is only set on missing `last_synced_at` / in-flight failure), so a
   48h-old `Hub synced` stays **green**.
4. **All-or-nothing persist:** Snapshot replace is one transaction after the
   full Katana crawl; serverless timeout mid-crawl leaves `last_synced_at`
   frozen for days with no incremental checkpoint.

## Workstreams

### 1. Harden `Katana shared rate-limit bucket` (self-healing)

**Files:** `src/server/sre/token-bucket.ts`, `src/server/sre/katana-throttle.ts`,
`src/lib/katana.ts`, `src/inngest/katana-step.ts`, `scripts/`

- Clamp every `retryAfter` / `waitMs` / `blockedUntil` derivation to a hard
  ceiling of **`≤ 65_000ms`** (normalize epoch-seconds vs epoch-ms vs delta-ms).
- Enforce short self-heal semantics on bucket state:
  - Prefer atomic refill that cannot leave tokens permanently `< 1`
    (clamp negative balances; treat absurd `updated_at` skew as full refill).
  - Idempotent **`resetKatanaRateLimitBucket()`** helper that resets
    `rate_limit_buckets` row for `katana:api` (and any sync-lock key) without
    touching Katana ERP records.
  - Ops script under `scripts/` to clear wedged bucket/lock state via
    `.env.local` `POSTGRES_URL` when reachable.
- **Priority Lane:** reserve interactive tokens so `Place Hold` and executive
  `Run Katana Sync Now` / `Reset Bucket & Sync Katana Now` never starve behind
  bulk pagination. Bulk callers use the standard lane; interactive callers use
  `priority: true` (or a dedicated priority key) with short / zero blocking wait
  for reads and a reserved capacity share for mutations.
- Interactive **read** paths that accidentally hit the pacer must fail fast
  (`maxWaitMs: 0` or tiny) — never block UI for 30s.

### 2. Decouple `/embed/showroom` from live Katana (`0ms` blocking)

**Files:** `src/app/embed/showroom/`, `src/app/showroom/stock/`,
`src/server/showroom/`, `src/server/stock/showroom-snapshot.ts`,
`src/app/api/katana/`, `src/app/api/embed/`

- Showroom page loads, tab switches, and GET read APIs serve **only** from
  Supabase Postgres Hub cache (`readShowroomSnapshotFromHub`) — target
  **`< 200ms`**, hard assert **`< 1s`**, **zero** `30_000ms` token waits.
- When `last_synced_at` exceeds freshness threshold, fire a **non-blocking**,
  **deduplicated** background sync trigger (debounce/lock key so N pageviews
  enqueue ONE sync). Never await Katana on the request path.
- Sanitize operator-facing copy: never expose raw developer strings such as
  `Katana shared rate-limit bucket: no token available after 30221ms`.
- Fix `Hub synced` badge semantics on `/embed/showroom`:
  - **Green:** age `< 30 minutes`
  - **Amber:** `30m – 2h` → label `Refreshing in background…`
  - **Red:** `> 2h` → `Snapshot Stale — Background Sync Queued` + manual
    non-blocking `Refresh` button

### 3. Checkpointed background sync + Executive Control Center

**Files:** `src/server/stock/`, `src/server/ecommerce/executive-stack-health.ts`,
`src/app/embed/admin/master-catalog/`, Inngest/cron callers already in
`allowed_files`

- Persist stock rows + sync telemetry **incrementally per chunk/page** so a
  serverless timeout never discards progress or leaves `Hub synced` days behind.
- Wire Katana bucket health (`tokensAvailable`, `cooldownMs`, `lastSyncedAt`,
  staleness threshold) into the **Katana MRP** pill on
  `/embed/admin/master-catalog` Executive Control Center:
  - Pill **Amber/Red** when Hub synced `> 2h` stale **or** bucket throttled.
  - Diagnostic drawer action: **`Reset Bucket & Sync Katana Now`** (reset
    bucket/lock → enqueue/dedupe sync; still honor `*_MODE` /
    `DOWNSTREAM_MUTATIONS` — no flag flips, no ERP mutations beyond existing
    read/sync paths).

### 4. Verification

**Target Vitest:**

```bash
npx vitest run tests/katana-inventory-resilience.test.ts
```

Assertions:

1. `/embed/showroom` (and sales inventory loader) returns cached stock
   immediately (`< 1s`) with zero `30221ms` wait and zero raw rate-limit error
   banner even when the Katana bucket is 100% exhausted.
2. Poisoned / huge `Retry-After` / `X-Ratelimit-Reset` values clamp to
   `≤ 65_000ms`; expired / wedged locks self-heal via reset helper.
3. Priority tokens succeed for interactive callers during bulk background load.
4. `Hub synced` badge turns Amber/Red at `>30m` / `>2h`; Executive Control
   Center `Katana MRP` pill reflects staleness + throttled bucket accurately.

**Gate sequence:**

1. Target Vitest green
2. `npm run qa:lifecycle` → `exit_code: 0`
3. Sync `expected_blast_radius` in `.cursor/phase.lock` + this file
   (`tolerance: 0`, exclude `.cursor/aar.json`)
4. `node .cursor/skills/aar/scripts/emit.mjs`
5. `node .cursor/skills/qca/scripts/qca.mjs` → `CERTIFIED` (`audit_exit: 0`);
   paste verbatim QCA JSON + brief summary of the `30221ms` wedge cause

## Allowed files

1. `.cursor/phase.lock`
2. `.cursor/session-stamp.json`
3. `.cursor/aar.json`
4. `BUILD_PLAN.md`
5. `src/app/embed/showroom/`
6. `src/app/embed/admin/master-catalog/`
7. `src/app/showroom/`
8. `src/app/api/`
9. `src/components/`
10. `src/lib/`
11. `src/server/`
12. `src/inngest/`
13. `scripts/`
14. `tests/`
15. `e2e/`

## Target test

```bash
npx vitest run tests/katana-inventory-resilience.test.ts
```

## Hard constraints

- No `*_MODE` / `DOWNSTREAM_MUTATIONS` flag flips (`log` / `false` stay)
- Reset helpers may clear Hub Redis/Postgres **rate-limit & sync-lock** state
  only — **NEVER** mutate Katana ERP records
- No hard-deletes of middleware DB business rows; snapshot upserts are additive
  / replace-within-sync only
- No schema drops; additive only if a column/table is required for checkpoint
  telemetry
- Never modify tests to fake Phase 2 DB proof
- Never delete a paid order; ledger failure is retried, not rolled back
- Katana remains single live tenant — no sandbox writes from this phase
- Edits strictly inside `allowed_files` (Track 2)
