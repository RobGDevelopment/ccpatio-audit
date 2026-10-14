# EXECUTION BLUEPRINT: PHASE 9 — SRE PRIMITIVES + ADDITIVE SCHEMA
Roadmap source: FINAL_INTEGRATION_ROADMAP.md §2, §3 (blockers), §4 steps 4 and 5.
Workflow: Agile Triad. The qca.mjs audit, .cursor/phase.lock and blast-radius file counting are RETIRED. Do not run, recreate or work around them. QC is the suites below plus a semantic review of your `git diff`.

## 0. HARD GUARDRAILS (violating any = rejected)
- Schema changes are ADDITIVE ONLY. Never run `drizzle-kit push`, never drop/alter existing columns, never wipe data.
- Do NOT run `npm run db:migrate` against the live hub DB. Compare the host in `.env.test.local` POSTGRES_URL with `.env.local`. If they are the same database, STOP at "migration generated and reviewed" and tell QC. If they differ, migrate the test DB only.
- Katana is a single live tenant with no sandbox. No test or script may call real Katana, Intuit, Clover or Resend. Mock `fetch` in unit tests.
- Never log or alert token values (access_token, refresh_token, client secret).
- Still forbidden: custom outbox, Redis/CCR leases, `effect_claims`, Trigger.dev, DLQ UI, `/api/admin/redrive`, JSONB BOM trees.
- Do NOT touch `/api/webhooks/woocommerce` (stays 410 until step 6). Do NOT register `processWooCommerceOrder` or `syncGhlOpportunity`.
- Inngest here is v4.18.1 (`triggers` live inside the function options). Verify every Inngest option name (`idempotency`, `concurrency.scope`, the `inngest/function.failed` trigger and its payload shape) against `node_modules/inngest` typings before using it. Do not rely on memory.
- Money stays integer cents; the integer-cent QBO routing is step 8 (out of scope here).

Baseline first: run `git status` and `npx tsc --noEmit`, and record whether they are clean. Do not start on a dirty/broken base without telling QC.

## TASK 0 — Ledger containment gate (live-money risk)
Files:
- NEW `src/server/pipeline/ledger-mode.ts`: `type LedgerPipelineMode = "log" | "live"`; `getLedgerPipelineMode()` reads `LEDGER_PIPELINE_MODE`, trimmed and lowercased, and defaults to `"log"` for anything unrecognized (fail closed). Model it on `src/server/pipeline/mode.ts`.
- EDIT `src/inngest/clover-sync.ts`:
  - In `log` mode, run fetch, translate and format as today, then SKIP the `push-to-qbo` step.
  - Return `{ success: true, dryRun: true, mode, qboPayload }`.
  - `console.log` a single structured line with the paymentId.
  - Do not change the payload shape or the SalesReceipt logic. That is step 8.
  - Leave a `TODO(step-8)` comment on the hardcoded `CustomerRef` and the SalesReceipt endpoint.
- EDIT `src/env.ts`: add `LEDGER_PIPELINE_MODE: z.enum(["log","live"]).default("log")`.
- EDIT `.env.example`: document it as `log`.
Edge cases: unset env must mean `log`. `LIVE`, `" live "` and `Live` must all resolve correctly. Garbage must resolve to `log`.

## TASK 1 — Additive migration `0054`
Edit `src/server/db/schema.ts`, then run `npm run db:generate` (do not hand-write the snapshot). Name the migration `0054_sre_dlq_saga_buckets`. Inspect the generated SQL: it must contain ONLY CREATE TYPE / CREATE TABLE / CREATE INDEX / ENABLE RLS. If it contains DROP or ALTER on any existing object, discard it and fix the schema.

Tables:
1. `dlq_events`
   - Columns:
     - `id` uuid pk, default random
     - `run_id` text NOT NULL **UNIQUE** (idempotent insert on Inngest handler retries)
     - `function_id` text NOT NULL
     - `event_id` text
     - `event_name` text NOT NULL
     - `error_name` text
     - `error_message` text NOT NULL
     - `error_stack` text
     - `original_event` jsonb NOT NULL
     - `alert_sent` boolean NOT NULL default false
     - `status` text enum `open` | `resolved`, default `open`
     - `created_at` and `updated_at` timestamptz
   - Index on (`function_id`, `created_at`).
2. pgEnum `saga_status`: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `COMPENSATING`, `COMPENSATED`, `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`.
3. `saga_runs`
   - Columns:
     - `id` uuid pk
     - `saga_type` text NOT NULL (`path_a_cad`, `path_b_woo`, `clover_qbo`)
     - `correlation_key` text NOT NULL
     - `status` saga_status NOT NULL default `PENDING`
     - `current_step` text
     - `paid_at` timestamptz NULL
     - `last_error` text
     - `created_at` and `updated_at`
   - UNIQUE (`saga_type`, `correlation_key`).
   - This is a status ledger only. No poller, no claim columns, no lease columns.
4. `rate_limit_buckets`: `key` text pk, `tokens` double precision NOT NULL, `updated_at` timestamptz NOT NULL default now().

RLS (all three tables):
- Use `.enableRLS()` in the Drizzle definition if drizzle-orm 0.45 supports it. If it does not, append the statements manually.
- Append the idempotent `REVOKE ALL ... FROM anon, authenticated` in the same `DO $$ ... EXCEPTION WHEN undefined_object` pattern as `0053_rls_qbo_tokens_incoming_webhooks.sql`.
- No policies (deny-all for the Data API; app access is the owner via POSTGRES_URL).

Journal: `_journal.json` must register 0054 after 0053 with a `when` greater than 0053's. `npm run db:check` must pass.

## TASK 2 — Idempotency helpers
NEW `src/server/sre/idempotency.ts` (pure, no I/O):
- `inngestEventId(source, externalId, discriminator?)` returns a deterministic string such as `woo:order:123`. Reject empty, whitespace-only or `"unknown"` ids by throwing. Do NOT silently fall back to "unknown" like the legacy Woo code did.
- `katanaOrderNo(source, externalId)`: first read `src/server/ghl/push-factory-order.ts` around line 233 and match its existing order_no convention exactly.
- `qboRequestId(sagaKey, leg)`: deterministic, at most 50 chars (the QBO limit), a sha256 hex prefix, and the same input must give the same output. Different legs must differ.
- Export the CEL expression strings you use for Inngest function-level `idempotency` as named constants.

## TASK 3 — Global DLQ
Edit `src/server/alerts/oh-crap.ts`: add reasons `function_failed`, `qbo_token_persist_failed` and `qbo_auth_failed`, and add `"qbo"` to the source union. Do not change existing behavior.

NEW `src/inngest/dlq.ts`:
- `recordDlqEvent(input)`: `INSERT ... ON CONFLICT (run_id) DO NOTHING`; returns whether a row was inserted.
- Redaction and size cap on `original_event` before insert:
  - Strip keys matching /token|secret|authorization|password|api[_-]?key/i recursively.
  - If the JSON exceeds about 256 KB, store `{ truncated: true, bytes, keys }` instead.
  - Truncate `error_stack` to 8 KB.
- `globalDlqHandler`: id `global-dlq-handler`, trigger `inngest/function.failed`, with retries.
  - Order is: write the DB row FIRST, then `sendOhCrapAlert`, then set `alert_sent`.
  - If the alert returns `ok:false`, throw so Inngest retries. Because of the unique run_id, the retry is safe.
  - LOOP GUARD: ignore failures whose `function_id` is this handler itself. Otherwise the DLQ handler failing re-triggers itself forever.
- Register it in `inngestFunctions` in `src/inngest/functions.ts`.
- Check which registered functions already define `onFailure`. Leave them unchanged, but list them in your handback, because they will now alert twice.

## TASK 4 — QBO mutex hardening (blocker 1)
NEW `src/server/integrations/qbo/token-refresh.ts` (testable core) and wire it into `qbo/client.ts`:
- `qboRefreshLockKeys(env)` returns two int4 keys. The first is a fixed namespace constant (`hashtext('ccpatio:qbo_token_refresh')`). The second is derived from the environment (`sandbox` or `production`), so the two environments never block each other. Use `pg_advisory_xact_lock(k1, k2)`.
- `withQboRefreshLock(env, fn)` does these steps:
  - Open `getMutexDb().transaction`.
  - `SET LOCAL lock_timeout = '15s'` and `SET LOCAL statement_timeout = '30s'`.
  - Take the lock.
  - Call `fn(tx)`.
  - Inside the transaction callback use ONLY `tx`. The mutex client is `max:1`, so touching `getMutexDb()` again inside the callback deadlocks the process.
- Move plain token READS in `qboFetch` to `getDb()` so the single mutex connection is never starved by reads.
- Refresh call: `fetch` with `AbortSignal.timeout(10_000)`. Validate `expires_in`, `access_token` and `refresh_token` before use.
- API call: `AbortSignal.timeout(20_000)`.
- 401 retry path:
  - On a 401 from the QBO API, take the lock and re-read the row.
  - If `access_token` changed since the failed call, another worker already refreshed, so just retry with the new token.
  - Otherwise force a refresh.
  - Retry the API call exactly ONCE.
  - A second 401 throws a structured error and calls `sendOhCrapAlert({ reason: "qbo_auth_failed", source: "qbo" })`.
- Persist-failure alert:
  - If Intuit returned new tokens but the DB update or commit fails, call `sendOhCrapAlert({ reason: "qbo_token_persist_failed" })`, then rethrow.
  - The alert must NOT include token values.
  - Never swallow the error.
- Keep `getQboEnvironment` decoupled from NODE_ENV. Keep the existing sandbox-row fallback to the legacy `id=true` row. Do not delete `pushToQBO` (step 8 owns it).

## TASK 5 — Katana throttle (≤ 1 req/s, cross-instance)
- NEW `src/server/sre/katana-throttle.ts`:
  - Export `KATANA_TENANT_CONCURRENCY = { scope: "env", key: '"katana-tenant"', limit: 1 }`. The key is a CEL string literal, hence the nested quotes.
  - Apply it to every registered Inngest function that calls Katana: `publishApprovedProduct`, `pushApprovedFactoryOrder`, `releaseCustomJob`, `archiveKatanaVariant`, `autoReleaseExpiredHolds`, `sweepExpiredInventoryHolds`, and any others you find by grepping for Katana calls.
  - `publishApprovedProduct` currently has `concurrency: { limit: 1, key: "event.data.globalSku" }`. Inngest may allow several concurrency entries; check the typings. Preserve the per-SKU serialization IN ADDITION to the tenant limit.
- NEW `src/server/sre/token-bucket.ts` plus a Postgres-backed pacer:
  - Take one token with a SINGLE atomic SQL statement (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`).
  - Refill is time-based: capacity 1, rate 1/s. A burst never exceeds 1.
  - If no token is available, sleep the returned wait and retry, capped at about 30s total. After the cap, throw `KatanaApiError` with code `RATE_LIMIT`.
  - Run it on `getDb()`.
- Install it through the existing `setKatanaRequestPacer` hook in `src/lib/katana.ts`. The default is ON in the app runtime. It is OFF when `process.env.VITEST` is set or `KATANA_SHARED_BUCKET=off`.
  - A pacer already set by a CLI script must always win.
  - Do not break `tests/katana-rate-limit.test.ts`.
  - Note in a code comment: an in-process pacer is per-serverless-instance, the DB bucket is the cross-instance guard, and the Inngest concurrency key is the third layer.

## TASK 6 — Saga compensation rules (pure logic)
NEW `src/server/sre/saga.ts`: `planCompensation({ paid, failedLeg, createdSoId?, createdMoIds })` returns a plan only (executors come in steps 6 and 8).
- Failed ledger leg: `[{action:"retry_ledger"}]` always, never a rollback.
- Paid and any other failure: no delete actions, and the status is `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`.
- Unpaid: delete MOs FIRST (reverse creation order), THEN the SO.
- Export an `assertNeverDeletePaid` guard that throws if a plan ever contains a delete while `paid === true`.

## EDGE CASES THE BUILDER MUST HANDLE (checklist)
1. DLQ handler retries and double-delivery must not create duplicate rows or duplicate alerts after `alert_sent`. Skip the alert when it is already true.
2. The DLQ self-loop guard (Task 3).
3. Lock contention: callers waiting on the lock must re-check expiry after acquiring it (the double-checked refresh pattern). 10 concurrent callers must produce exactly 1 Intuit refresh call.
4. Transaction pooler (6543): `prepare:false` is already set. No session-level locks (`pg_advisory_lock`) in any new code. Only `*_xact_*` forms.
5. No `unstable_cache` or `revalidatePath` is needed in this phase (no UI). Do not add any.
6. Env unset or garbage means fail-closed (`log` modes, bucket on).
7. `AbortSignal.timeout` errors must surface as typed errors that Inngest can retry. Do not catch and return null.
8. Do not import `src/env.ts` into hot paths (its Proxy throws if POSTGRES_URL is missing). Read `process.env` in the way the existing code does.

## TESTS TO WRITE (vitest, in `tests/`)
- `ledger-mode.test.ts`: the env matrix from Task 0, and that `clover-sync` does not call `pushToQBO` in log mode (mock `pushToQBO` and assert zero calls).
- `sre-idempotency.test.ts`: determinism, the 50-char cap, rejection of empty and "unknown" ids, leg separation.
- `sre-dlq.test.ts`: redaction (nested secrets), size cap, the self-loop guard, and insert-then-alert ordering with a mocked alert (ok:false must throw).
- `qbo-token-refresh.test.ts` (mocked fetch plus an injected token store):
  - Double-checked refresh: 10 concurrent callers produce 1 refresh.
  - A 401 triggers exactly one retry. A changed token skips the forced refresh. A second 401 throws and alerts.
  - A persist failure alerts without tokens in the alert body, and rethrows.
  - A refresh timeout is a typed error.
- `qbo-lock-keys.test.ts` (REAL Postgres, add to `dbIntegrationTests`): the same env serializes (max 1 inside the critical section across 10 concurrent callers). Sandbox and production do not block each other. This test must NOT touch the `qbo_auth_tokens` rows; advisory locks need no table.
- `sre-token-bucket.test.ts` (REAL Postgres, use a unique `key` per run and clean up the row in `finally`): 5 concurrent takes are spaced at least about 1s apart, and a burst never exceeds 1.
- `sre-saga.test.ts`: the table of cases from Task 6, including the property that a paid saga never yields a delete.
- Schema smoke test (REAL Postgres): the three tables exist, RLS is enabled (`pg_class.relrowsecurity`), and `has_table_privilege('anon', ..., 'SELECT')` is false.

## COMMANDS TO RUN BEFORE HANDBACK (in order; paste raw output)
1. `npx tsc --noEmit`
2. `npm run db:check`
3. `npx vitest run tests/ledger-mode.test.ts tests/sre-idempotency.test.ts tests/sre-dlq.test.ts tests/qbo-token-refresh.test.ts tests/sre-saga.test.ts tests/katana-rate-limit.test.ts tests/env.test.ts tests/db-connection-mode.test.ts tests/sre-hardening-check.test.ts`
4. DB-backed tests (test DB only, after the host check in Guardrails): `npx dotenv -e .env.test.local -e .env.local -- vitest run tests/qbo-lock-keys.test.ts tests/sre-token-bucket.test.ts`
5. `npm run qa:lifecycle` (Playwright starts `npm run dev:pim` itself; read `playwright.config.ts` first). Paste the full raw terminal output ending in exit code 0. If any phase fails, fix and re-run without asking.
Also run `npx vitest run` (the full suite) once and report any NEW failures versus the baseline.

## HANDBACK REPORT FORMAT
- Baseline (git status and tsc result before you started).
- List of files created and modified.
- Whether the migration was applied anywhere, and to which DB host (hostname only).
- Registered functions that already had `onFailure` (the double-alert list).
- Any Inngest option you could not verify in the typings.
- The raw output of every command above.
- Anything you deliberately did NOT do.

## OUT OF SCOPE (do not start)
Step 6 (Woo route activation and lifting the 410), step 7 (CAD callback, `waitForEvent`, `maxDuration`), step 8 (integer-cent QBO routing, Journal Entry / Customer Deposit, rounding-clearing account, replacing the SalesReceipt), step 9 (cutover), Clover raw-body and `timingSafeEqual` verification (step 8 pre-work), and refactoring `withAdvisoryLocks`.
