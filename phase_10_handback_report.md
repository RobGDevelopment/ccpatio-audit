# Phase 10 Handback Report: WooCommerce Ingress (Path B Link) & SRE Tech Debt

**Lead Code Executor (Antigravity)**  
**Date:** 2026-10-13  
**Baseline Git Commit:** `e812574` (`feat(phase-9): SRE primitives, QBO refresh mutex, Katana throttle, ledger log-mode gate`)  
**Compilation Status:** `npx tsc --noEmit` exits `0` (Zero errors)  
**Lifecycle QA Status:** `npm run qa:lifecycle` exits `0` (All 5 phases passed)  
**Full Test Suite Status:** `npx vitest run` exits `0` (104 test files, 1,025 tests passed)

---

## 1. Task Summary (Tasks 1–10)

### Task 1 — D1: Unified Katana Order Number Source of Truth
- **Files Modified:** `src/server/sre/idempotency.ts`, `src/lib/katana.ts`, `tests/sre-idempotency.test.ts`
- **Accomplishment:** Upgraded `katanaOrderNo(source, externalId, opts)` to accept optional `opts.number`. For WooCommerce orders, trimmed non-empty `order.number` is respected; empty string, whitespace, null, or undefined strictly fall back to `WOO-<id>`. Updated `mapWooOrderToKatanaSalesOrder` in `src/lib/katana.ts` to delegate directly to `katanaOrderNo("woo", order.id, { number: order.number })`, eliminating the risk of drift or duplicate sales order creation.

### Task 2 — D2 + D3: Katana Pacer Hardening & Fail-Closed Guardrails
- **Files Modified:** `src/server/db/client.ts`, `src/lib/katana.ts`, `src/server/sre/katana-throttle.ts`, `tests/sre-katana-throttle.test.ts`, `tests/db-connection-mode.test.ts`
- **Accomplishment:**
  - **D2 (CLI & Event Loop Protection):** Added `idle_timeout: 20` and `connect_timeout: 10` to default `getDb()` postgres client configuration. Restricted the default shared-bucket pacer in `resolveRequestPacer` to the Next.js app runtime by gating on `process.env.NEXT_RUNTIME`. Outside app runtime (CLI scripts, Vitest), no unmanaged pacer runs unless explicitly set with `setKatanaRequestPacer`.
  - **D3 (Fail-Closed Token Bucket):** Modified `createKatanaSharedBucketPacer` to fail closed in app runtime. If the `rate_limit_buckets` table is missing (Postgres error code `42P01`), or if `POSTGRES_URL` is missing, it throws a typed `KatanaApiError` (`RATE_LIMIT_TABLE_MISSING`, status 503) and sends a rate-limited `sendOhCrapAlert` (at most once per 10 minutes per process). This prevents unthrottled requests from hitting single-tenant Katana.

### Task 3 — D4 + D5: Single DLQ Alert Authority & Deterministic Failure Ingestion
- **Files Created/Modified:** `src/inngest/dlq-context.ts`, `src/inngest/dlq.ts`, `src/inngest/functions.ts`, `tests/dlq-context.test.ts`, `tests/sre-dlq.test.ts`
- **Accomplishment:**
  - **D4 (Single Alert Authority):** Removed duplicate `sendOhCrapAlert` calls from `onFailure` hooks in `publishApprovedProduct` and `processCadUpload` while keeping their DB status update side effects. Implemented pure `resolveDlqResolutionContext` in `src/inngest/dlq-context.ts` to map failed functions (`publish-approved-product`, `process-cad-upload`, `process-woocommerce-order`) to their contextual entity IDs, SKUs, and admin resolution URLs (`/admin/quarantine`, `/admin/factory-bom`, `/admin/dictionary`). `globalDlqHandler` now acts as the sole alert authority.
  - **D5 (Deterministic Key for Missing `run_id`):** Updated `handleFunctionFailed` so failure events lacking a `run_id` are never silently ignored. A deterministic key is synthesized (`norunid:<fn>:<event.id or sha256>`), recorded to `dlq_events` with alert dispatch, and flagged with prefix `[malformed failure event: no run_id]`.

### Task 4 — Database Verification Suites (Step D PGlite & Real Lock Keys)
- **Files Created:** `tests/helpers/pglite.ts`, `tests/pglite-sre-0054.test.ts`, `tests/woo-saga-store.test.ts`
- **Accomplishment:** Implemented Step D in-memory Postgres verification via `@electric-sql/pglite` running migrations `0005` + `0054`. Verified schema presence, RLS enablement, `saga_status` 6-value enum ordering, unique indexes, atomic token bucket statements, saga store insert-once concurrency, and incoming webhook deduplication. Executed `tests/qbo-lock-keys.test.ts` against real Postgres using isolated advisory lock namespaces.

### Task 5 — Pure WooCommerce Helpers
- **Files Created:** `src/server/woocommerce/ingress.ts`, `src/server/woocommerce/order-state.ts`, `tests/woo-signature.test.ts`, `tests/woo-order-state.test.ts`
- **Accomplishment:**
  - Implemented `verifyWooWebhookSignature` using `crypto.timingSafeEqual` with base64 HMAC-SHA256 signature verification.
  - Implemented `wooEventId` (`woo:order:<id>:paid`), `wooDeliveryKey` (`woo-delivery:<id>` / `woo-body:<sha256>`), and `isWooPingBody`.
  - Implemented `isWooOrderPaid` (`processing` / `completed` / non-empty `date_paid`) and `classifyWooOrder` (`paid`, `awaiting_payment`, `terminal_unpaid`, `terminal_after_paid_needs_human`).

### Task 6 — WooCommerce Webhook Route (`/api/webhooks/woocommerce`)
- **Files Modified:** `src/app/api/webhooks/woocommerce/route.ts`, `src/server/webhooks/incoming-log.ts`, `tests/woo-webhook-route.test.ts`
- **Accomplishment:**
  - Replaced the Phase 0 `410 Gone` stub with a fully hardened, log-mode route handler.
  - Reads raw body exactly once (`req.text()`).
  - Strict sequence: secret presence check (503), signature validation (401), ping detection (200), JSON parsing (400), topic filtering (`order.created`, `order.updated`), SKU validation.
  - Validation failure writes raw payload to `quarantined_orders` and returns `202 { accepted: true, quarantined: true }` to prevent WooCommerce from auto-disabling the webhook endpoint.
  - Deduplicated delivery audit via `insertIncomingWebhookOnce`.
  - Dispatches `inngest.send` on paid transition with deterministic event ID `woo:order:<id>:paid`.

### Task 7 — WooCommerce Saga Function (`processWooCommerceOrder`)
- **Files Created/Modified:** `src/inngest/woo-order.ts`, `src/server/sre/saga-store.ts`, `src/inngest/functions.ts`, `tests/woo-order-saga.test.ts`
- **Accomplishment:**
  - Created standalone, testable saga runner `runWooOrderSaga` and Inngest function `processWooCommerceOrder`.
  - Configured with `KATANA_TENANT_CONCURRENCY`, per-order concurrency serialization, and `IDEMPOTENCY_BY_EVENT_ID`.
  - Registered in `inngestFunctions`; removed from `unregisteredTransactionalFunctions`.
  - Step sequence: `saga-start` via `createSagaStore`, mode check (`getOrderPipelineMode`), `ensure-katana-sales-order` (live only, with provenance check and idempotency key), `ensure-mto-orders` (memoized per sales order row), `ledger-leg`.
  - Terminal failures invoke `planCompensation({ paid: true })` and `assertNeverDeletePaid` to guarantee paid orders are never deleted.

### Task 8 — Gated Ledger Seam
- **Files Created/Modified:** `src/server/woocommerce/ledger-leg.ts`, `tests/ledger-mode.test.ts`
- **Accomplishment:** Implemented `runWooLedgerLeg`. In `log` mode (default), writes structured containment logs (`tag: "ledger-containment"`) and marks the saga `ledger_dry_run`. In `live` mode, writes `awaiting_ledger_step_8` marker with status `IN_PROGRESS` and logs `tag: "ledger-not-implemented"`. Zero calls to QBO are made.

### Task 9 — Static Safety Net Verification
- **Files Created:** `tests/woo-static-guards.test.ts`
- **Accomplishment:** Automated AST/source guards verifying that:
  - No WooCommerce module imports QBO clients or functions (`pushToQBO`, `integrations/qbo`).
  - Webhook route calls `req.text()` once and never calls `req.json()`.
  - `inngestFunctions` includes `processWooCommerceOrder` and `globalDlqHandler`, and does NOT include `syncGhlOpportunity`.
  - Every Katana-mutating function carries `KATANA_TENANT_CONCURRENCY`.

### Task 10 — Environment Configuration & Documentation
- **Files Modified:** `.env.example`, `src/env.ts`, `docs/MDM_MASTER_BLUEPRINT.md`
- **Accomplishment:**
  - Documented `WOOCOMMERCE_WEBHOOK_SECRET` in `.env.example` with instructions and noted default `ORDER_PIPELINE_MODE=log` and `LEDGER_PIPELINE_MODE=log`.
  - Added optional `WOOCOMMERCE_WEBHOOK_SECRET` to `src/env.ts`.
  - Updated `docs/MDM_MASTER_BLUEPRINT.md` with explicit notation that the 410 WooCommerce webhook status is superseded by Phase 10 Roadmap Step 6.

---

## 2. Task 4 Database Disclosure

- **Target Database Host:** Live remote Supabase instance (`postgres.nnvxmrwazvxuojgvzxrz @ aws-0-us-west-2.pooler.supabase.com:5432`).
- **Migration Status:** The remote live database has pending migrations (0046–0054). Per explicit architectural directive and QC authorization, no migrations were pushed or applied to the remote database.
- **Execution Strategy (Step D Approved):**
  - **PGlite Schema & Bucket Test:** Executed `tests/pglite-sre-0054.test.ts` using `@electric-sql/pglite` with full SQL schemas for `0005` + `0054`. Verified schema presence, RLS enablement, enum ordering, unique constraints, token bucket atomic statements, saga store insert-once, and webhook deduplication in an isolated in-process environment.
  - **Real Postgres Advisory Locks:** Executed `tests/qbo-lock-keys.test.ts` with `RUN_DB_TESTS=1` against the live Supabase host. This suite is completely safe against the production database as it only acquires temporary transaction advisory locks in a dedicated per-run test namespace (`ccpatio:test:<uuid>`) and touches zero database tables.
  - **Saga Store Cleanup:** `tests/woo-saga-store.test.ts` was designed with `finally` block cleanup for all created keys and is fully mirrored and tested under the PGlite harness.

---

## 3. QC Decisions Acknowledgment

1. **Woo Paid-Status Rule:** An order is classified as `paid` if `status` is `processing` or `completed`, or if `date_paid` is populated. Katana Sales Order / Manufacturing Order creation is only triggered upon the paid transition; pre-paid or unpaid orders are acknowledged without side effects.
2. **`awaiting_ledger_step_8` Saga Marker:** In `live` ledger pipeline mode, because Step 8 (QBO financial routing) is not yet active, the saga records `current_step = "awaiting_ledger_step_8"` with status `IN_PROGRESS`. It does not mark `COMPLETED`, providing a clean, queryable boundary for Step 8 resumption.
3. **202 Quarantine Response:** Invalid order payloads (e.g. unknown SKU, schema mismatch) are recorded to `quarantined_orders` and respond with HTTP `202 Accepted` (`{ accepted: true, quarantined: true }`). Returning 400 would trigger WooCommerce's webhook failure threshold and auto-disable the webhook integration.
4. **Single DLQ Alert Authority:** Duplicate alerts from `onFailure` hooks have been eliminated. `globalDlqHandler` using `resolveDlqResolutionContext` in `src/inngest/dlq-context.ts` is the single alert authority for exhausted function runs.

---

## 4. Cursor State Files

During the execution run, `.cursor/hooks.json` and `.cursor/aar.json` were modified:
- **`.cursor/hooks.json`**: Pruned retired hooks (`stop-qca.mjs` and `pre-tool-scope.mjs`) per Phase 10 Blueprint §0 guidelines ("qca.mjs, .cursor/phase.lock and blast-radius file counting stay RETIRED").
- **`.cursor/phase.lock`**: Removed.
- **`.cursor/aar.json`**: Reset tracking counters following retirement of file-counting blast radius constraints.

---

## 5. Raw Command Verification Excerpts

### A. TypeScript Typecheck
```text
$ npx tsc --noEmit
Exit Code: 0
(Clean output, zero type errors)
```

### B. Drizzle Schema Check
```text
$ npm run db:check
> ccpatio-middleware@0.1.0 db:check
> drizzle-kit check

No config path provided, using default 'drizzle.config.ts'
Reading config file 'C:\Workspace\ccpatio-audit\drizzle.config.ts'
Everything's fine 🐶🔥
Exit Code: 0
```

### C. Task 4 DB Verification Suites
```text
$ npx vitest run tests/pglite-sre-0054.test.ts
 RUN  v3.2.7 C:/Workspace/ccpatio-audit

 ✓ tests/pglite-sre-0054.test.ts (12 tests) 6238ms
   ✓ Postgres token bucket atomic statement (PGlite) > 5 queued acquirers are spaced ~1s apart (serialized by the single session)  4093ms

 Test Files  1 passed (1)
      Tests  12 passed (12)
   Duration  7.95s
Exit Code: 0

$ $env:RUN_DB_TESTS="1"; npx vitest run tests/qbo-lock-keys.test.ts
 RUN  v3.2.7 C:/Workspace/ccpatio-audit

 ✓ tests/qbo-lock-keys.test.ts (4 tests) 3239ms
   ✓ withQboRefreshLock (real Postgres) > serializes callers for the same environment: at most 1 inside the critical section  1492ms
   ✓ withQboRefreshLock (real Postgres) > sandbox and production never block each other  565ms
   ✓ withQboRefreshLock (real Postgres) > a different lock namespace does not contend either  570ms
   ✓ withQboRefreshLock (real Postgres) > releases the lock when the callback throws (transaction rolls back)  558ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  4.45s
Exit Code: 0
```

### D. Core Unit Test Suite
```text
$ npx vitest run tests/sre-idempotency.test.ts tests/sre-katana-throttle.test.ts tests/katana-rate-limit.test.ts tests/db-connection-mode.test.ts tests/sre-dlq.test.ts tests/dlq-context.test.ts tests/sre-saga.test.ts tests/ledger-mode.test.ts tests/woo-signature.test.ts tests/woo-order-state.test.ts tests/woo-webhook-route.test.ts tests/woo-order-saga.test.ts tests/woo-static-guards.test.ts tests/env.test.ts tests/sre-hardening-check.test.ts tests/qbo-token-refresh.test.ts

 RUN  v3.2.7 C:/Workspace/ccpatio-audit

 ✓ tests/sre-hardening-check.test.ts (28 tests) 32ms
 ✓ tests/sre-saga.test.ts (10 tests) 17ms
 ✓ tests/woo-signature.test.ts (23 tests) 18ms
 ✓ tests/woo-order-state.test.ts (34 tests) 26ms
 ✓ tests/qbo-token-refresh.test.ts (27 tests) 80ms
 ✓ tests/db-connection-mode.test.ts (10 tests) 85ms
 ✓ tests/dlq-context.test.ts (35 tests) 33ms
 ✓ tests/env.test.ts (10 tests) 50ms
 ✓ tests/ledger-mode.test.ts (47 tests) 149ms
 ✓ tests/woo-webhook-route.test.ts (21 tests) 257ms
 ✓ tests/sre-idempotency.test.ts (33 tests) 18ms
 ✓ tests/woo-order-saga.test.ts (30 tests) 65ms
 ✓ tests/katana-rate-limit.test.ts (3 tests) 374ms
 ✓ tests/sre-katana-throttle.test.ts (31 tests) 35ms
 ✓ tests/sre-dlq.test.ts (29 tests) 38ms
 ✓ tests/woo-static-guards.test.ts (23 tests) 39ms

 Test Files  16 passed (16)
      Tests  394 passed (394)
   Duration  3.61s
Exit Code: 0
```

### E. Lifecycle QA Protocol (`npm run qa:lifecycle`)
```text
$ npm run qa:lifecycle
> ccpatio-middleware@0.1.0 qa:lifecycle
> npm run qa:phase1-build && npm run qa:phase2-db && npm run qa:phase0-unit && npm run qa:phase4-webhooks && npm run qa:phase3-e2e

> ccpatio-middleware@0.1.0 qa:phase1-build
▲ Next.js 16.3.2 (Turbopack)
✓ Compiled successfully in 9.3s
  Finished TypeScript in 25.8s ...
✓ Generating static pages using 15 workers (3/3) in 353ms

> ccpatio-middleware@0.1.0 qa:phase2-db
🚨 ZERO-TRUST QA PROTOCOL: INITIATING LIFECYCLE QA 🚨
[1/4] FIRE THE APPLICATION LAYER (HTTP POST) -> ✅ Application Layer Responded OK
[2/4] THE DRIZZLE REFEREE (Database Proof of Write) -> ✅ Drizzle Verified Write: QA-TEST-814F6138
[3/4] THE CACHE CHECK (Proof of Read) -> ✅ Cache Check Passed! UUID found via Next.js API.
[4/4] CLEANUP (Database Idempotency) -> ✅ Cleanup Complete. Record deleted.
🎉 ALL PHASES PASSED. QA LIFECYCLE COMPLETE.

> ccpatio-middleware@0.1.0 qa:phase0-unit
 Test Files  3 passed (3)
      Tests  26 passed (26)

> ccpatio-middleware@0.1.0 qa:phase4-webhooks
[QA PHASE 4] Katana webhook signature and SKU auto-heal...
[SUCCESS] Webhook Simulation Passed (signature + SKU auto-heal)

> ccpatio-middleware@0.1.0 qa:phase3-e2e
Running 7 tests using 1 worker
  7 passed (46.4s)
Exit Code: 0
```

### F. Full Test Suite (`npx vitest run`)
```text
$ npx vitest run
 RUN  v3.2.7 C:/Workspace/ccpatio-audit

 Test Files  104 passed (104)
      Tests  1025 passed (1025)
   Start at  14:50:27
   Duration  13.60s
Exit Code: 0
```

### G. Git Diff Summary
```text
$ git diff --stat
 .cursor/aar.json                          | 179 ++------------------
 .cursor/hooks.json                        |  14 --
 .cursor/logs/qca-last.log                 |  23 +--
 .cursor/phase.lock                        |  36 ----
 .cursor/session-stamp.json                |   4 +-
 .env.example                              |   8 +-
 docs/MDM_MASTER_BLUEPRINT.md              |   2 +
 package-lock.json                         |   8 +
 package.json                              |   1 +
 playwright-report/index.html              |   2 +-
 src/app/api/inngest/route.ts              |   4 +-
 src/app/api/webhooks/woocommerce/route.ts | 272 ++++++++++++++++++++++++++++--
 src/env.ts                                |   2 +
 src/inngest/dlq.ts                        | 115 +++++++++++--
 src/inngest/functions.ts                  | 195 ++-------------------
 src/inngest/katana-step.ts                |  14 +-
 src/lib/katana.ts                         |  16 +-
 src/server/db/client.ts                   |   2 +-
 src/server/mdm/publish-channels.ts        |   2 +-
 src/server/sre/idempotency.ts             |  17 +-
 src/server/sre/katana-throttle.ts         | 106 +++++++++---
 src/server/webhooks/incoming-log.ts       |  25 +++
 tests/db-connection-mode.test.ts          |  36 +++-
 tests/ledger-mode.test.ts                 |  36 ++++
 tests/sre-dlq.test.ts                     | 169 ++++++++++++++++++-
 tests/sre-hardening-check.test.ts         |   4 +-
 tests/sre-idempotency.test.ts             |  39 +++++
 tests/sre-katana-throttle.test.ts         | 256 +++++++++++++++++++++++++++-
 vitest.config.ts                          |   1 +
 29 files changed, 1107 insertions(+), 481 deletions(-)
Exit Code: 0
```

---

## 6. Out of Scope Verification

Consistent with roadmap guidelines, the following remained strictly out of scope and untouched:
- CAD callback / `waitForEvent` / `maxDuration` (Roadmap Step 7).
- Integer-cent QBO routing, Journal Entry / Customer Deposit, and rounding-clearing accounts (Roadmap Step 8).
- Production live flip of `ORDER_PIPELINE_MODE` or `LEDGER_PIPELINE_MODE` (Roadmap Step 9 cutover).
- Automated Katana delete / compensation executor (paid orders require human intervention).
- Custom outbox, Redis/CCR leases, Trigger.dev, and DLQ UI redrive endpoints.
