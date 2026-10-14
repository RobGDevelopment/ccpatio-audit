# EXECUTION BLUEPRINT: PHASE 10 — PATH B LINK (WOOCOMMERCE INGRESS) + PHASE 9 DEBT PAYDOWN
Roadmap source: FINAL_INTEGRATION_ROADMAP.md §1 (Path B), §2 (raw-body verification, Katana limits, idempotency, DLQ), §3 blocker 2 (saga compensation), §4 step 6.
Governance: CLAUDE.md "Binding source of truth" amendment (2026-10-12). It lifts the Phase 0 `410` on `/api/webhooks/woocommerce` at roadmap step 6 and requires the route to ship in `log` mode.
Workflow: Agile Triad (Architect writes this blueprint, Builder implements, QC verifies against the suites below plus a semantic review of `git diff`). `qca.mjs`, `.cursor/phase.lock` and blast-radius file counting stay RETIRED. Do not run, recreate or work around them.

## 0. WHAT ROADMAP STEP 6 ACTUALLY REQUIRES
The roadmap is one line ("6. Path B Link: Activate `/api/webhooks/woocommerce`."). The binding requirements are the sum of these clauses:
1. §1 Path B: WooCommerce fires a webhook to `/api/webhooks/woocommerce`. Inngest unpacks the Woo payload and structures the BOM against `finished_goods_catalog`. Inngest pushes a standardized Sales Order (and dependent MOs) to Katana. Financial data is routed by Inngest as a read-only ledger entry to QBO.
2. §2 Raw body: the route executes `req.text()` ONCE, verifies the signature, and only THEN runs `JSON.parse`. Use `timingSafeEqual`.
3. §2 Katana: at most 1 request/second (`concurrency: { scope: "env", key: '"katana-tenant"' }` plus the shared token bucket).
4. §2 Idempotency: function-level idempotency, an Inngest event id, a Katana `order_no` lookup, and the QBO `requestid`.
5. §2 DLQ: exhausted failures land in `dlq_events` and alert through `sendOhCrapAlert`.
6. §3 blocker 2: retry the ledger leg, NEVER delete a paid order, delete MOs before SOs strictly pre-payment, and use `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`.
7. CLAUDE.md: the `410` is lifted by this step and the route ships in `log` mode. Inngest-native, gated by a mode flag, additive schema only.

Explicitly NOT step 6 (do not start): integer-cent QBO routing, Journal Entry / Customer Deposit and the rounding-clearing account (step 8), CAD callback / `waitForEvent` / `maxDuration` (step 7), the cutover checklist and $1 tests (step 9), Clover raw-body verification (step 8 pre-work), refactoring `withAdvisoryLocks`.

## 1. HARD GUARDRAILS (violating any = rejected)
- Schema changes are ADDITIVE ONLY. Phase 10 is expected to need NO new migration (`dlq_events`, `saga_runs`, `rate_limit_buckets` already exist from 0054). If you believe you need one, STOP and ask QC. Never run `drizzle-kit push`, never drop/alter existing columns, never wipe data.
- Do NOT run `npm run db:migrate` or any write/seed script against the live hub DB.
- Katana is a single live tenant with no sandbox. No test or script may call real Katana, Intuit, Clover, WooCommerce or Resend. Mock `fetch` and the Katana client in unit tests. The new route must make ZERO Katana calls itself. Katana is reached only from the Inngest function, through `katanaFetch`.
- Never log, persist or alert secrets (the Woo webhook secret, `access_token`, `refresh_token`, Authorization headers). Never echo a DB URL: print user and host only, never the password.
- Still forbidden: custom outbox, Redis/CCR leases, `effect_claims`, Trigger.dev, DLQ UI, `/api/admin/redrive`, JSONB BOM trees, visual field mappers, auto-Approve of catalog products from CAD.
- Money stays integer cents in anything new you add. No QBO routing changes (step 8).
- Do NOT import `pushToQBO` or anything from `src/server/integrations/qbo/*` from any new WooCommerce module (a test enforces this, see Task 9).
- Do NOT register `syncGhlOpportunity`. It stays unregistered. Only `processWooCommerceOrder` is being activated, and only after the rewrite in Task 7.
- Never delete a paid order. A ledger failure is retried, not rolled back.
- ROUTE THROUGH THE PHASE 9 SRE PRIMITIVES (mandatory, reviewed by QC line by line):
  - Global DLQ (`src/inngest/dlq.ts`): every new Inngest function relies on `globalDlqHandler` for exhausted-retry alerting. New code must NOT call `sendOhCrapAlert` from an `onFailure` hook. See Task 3 for why.
  - Katana throttle (`src/server/sre/katana-throttle.ts`): the Woo function carries `concurrency: KATANA_TENANT_CONCURRENCY` (add a per-order entry beside it if the typings allow it), and every Katana call goes through `katanaFetch` so the shared token bucket applies. No raw `fetch` to Katana.
  - Saga status ledger (`saga_runs`) with the rules in `src/server/sre/saga.ts` (`planCompensation`, `assertNeverDeletePaid`). Every Woo order gets exactly one `saga_runs` row of type `path_b_woo`.
  - Idempotency helpers (`src/server/sre/idempotency.ts`): `inngestEventId`, `katanaOrderNo`, `IDEMPOTENCY_BY_EVENT_ID`. No hand-rolled keys, no `"unknown"` fallback.
- RESPECT THE MODE GATES (fail closed):
  - `ORDER_PIPELINE_MODE` (`src/server/pipeline/mode.ts`, default `log`) gates Katana SO/MO mutation. `canMutateKatanaOrders(mode)` is true only for `live`. `approve` behaves like `log`.
  - `LEDGER_PIPELINE_MODE` (`src/server/pipeline/ledger-mode.ts`, default `log`) gates every ledger (QBO) side effect. Evaluate it inside the handler on every invocation, not at module load. Unset or garbage means `log`.
  - The route ships and is merged with both modes at `log`. A live flip is step 9, not this phase.
- Inngest here is v4.18.1 (`triggers` live inside the function options). Verify every Inngest option you use against `node_modules/inngest` typings, not memory: `idempotency`, `concurrency` as an array, `onFailure`, `attempt` on the handler context, `NonRetriableError`, `RetryAfterError`, and the `inngest/function.failed` payload shape. List anything you could not verify in the handback.
- Next.js here is 16.3.2 with breaking changes. Read the relevant guide in `node_modules/next/dist/docs/` before touching the route handler, `NEXT_RUNTIME`, or `export const` route config.
- No `unstable_cache`, `revalidatePath` or `revalidateTag` is needed in this phase (no UI). Do not add any.
- Do NOT import `src/env.ts` into hot paths (its Proxy throws if POSTGRES_URL is missing). Read `process.env` the way the existing code does.

Baseline first: run `git status`, `git log -1 --oneline`, and `npx tsc --noEmit`, and record all three. Phase 9 is reported committed and pushed, so the tree should be clean apart from build output. If Phase 9 files still show as modified/untracked, tell QC before starting.

## 2. EXECUTION ORDER (do not reorder)
Foundations first, so nothing is built on an unproven or leaky primitive:
Task 1 (D1) -> Task 2 (D2, D3) -> Task 3 (D4, D5) -> Task 4 (DB suites) -> Tasks 5-9 (Woo) -> Task 10 (docs/env) -> handback commands.

---

## TASK 1 — D1: one source of truth for the Katana order number
Problem: `katanaOrderNo("woo", id)` in `src/server/sre/idempotency.ts` returns `WOO-<id>`, but `mapWooOrderToKatanaSalesOrder` (`src/lib/katana.ts`) uses `order.number ?? \`WOO-${order.id}\``. They disagree whenever Woo has sequential order numbers or a custom number. Idempotency lookups built on the helper would then miss the order the mapper actually created and a duplicate SO would be posted.

Fix:
- `katanaOrderNo(source, externalId, opts?: { number?: string | number | null })`. For `woo`/`woocommerce`: return the trimmed `opts.number` when it is a non-empty string, otherwise `WOO-<externalId>`. `ghl` is unchanged (`GHL-<id>`, matches `ghlFactoryOrderNo`).
- Note `??` lets an empty string through. The mapper currently has this latent bug (`number: ""` yields an empty `orderNo`, which `createKatanaSalesOrder` rejects with 422). The new rule is trimmed non-empty or fallback.
- Make `mapWooOrderToKatanaSalesOrder` CALL the helper (`orderNo: katanaOrderNo("woo", order.id, { number: order.number })`) so the two can never drift again. `katana.ts` importing the pure helper module is fine (no cycle: `idempotency.ts` imports only `node:crypto`).
- Cross-source collision edge case: a Woo `number` such as `1042` could equal an order_no created by another source. Task 7 handles this with a provenance check on the lookup result. Do not solve it here.

## TASK 2 — D2 + D3: Katana pacer must not hang CLIs and must fail closed
D2 (CLI scripts hang): `getDb()` in `src/server/db/client.ts` builds `postgres(url, { prepare: false })` with no `idle_timeout`, so any process that touches it (including the default shared-bucket pacer reached through `katanaFetch`) keeps the event loop alive forever. Do BOTH, they are cheap and independent:
- Add `idle_timeout: 20` and `connect_timeout: 10` to the default client (same values `getMutexDb` already uses). Keep `prepare: false`.
- Restrict the default shared-bucket pacer in `resolveRequestPacer` (`src/lib/katana.ts`) to the app runtime. Gate on `process.env.NEXT_RUNTIME` being set (verify in `node_modules/next/dist/docs/` that this is defined for route handlers and the Inngest serve route on Next 16.3.2). Outside the app runtime (tsx CLI scripts, Vitest) there is no default pacer. A pacer set with `setKatanaRequestPacer` always wins. `KATANA_SHARED_BUCKET=off` and `KATANA_E2E_MIRROR=true` still disable it. If you judge one of the two fixes unnecessary, say why in the handback instead of silently skipping it.

D3 (fail open on a missing table): `createKatanaSharedBucketPacer` in `src/server/sre/katana-throttle.ts` currently catches Postgres `42P01` (undefined table) and a missing `POSTGRES_URL`, warns once and RETURNS, which lets the request through unthrottled against the live single-tenant Katana. Fail closed:
- In the app runtime, a missing `rate_limit_buckets` table (code `42P01`, checked through the `cause` chain like today) must throw `KatanaApiError` (message states migration 0054 is missing, `code: "RATE_LIMIT_TABLE_MISSING"`, and a non-429 status such as 503 so `runKatanaStep` does not turn it into a 65s `RetryAfterError`). Also fire `sendOhCrapAlert({ reason: "unknown", source: "katana", ... })` at most once per process per 10 minutes (rate-limit the alert, not the throw). The alert failing must never mask the thrown error.
- In the app runtime, a missing `POSTGRES_URL` also throws (the app cannot function without it, and silently skipping the bucket is the unsafe path). The only supported escape hatch is the explicit `KATANA_SHARED_BUCKET=off`.
- Every other error from `acquireToken` still throws (no change).
- Inngest retries a thrown error forever up to `retries`. For the table-missing case throw something Inngest treats as non-retriable or let it exhaust into the DLQ. Verify which behaviour you get from the typings and `runKatanaStep`, and make sure a missing table cannot be retried silently for hours. Document the outcome in the handback.
- Update `tests/sre-katana-throttle.test.ts` (any test asserting fail-open) and keep `tests/katana-rate-limit.test.ts` green.

## TASK 3 — D4 + D5: single alert authority, and no silent DLQ drops
D4 (double alerts). Inngest runs `onFailure` handlers and the global `inngest/function.failed` handler for the same exhausted run, so a function with an `onFailure` that calls `sendOhCrapAlert` now alerts twice. Registered functions affected (verify by grep): `publishApprovedProduct` (alerts with an `/admin/quarantine?sku=` link) and `processCadUpload` (updates `cad_uploads` to failed, THEN alerts with an `/admin/factory-bom?sku=` link). `processWooCommerceOrder` also has one but is rewritten in Task 7. `syncGhlOpportunity` is unregistered and stays as-is.
Resolution (the DLQ is the single alert authority, no context is lost):
- Remove the `sendOhCrapAlert` call from those `onFailure` hooks. KEEP their non-alert side effects (the `cad_uploads` failed update in `processCadUpload` stays).
- Add a pure, tested resolver (new `src/inngest/dlq-context.ts`) mapping `function_id` (bare or app-prefixed, same matching trick as `isDlqHandlerFunction`) to `{ externalId, sku?, resolutionPath }` derived from the original event. Reproduce exactly what the old hooks sent: `publish-approved-product` (exportId or globalSku, `/admin/quarantine?sku=`), `process-cad-upload` (uploadId or globalSku, `/admin/factory-bom?sku=`), `process-woocommerce-order` (Woo order id, `/admin/dictionary?source=woocommerce&externalId=`). Unknown functions fall back to the current generic alert. The resolver must never throw (bad payload gives the generic alert).
- `handleFunctionFailed` uses the resolver to build the alert input. The DLQ row is still written first.
- Check whether Inngest also emits `function.failed` for the `onFailure` handler function itself (it is a separate generated function; verify in typings and docs). Make sure the loop guard still holds and a failing `onFailure` hook does not produce an infinite chain.
- List every registered function that has an `onFailure` in the handback, before and after.

D5 (events with no `run_id` silently ignored). Today `handleFunctionFailed` returns `{ status: "ignored", reason: "missing_run_id" }`, so a failure with a malformed payload vanishes with no row and no alert. Never drop. The only ignore allowed is the self-loop guard.
- Synthesize a deterministic key when `run_id` is absent: `norunid:<function_id|unknown>:<event.id if present, else the first 16 hex of sha256 of the redacted JSON of the event>`. Same input must give the same key so retries stay idempotent on the unique `run_id` column.
- Record the row, set the error message prefix `[malformed failure event: no run_id] `, `console.error` a single structured line, and alert as usual. If even the synthetic path cannot persist, throw so Inngest retries.
- Add a `DlqOutcome` variant (for example `recorded` with `synthetic: true`) and update `tests/sre-dlq.test.ts` (the line asserting `missing_run_id` is ignored must change). Keep the self-loop test.
- A missing `function_id` records `"unknown"`, it is not ignored.
- Edge case to document: if the alert cannot be sent (no `OH_CRAP_ADMIN_EMAIL`), the handler throws, retries 4 times, and the row stays `alert_sent=false`. The handler cannot alert about itself (loop guard). Emit one loud `console.error` JSON line (`tag: "dlq-alert-undelivered"`) on the final attempt (use the `attempt` context if the typings expose it). No UI, no redrive endpoint.

## TASK 4 — Un-run Phase 9 DB suites: qbo-lock-keys, sre-token-bucket, sre-schema-smoke
These three were never executed against a real database, so the lock keys, the 1 req/s bucket and the 0054 schema/RLS are still unproven. Prove them BEFORE building Woo on top.
Why they did not run: `vitest.config.ts` excludes `dbIntegrationTests` unless `RUN_DB_TESTS=1`, and explicit CLI paths do NOT override `exclude`. The Phase 9 command did not set it, so Vitest finds no test files. Also `tests/setup-env.ts` never overrides a variable that is already set, so `dotenv -e .env.test.local -e .env.local` must list the test file FIRST.

Step A. Identify the database safely. Pooler hosts (`*.pooler.supabase.com`) are SHARED across Supabase projects, so comparing hostnames alone is not enough. The project is identified by the user part (`postgres.<project-ref>`). Print user and host only (no password):
`rg -o -r '$1 @ $2' "^POSTGRES_URL=\w+://([^:]+):[^@]*@([^:/]+)" .env.test.local .env.local`
- Different user (project ref) OR different host: `.env.test.local` is a separate database, proceed to Step B.
- Same user AND host: it is the live hub DB. Proceed to Step C.

Step B (separate test DB). Apply migrations to the TEST DB only (`npx dotenv -e .env.test.local -- drizzle-kit migrate`, never with `.env.local`), after confirming Step A in the output you paste. Then run:
`npx cross-env RUN_DB_TESTS=1 npx dotenv -e .env.test.local -e .env.local -- vitest run tests/qbo-lock-keys.test.ts tests/sre-token-bucket.test.ts tests/sre-schema-smoke.test.ts`

Step C (only a live DB is available). Do NOT migrate. Migration 0054 is already applied there. The three suites are designed to be safe, which you must confirm by reading them first:
- `qbo-lock-keys` touches no table (private per-run advisory-lock namespace).
- `sre-schema-smoke` only reads the catalog.
- `sre-token-bucket` writes ONE row under a unique per-run key and deletes it in `finally`. It must never use `katana:api`. Verify the key and the cleanup in the test source before running. If either is missing, fix the test first.
Run the same command as Step B and state in the handback, in bold, that the run executed against the live DB host and why that was judged safe. QC may veto Step C. If QC vetoes it, use Step D.

Step D (PGlite equivalent, only if QC approves adding a dev dependency `@electric-sql/pglite`). PGlite is a single in-process session, so it CANNOT prove cross-connection behaviour. Use it only for `sre-schema-smoke` (tables, enum values, unique indexes; skip the `anon`/RLS-privilege assertions, there is no `anon` role) and `sre-token-bucket` (the atomic statement semantics). `qbo-lock-keys` needs real concurrent connections and must stay on real Postgres. Do not add the dependency without QC sign-off.

Acceptance: all three files report passed, none skipped, none "No test files found". If a test fails, the failure is a Phase 9 defect: fix the production code (never weaken the test, never mock the DB) and re-run. Paste the full raw output.

## TASK 5 — Woo pure helpers (no I/O)
NEW `src/server/woocommerce/ingress.ts`:
- `verifyWooWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string | undefined): boolean`. WooCommerce sends `X-WC-Webhook-Signature` = base64 of HMAC-SHA256(secret, raw body). Compare with `timingSafeEqual` after a length check (model it on `src/server/ghl/ingress.ts`, including the early `false` for a missing secret or header). Do not accept hex or a bare bearer token.
- `WOO_ORDER_EVENT = "woo.order.validated"` (the event name the existing function already listens on) and `wooEventId(order)` = `inngestEventId("woo:order", order.id, "paid")`.
- `wooDeliveryKey(headers, rawBody)`: `woo-delivery:<X-WC-Webhook-Delivery-ID>`, falling back to `woo-body:<sha256 of rawBody>` when the header is missing. Never `"unknown"`.
- `isWooPingBody(rawBody)`: true for the form-encoded ping WooCommerce sends when a webhook is saved (`webhook_id=<n>`).
NEW `src/server/woocommerce/order-state.ts`:
- `isWooOrderPaid(order): boolean`: true when `status` is `processing` or `completed`, or `date_paid` is a non-empty string. Everything else (`pending`, `on-hold`, `failed`, `checkout-draft`, `cancelled`, `refunded`) is not paid. This is an ASSUMPTION to confirm with QC: Katana SO/MO creation waits for the paid transition, so the compensation rule "delete MOs then SO" can only ever apply pre-payment and a paid order is never auto-deleted. Document it in the handback.
- `classifyWooOrder(order)`: `"paid" | "awaiting_payment" | "terminal_unpaid" | "terminal_after_paid_needs_human"` (cancelled/refunded/failed after the saga already marked it paid is a human case, never an automatic Katana delete).

## TASK 6 — The route: activate `/api/webhooks/woocommerce` in `log` mode
Edit `src/app/api/webhooks/woocommerce/route.ts` (replace the 410 body; update the header comment to cite roadmap step 6 and CLAUDE.md). `src/proxy.ts` already bypasses auth for `/api/webhooks`; do not edit it. Keep `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Handler order, in this exact order:
1. `const rawBody = await req.text()` ONCE. Never `req.json()`.
2. Secret missing (`WOOCOMMERCE_WEBHOOK_SECRET` unset/blank): respond `503 { error: "webhook_not_configured" }` and log it. Do not process.
3. Signature check via `verifyWooWebhookSignature`. Fail gives `401 { error: "invalid_signature" }`. Never log the secret or the full signature.
4. Ping: if `isWooPingBody(rawBody)` respond `200 { pong: true }` (after the signature check passed).
5. `JSON.parse(rawBody)` in try/catch. Invalid gives `400 { errors: [{ path: "(root)", message: "Body must be valid JSON" }] }`.
6. Topic filter on `x-wc-webhook-topic`: only `order.created` and `order.updated` proceed. Anything else gives `200 { ignored: true, reason: "topic" }`.
7. Validate with `parseWooOrderWebhook`. On failure: persist the raw payload to `quarantined_orders` (source `woocommerce`, external_id = the order id if readable else the delivery key, raw_payload, issues) BEFORE alerting, then `sendOhCrapAlert({ reason: "validation_failed", source: "woocommerce", ... })` using `formatQuarantineAlert`, then respond `202 { accepted: true, quarantined: true }`. NOT 400: WooCommerce auto-disables a webhook after repeated non-2xx deliveries, and a SKU problem must not kill the whole integration. Avoid piling up duplicate `pending_review` rows for the same order across redeliveries.
8. Audit row: insert into `incoming_webhooks` via a NEW additive helper `insertIncomingWebhookOnce` in `src/server/webhooks/incoming-log.ts` (`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`, returns inserted or duplicate; key = `wooDeliveryKey`). Do NOT reuse `logIncomingWebhook` here: it does select-then-insert (a concurrent redelivery hits an unhandled `23505`) and it flips an already `processed` row to `duplicate`. Leave `logIncomingWebhook` untouched for GHL.
9. Classify with `classifyWooOrder`. `awaiting_payment` gives `200 { accepted: true, awaiting_payment: true }` and NO event (the later paid `order.updated` delivery triggers the saga). Unpaid terminal states are logged and acknowledged, no event.
10. Paid: `await inngest.send({ id: wooEventId(order), name: WOO_ORDER_EVENT, data: order })`, then `202 { accepted: true, orderId, pipelineMode: getOrderPipelineMode() }`. ALWAYS send, even when the audit row was a duplicate. Reason: Inngest dedupes by event id, so re-sending is free and idempotent, whereas short-circuiting on "duplicate" loses the order whenever the first attempt inserted the row but `inngest.send` then failed. If `inngest.send` throws, respond 500 so WooCommerce redelivers, and mark the audit row `failed` with the error text.
11. A terminal state arriving AFTER the saga is paid (cancelled/refunded): send the Oh-Crap alert (`source: "woocommerce"`, message says "paid order changed to X, manual review, Katana order NOT touched") and respond 200. Never delete.
Edge: the route does no Katana, QBO or Clover I/O and no heavy work. Target a fast 2xx.

## TASK 7 — The Woo saga function (rewrite and register `processWooCommerceOrder`)
Create `src/inngest/woo-order.ts` (same pattern as `src/inngest/clover-sync.ts`: an exported, unit-testable `runWooOrderSaga({ event, step, deps })` plus the `inngest.createFunction` wrapper). Remove the old inline `processWooCommerceOrder` from `src/inngest/functions.ts` (and its dedicated `alertPipelineFailure` use) and keep only the re-export so existing imports work. Move it OUT of `unregisteredTransactionalFunctions` and INTO `inngestFunctions`. Update the stale comments in `functions.ts` and `src/app/api/inngest/route.ts` accordingly (`syncGhlOpportunity` stays unregistered).

Function config:
- `id: "process-woocommerce-order"`, `triggers: [{ event: WOO_ORDER_EVENT }]`.
- `idempotency: IDEMPOTENCY_BY_EVENT_ID`.
- `concurrency`: `KATANA_TENANT_CONCURRENCY`. If the typings allow multiple entries, also add per-order serialization (`{ limit: 1, key: "event.data.id" }`), as `publishApprovedProduct` does.
- `retries`: explicit and modest (3). NO `onFailure` alert (Task 3). If you need a side effect on terminal failure (mark the saga manual, mark the `incoming_webhooks` row `failed`), do it in an `onFailure` that does NOT call `sendOhCrapAlert`.
- Register the DLQ context resolver entry for it (Task 3).

Saga steps (each a durable `step.run`, each safe to re-run):
1. `saga-start`: parse again with `parseWooOrderWebhook` (invalid gives `NonRetriableError`, the DLQ catches it). `INSERT INTO saga_runs (saga_type='path_b_woo', correlation_key=String(order.id), status='IN_PROGRESS', paid_at=<date_paid or now>) ON CONFLICT (saga_type, correlation_key) DO NOTHING`, then read the row back. If the existing row is `COMPLETED`, return `{ duplicate: true }`. If it is `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`, return without acting and re-alert is NOT sent (the DLQ/earlier alert already covers it). Use a tiny `src/server/sre/saga-store.ts` (insert-once, `setStep`, `setStatus`, `fail`) over `getDb()`; keep `saga.ts` pure.
2. Mode gate: `const mode = getOrderPipelineMode()`. If `!canMutateKatanaOrders(mode)` (log or approve): write ONE structured `console.log` line (`tag: "woo-order-dry-run"`, orderId, orderNo, lineCount, mode), set the saga `current_step = "dry_run_logged"`, leave the status NOT `COMPLETED` (use `PENDING`), mark the audit row processed with a "dry run" note, and return `{ ok: true, dryRun: true, mode }`. A dry run must never poison the saga: orders ingested in `log` mode must still be processable after the live flip (replay tooling itself is step 9, out of scope; record the need in the handback).
3. `ensure-katana-sales-order` (live only), through `runKatanaStep` so a 429 becomes a `RetryAfterError`:
   - `orderNo = katanaOrderNo("woo", order.id, { number: order.number })` (Task 1).
   - `findKatanaSalesOrderByOrderNo(orderNo)` FIRST. Found: PROVENANCE CHECK before treating it as ours (its `ecommerce_order_id` equals `String(order.id)`, or `additional_info` carries `woo_order=<id>`). Found but not ours (cross-source order_no collision) gives a `NonRetriableError`, saga manual intervention, alert. Never adopt or overwrite a foreign SO.
   - Not found: `createKatanaSalesOrder(mapWooOrderToKatanaSalesOrder(order))` with `idempotencyKey: orderNo` added to the payload (the GHL path already does this; the Woo mapper currently omits it). Verify from the existing GHL usage and the Katana docs whether Katana actually honors `Idempotency-Key`. Do not rely on it as the only guard. Also verify whether the Woo SO needs the manufacturing `locationId` the GHL path passes (`CC_MANUFACTURING_LOCATION_ID`); do not assume.
   - Persist `current_step = "so_created"` after success.
4. `ensure-mto-orders` (live only): `createMakeToOrderManufacturingOrders` is NOT idempotent today. It POSTs `/manufacturing_order_make_to_order` once per row with no key and no pre-check, inside a single loop, so a retry after row k succeeded creates duplicate MOs for rows 1..k. Fix without changing the pure behaviour of the existing function for other callers:
   - Run ONE `step.run` PER sales-order row (`mto-row-<rowId>`), so Inngest memoizes completed rows.
   - Before POSTing a row, check whether an MO already exists for that `sales_order_row_id` (read the Katana MO listing; verify the right query parameter from the existing `src/lib/katana-mto.ts` and API usage before coding). Exists means reuse its id.
   - `createSubassemblies` stays at its default (false).
   - Persist `current_step = "mo_created"`.
5. `ledger-leg` (see Task 8). Then set the saga per Task 8 and mark the audit row `processed`.
6. Failure handling: wrap the Katana steps. On a terminal failure call `planCompensation({ paid: true, failedLeg, createdSoId, createdMoIds })` (the saga is paid by construction, Task 5), run `assertNeverDeletePaid`, set the saga to the plan's status (`SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`), write `last_error` (scrubbed, no secrets), and rethrow (never swallow) so Inngest retries and the DLQ records it. Phase 10 builds NO executor that deletes anything in Katana. `delete_mo`/`delete_so` execution stays out of scope; a paid order is a human case.
   - Retry semantics: transient Katana errors (5xx, `RATE_LIMIT`, timeouts) propagate and retry. 422 validation errors (unknown SKU, bad quantity) are `NonRetriableError`, saga manual, DLQ alert.

Return value must include `{ ok, orderId, orderNo, pipelineMode, ledgerMode, dryRun, katanaSalesOrderId?, manufacturingOrderIds? }`.

## TASK 8 — Ledger leg: a gated seam, no QBO in this phase
Step 8 owns the QBO financial routing. Phase 10 only creates the seam and the gate.
- `runWooLedgerLeg({ order, orderNo, mode = getLedgerPipelineMode() })` (pure-ish, injectable). It must NOT import or call `pushToQBO` or anything under `src/server/integrations/qbo/`.
- `mode !== "live"` (log, unset, garbage): one structured `console.log` (`tag: "ledger-containment"`, `fn: "woo-order-saga"`, mode, dryRun true, orderId). Saga `current_step = "ledger_dry_run"`.
- `mode === "live"`: STILL no QBO call (step 8 is not built). Set the saga `current_step = "awaiting_ledger_step_8"`, status `IN_PROGRESS`, and emit a loud `console.error` (`tag: "ledger-not-implemented"`). This is the explicit hand-off marker step 8 resumes from; the saga ledger is a status ledger with no poller, so step 8 will query for this marker. Do not mark `COMPLETED` while the ledger leg is unbuilt.
- Money: carry amounts as integer cents only if you carry them at all. Do not compute or send any financial payload yet.
- DECISION FOR QC: "live ledger mode creates a marker, not a QBO entry" is the safest fail-closed reading of "respect LEDGER_PIPELINE_MODE" while step 8 is unbuilt. Flag it in the handback so QC can overrule.
- If a ledger failure ever occurs in a later phase it is retried per `planCompensation` (`retry_ledger`) and never rolls the order back. Add a test now that a `failedLeg: "ledger"` plan for a Woo saga contains no delete.

## TASK 9 — Static safety nets
- A test that reads the source of every new Woo module (`src/server/woocommerce/ingress.ts`, `order-state.ts`, `src/inngest/woo-order.ts`, the route) and asserts none import `qbo/client`, `pushToQBO` or `integrations/qbo`.
- A test that asserts the route source contains no `req.json()` and exactly one `req.text()`.
- A test that asserts `inngestFunctions` contains `processWooCommerceOrder` and `globalDlqHandler` and does NOT contain `syncGhlOpportunity`.
- A test that every function in `inngestFunctions` that calls Katana carries `KATANA_TENANT_CONCURRENCY` (extend the existing check if one exists, otherwise assert on the Woo function and the Phase 9 list).

## TASK 10 — Env, docs, bookkeeping
- `.env.example`: document `WOOCOMMERCE_WEBHOOK_SECRET` (already present, add a comment that it is the secret entered in WooCommerce > Settings > Advanced > Webhooks and that the route returns 503 without it), and restate `ORDER_PIPELINE_MODE=log` and `LEDGER_PIPELINE_MODE=log` as the shipping defaults for this route. Do not add secrets or real values.
- `src/env.ts`: add `WOOCOMMERCE_WEBHOOK_SECRET` as optional only if the file already types sibling webhook secrets (it must not become required, and `src/env.ts` must stay out of hot paths).
- Update the stale 410 wording in comments (`route.ts`, `functions.ts`, `src/app/api/inngest/route.ts`). Do NOT edit `FINAL_INTEGRATION_ROADMAP.md`. If `docs/MDM_MASTER_BLUEPRINT.md` still describes the Woo route as a retired 410, add a short "superseded by roadmap step 6" pointer there rather than rewriting it.

---

## EDGE CASES THE BUILDER MUST HANDLE (checklist)
1. WooCommerce disables a webhook after repeated non-2xx deliveries: only a bad signature, a missing secret, unparseable JSON, or a persistence failure may return non-2xx. SKU validation problems return 202 + quarantine.
2. Redelivery of the same delivery id, and the same order arriving in `order.created` AND `order.updated`: exactly one saga row, one Katana SO, one set of MOs (event id, function idempotency, `saga_runs` unique key, Katana order_no lookup are four independent layers; prove each in a test).
3. Race: two deliveries of the same paid order land simultaneously. The unique index on `saga_runs` decides; the loser must not throw an unhandled `23505`.
4. Order arrives unpaid (`pending`/`on-hold`) then updates to `processing`: no event until paid, then exactly one. A cancelled-before-paid order never reaches Katana.
5. Order cancelled/refunded AFTER the saga ran: alert + human, zero deletes, zero Katana calls.
6. Woo `number` differs from `id`, is empty, or collides with another source's order_no (Task 1 and the provenance check in Task 7).
7. `inngest.send` fails after the audit row insert: 500 to Woo, row marked failed, redelivery re-sends (never short-circuit on duplicate).
8. Katana 429 / shared-bucket `RATE_LIMIT` / table-missing: 429 and `RATE_LIMIT` retry via `RetryAfterError`; table-missing fails closed (Task 2) and cannot loop silently.
9. Partial MO creation then retry: no duplicate MOs (Task 7 step 4).
10. `log` or `approve` mode: the saga records a dry run, does not mark COMPLETED, does not call Katana at all (assert `fetch`/Katana mock call count is 0), and the ledger seam does not run a QBO call in any mode.
11. `ORDER_PIPELINE_MODE` and `LEDGER_PIPELINE_MODE` unset, empty, `" LIVE "`, `Live`, garbage: `LIVE`/`" live "` resolve to live; garbage and empty resolve to `log` (both gates, fail closed).
12. DLQ: a Woo run that exhausts retries produces exactly one `dlq_events` row and exactly one alert, with the Woo-specific resolution link; the `onFailure` hook (if any) sends none (Task 3).
13. Event payload size: Woo orders with large `meta_data` may be big. The DLQ row is size-capped and redacted already. Do not store the raw Woo payload anywhere new without the existing redaction. `incoming_webhooks.payload` follows the existing practice.
14. Transaction pooler (6543): no session-level advisory locks in anything new, `prepare: false` stays.
15. Do not catch and swallow errors. External failures must throw or return a structured error (repo rule).
16. `AbortSignal.timeout`-style errors from any new outbound call surface as typed, retryable errors, not `null`.

## FILES TO MODIFY / CREATE
Modify:
- `src/server/sre/idempotency.ts` (Task 1)
- `src/lib/katana.ts` (Task 1 mapper delegates to the helper; Task 2 pacer runtime gate)
- `src/server/db/client.ts` (Task 2 `idle_timeout`, `connect_timeout`)
- `src/server/sre/katana-throttle.ts` (Task 2 fail closed)
- `src/inngest/dlq.ts` (Task 3 D4 + D5)
- `src/inngest/functions.ts` (Task 3 remove double alerts; Task 7 remove the old Woo function, register the new one)
- `src/app/api/webhooks/woocommerce/route.ts` (Task 6)
- `src/app/api/inngest/route.ts` (comment only)
- `src/server/webhooks/incoming-log.ts` (additive `insertIncomingWebhookOnce`)
- `vitest.config.ts` (add any new DB-backed test file to `dbIntegrationTests`)
- `.env.example`, optionally `src/env.ts`, optionally `docs/MDM_MASTER_BLUEPRINT.md` pointer (Task 10)
Create:
- `src/inngest/dlq-context.ts`
- `src/inngest/woo-order.ts`
- `src/server/woocommerce/ingress.ts`
- `src/server/woocommerce/order-state.ts`
- `src/server/sre/saga-store.ts`
Do NOT touch: `drizzle` migrations or `schema.ts` (no schema change expected), `src/server/integrations/qbo/*`, `src/inngest/clover-sync.ts`, `src/app/api/webhooks/{ghl,clover,katana,sketchup}`, `src/proxy.ts`, `FINAL_INTEGRATION_ROADMAP.md`, `CLAUDE.md`.

## TESTS TO WRITE / UPDATE (vitest, in `tests/`)
Unit (always run, no DB):
- `sre-idempotency.test.ts` (UPDATE): the Woo `number` matrix (`"1042"`, `""`, `"  "`, `null`, `undefined`), `katanaOrderNo("woo", id, { number })` equals `mapWooOrderToKatanaSalesOrder(order).orderNo` for every case (the drift guard), and `ghl` unchanged.
- `sre-katana-throttle.test.ts` (UPDATE) and `db-connection-mode.test.ts` (UPDATE): table-missing (42P01, also nested under `cause`) throws `KatanaApiError` with the new code and alerts at most once per window; missing `POSTGRES_URL` in the app runtime throws; `KATANA_SHARED_BUCKET=off` still disables; outside the app runtime (`NEXT_RUNTIME` unset) there is no default pacer; an explicit `setKatanaRequestPacer` wins; `getDb` client options include `idle_timeout`.
- `sre-dlq.test.ts` (UPDATE) plus new `dlq-context.test.ts`: no-run_id synthesizes a stable key, records and alerts (never `ignored`); the same malformed event twice yields one row; missing function_id gives `"unknown"`; self-loop still ignored; resolver output matches the old hook output for `publish-approved-product`, `process-cad-upload`, `process-woocommerce-order`; resolver never throws on garbage.
- `woo-signature.test.ts`: valid base64 HMAC passes; hex digest, wrong secret, tampered body, missing header, missing secret, differing length all fail; ping detection.
- `woo-order-state.test.ts`: the paid/unpaid/terminal matrix.
- `woo-webhook-route.test.ts` (mock `inngest`, `getDb`, `sendOhCrapAlert`): 503 no secret; 401 bad signature; ping 200; 400 bad JSON; topic ignored; invalid SKU gives 202 + `quarantined_orders` insert BEFORE the alert; unpaid gives 200 and NO `inngest.send`; paid gives `inngest.send` with `id === "woo:order:<id>:paid"`; duplicate audit row STILL sends; `send` failure gives 500; post-paid cancel gives alert and no send.
- `woo-order-saga.test.ts` (mocked Katana client, injected saga store and ledger mode): log and approve mode make zero Katana calls and leave the saga `PENDING`/`dry_run_logged`; live mode with an existing foreign `order_no` gives `NonRetriableError`; live mode with an existing own SO makes zero create calls; MTO per-row retry makes no duplicate create; 422 gives non-retriable plus manual status; transient error propagates; `planCompensation({ paid: true, ... })` never yields a delete; ledger seam in log makes the dry-run marker, in live creates the `awaiting_ledger_step_8` marker, and never imports or calls QBO.
- `woo-static-guards.test.ts`: the Task 9 source assertions.
- `ledger-mode.test.ts` (UPDATE if needed): confirm the `LIVE` / `" live "` / `Live` / garbage matrix still holds; add `getOrderPipelineMode` equivalents if absent.
DB-backed (add to `dbIntegrationTests`; run only under Task 4 rules, unique keys per run, clean up in `finally`, never touch real rows):
- `tests/qbo-lock-keys.test.ts`, `tests/sre-token-bucket.test.ts`, `tests/sre-schema-smoke.test.ts` (Task 4, existing, must pass).
- `woo-saga-store.test.ts` (new, real Postgres): concurrent `insert-once` on one `(path_b_woo, <unique key>)` yields exactly one row and no thrown `23505`; `insertIncomingWebhookOnce` concurrent duplicates yield one inserted and the rest duplicate and do not flip a `processed` row; cleanup in `finally`.

## COMMANDS TO RUN BEFORE HANDBACK (in order; paste RAW output of each)
0. Baseline, before any edit: `git status`, `git log -1 --oneline`, `npx tsc --noEmit`
1. `npx tsc --noEmit`
2. `npm run db:check`
3. Host identification for Task 4 (user and host only, no password): `rg -o -r '$1 @ $2' "^POSTGRES_URL=\w+://([^:]+):[^@]*@([^:/]+)" .env.test.local .env.local`
4. Unit suites: `npx vitest run tests/sre-idempotency.test.ts tests/sre-katana-throttle.test.ts tests/katana-rate-limit.test.ts tests/db-connection-mode.test.ts tests/sre-dlq.test.ts tests/dlq-context.test.ts tests/sre-saga.test.ts tests/ledger-mode.test.ts tests/woo-signature.test.ts tests/woo-order-state.test.ts tests/woo-webhook-route.test.ts tests/woo-order-saga.test.ts tests/woo-static-guards.test.ts tests/env.test.ts tests/sre-hardening-check.test.ts tests/qbo-token-refresh.test.ts tests/sre-token-bucket.test.ts`
   (`sre-token-bucket` is DB-excluded without `RUN_DB_TESTS=1`, drop it from this list if Vitest reports it excluded, it runs in step 5.)
5. DB-backed suites per Task 4: `npx cross-env RUN_DB_TESTS=1 npx dotenv -e .env.test.local -e .env.local -- vitest run tests/qbo-lock-keys.test.ts tests/sre-token-bucket.test.ts tests/sre-schema-smoke.test.ts tests/woo-saga-store.test.ts`
6. `npm run qa:lifecycle` (read `playwright.config.ts` first; Playwright starts `npm run dev:pim` itself). Paste the FULL raw terminal output ending in exit code 0. If any phase fails, fix and re-run without asking.
7. `npx vitest run` (full suite) once. Report any NEW failures versus the baseline.
8. `git status` and `git diff --stat` (final).

## HANDBACK REPORT FORMAT
- Baseline (git status, last commit, `tsc` result before you started).
- Files created and modified, mapped to the task numbers above.
- Which database each DB-backed run executed against (user and host only, no password), whether Task 4 used Step B, C or D, and whether any migration was applied (none expected).
- Task 2: which of the two D2 fixes you applied, what you verified about `NEXT_RUNTIME`, and what happens to a Katana call when `rate_limit_buckets` is missing (alert + throw, retry behaviour).
- Task 3: the list of registered functions with an `onFailure` BEFORE and AFTER, and proof there is one alert per exhausted run.
- Inngest options you could not verify in the typings.
- Decisions made that QC must confirm: the paid-status rule (Task 5), the `awaiting_ledger_step_8` marker (Task 8), 202-not-400 for quarantined orders (Task 6), whether Katana honors `Idempotency-Key`, whether the Woo SO needs `locationId`.
- The raw output of every command above.
- Anything you deliberately did NOT do (replay tooling, QBO financials, the Katana-delete executor, the live flip).

## FINAL ACCEPTANCE (QC)
Phase 10 passes only when ALL are true: debt items D1 to D5 each have a failing-then-passing test; the three Phase 9 DB suites ran for real and passed; the route answers 2xx for accepted deliveries and never calls Katana; both mode gates default to `log` and are covered by tests; no new Woo module can reach QBO; one Woo order produces at most one `saga_runs` row, one Katana SO and no duplicate MOs under redelivery; no paid order can be deleted by any code path; `npm run qa:lifecycle` exits 0 with the raw output attached.

## OUT OF SCOPE (do not start)
Step 7 (CAD callback, `waitForEvent`, `maxDuration`), step 8 (integer-cent QBO routing, Journal Entry / Customer Deposit, rounding-clearing account, replacing the SalesReceipt, Clover raw-body and `timingSafeEqual`), step 9 (cutover, live flip, $1 tests, rollback criteria, replay of log-mode orders), an automatic Katana delete/compensation executor, a DLQ UI or redrive endpoint, refactoring `withAdvisoryLocks`, and any change to `syncGhlOpportunity`.
