# AUTONOMOUS BUILD BLUEPRINT — CC Patio MDM Hub completion

**Document type:** Execution playbook and system prompt for an autonomous coding agent ("the Agent", e.g. Antigravity).
**Author role:** Lead Systems Architect (Cursor).
**Date:** 2026-11-03. **Baseline commit:** `3b02dc2` plus the uncommitted Phase 15 working tree.
**Status:** BINDING. Read §0 in full before touching any file. You execute exactly one Phase at a time, then STOP.

---

## 0. OPERATING CONTRACT (read first, applies to every phase)

### 0.1 Precedence

1. `FINAL_INTEGRATION_ROADMAP.md`. It is supreme (per `CLAUDE.md`).
2. `CLAUDE.md` hard guardrails and the Triad Kernel rule (`.cursor/rules/triad-kernel.mdc`).
3. `docs/BLUEPRINT_Katana_ReverseFlow_WooCommerce_DevSite_Phases15-16.md` (the **Parent Blueprint**). Sections VI and VII are binding and win over its own earlier sections.
4. This document. It orders the work and adds production-safety rules. When this document cites a Parent Blueprint section, implement that section **exactly**. Where this document and the Parent Blueprint disagree, **this document wins only on the topics it addresses explicitly**: production DB access, migration numbering, airlock hand-off, and Academy.
5. `docs/AIRLOCK_DUAL_APPROVAL.md` for the airlock (Phase 3), as amended by §3 below.

### 0.2 Verified baseline (2026-11-03). Re-verify before Phase 1; on any mismatch, HALT.

| Fact | Value | How to re-verify |
|---|---|---|
| HEAD | `3b02dc2` | `git log -1 --format=%h` |
| Active lock | `phase-15-katana-lifecycle`, `base_ref: 3b02dc2` | read `.cursor/phase.lock` |
| Uncommitted tree | 23 modified, 9 untracked (listed in `.cursor/aar.json`) | `git status --short` |
| Migration journal | 60 entries; last = idx 59, tag `0057_katana_reverse_flow`; two `0056_*` tags exist (idx 57, 58) | `src/server/db/migrations/meta/_journal.json` |
| Last snapshot | `meta/0059_snapshot.json` (untracked). Contains `katana_po_bills`, does **not** contain `factory_airlock_*` | grep the file |
| Snapshot numbering | snapshot file number = journal **idx**, not SQL tag | `meta/` |
| Production Drizzle tracker | `drizzle.__drizzle_migrations`: 45 rows; `max(created_at) = 1791139890227` = journal idx 46 = tag `0045_ecommerce_listings_slug_unique` | read-only query (operator) |
| Production objects 0046–0052, 0054 | present | read-only probes |
| Production 0053 (RLS on `qbo_auth_tokens`, `incoming_webhooks`) | **NOT applied** (`relrowsecurity = false` on both) | `pg_class.relrowsecurity` |
| Production 0055, 0056×2, 0057 | **NOT applied** (`custom_build_job_items`, `pos_receipts`, `ledger_triage`, `katana_po_bills` absent) | `to_regclass` |
| Production airlock tables | absent; **no SQL file exists**; Drizzle mirror exists at `src/server/db/schema.ts:1699-1777` | grep |
| `employee_certifications` / Academy | absent everywhere (no table, no code, no `ENTERPRISE_ACADEMY_PLAN.md`) | `rg -i academy` |
| Test DB | `.env.test.local` → `127.0.0.1:54322` (local Supabase). **Was down at audit time** | Phase 0 |
| QA gauntlet | `npm run qa:lifecycle` = build → DB proof → unit → hygiene-live → phase14-live → webhooks → e2e | `package.json` |
| Next.js / Inngest / Drizzle | 16.3.2 / 4.18.1 / orm ^0.45.2, kit ^0.31.10 | `package.json` |

### 0.3 Known hazards (each one is handled by a specific phase; do not "fix" them out of order)

| ID | Hazard | Handled in |
|---|---|---|
| **H-1** | Production `__drizzle_migrations` stops at `0045`, but 0046–0052 and 0054 objects already exist. A plain `drizzle-kit migrate` against production would re-run `0046` and fail on `CREATE TABLE "nomenclature_sku_tokens"` (already exists). | Phase 1.3, Phase 3.4 |
| **H-2** | `0053` (RLS lockdown) is missing in production. QBO OAuth tokens and raw webhook PII are not RLS-protected. **Security exposure.** | Phase 0 (operator, immediate), Phase 1.3 |
| **H-3** | `0055` runs `ALTER TYPE "saga_status" ADD VALUE 'AWAITING_DEPOSIT'` and then creates a partial index `WHERE status = 'AWAITING_DEPOSIT'` **in the same file**. Drizzle's migrator wraps all pending migrations in **one transaction** (`drizzle-orm/pg-core/dialect.js:60`). Postgres rejects use of an enum value added in an uncommitted transaction (`unsafe use of new value`). Production migrate will fail at 0055 unless the enum value is committed first. | Phase 3.4 |
| **H-4** | The Katana webhook route already emits `katana/sales_order.status_changed` and `katana/manufacturing_order.done`, but **no Inngest function consumes them**. Status updates are silently dropped today. | Phase 2A |
| **H-5** | `publishToWooCommerce` reads no mode flag, the mapper falls back to `regular_price "0.00"` and always sends `status: "publish"`. Every approved product is published live to whatever `WOOCOMMERCE_URL` points at, including $0 products. | Phase 4 |
| **H-6** | `npm run db:migrate` / `db:generate` load `.env.local` via `drizzle.config.ts` (`loadEnvConfig`). **`.env.local` points at PRODUCTION.** Any bare `npm run db:*` command is a production command. | Rule DB-1 |
| **H-7** | `submitTrainingSignOffAction` (`src/app/embed/training/actions.ts`) persists nothing; the confirmation id is `Math.random()`. | Phase 5 |

### 0.4 Global rules (a single violation fails the phase)

**Production safety**

- **DB-1. You never write to the production database.** Before ANY command that can write to Postgres (`drizzle-kit migrate`, `tsx scripts/...` with a DB client, `vitest` with `RUN_DB_TESTS=1`), print the target host with:
  `npx dotenv -e .env.test.local -- node -e "console.log(new URL(process.env.POSTGRES_URL).hostname)"`
  and proceed only if it prints `127.0.0.1` or `localhost`. Otherwise HALT.
- **DB-2.** The only allowed migrate command for you is:
  `npx dotenv -e .env.test.local -- npx drizzle-kit migrate`
  (`@next/env` does not override variables that are already set, so the test URL wins). **Never** run `npm run db:migrate`, `npm run db:push`, `drizzle-kit push`, or any `db:seed*` / `ops:*:confirm` / `migrate:*` script.
- **DB-3.** Every script you write that can mutate production must default to dry-run, require `--confirm` **and** an explicit env acknowledgement, and print the target hostname first. You never run such a script with `--confirm`. Production execution is an **operator** action, listed in an "Operator Runbook" block.
- **DB-4.** Schema changes are additive only: `CREATE TABLE`, `CREATE TYPE` (new type only), `ADD COLUMN` (nullable or with default), `CREATE INDEX`, `ENABLE ROW LEVEL SECURITY`, guarded `REVOKE`. Forbidden: `DROP`, `ALTER COLUMN`, `RENAME`, `TRUNCATE`, `DELETE`, `ALTER TYPE ... ADD VALUE` in any **new** migration. Use `text` + `CHECK` instead of a new enum value.
- **DB-5.** Never edit an existing migration SQL file or an existing snapshot. New migrations only.
- **K-1. Katana is ONE live tenant with no sandbox.** You may only issue Katana `GET`s, through `katanaFetch` inside `runKatanaStep`, for fixture capture. No Katana POST/PUT/PATCH/DELETE in any test, script, or manual run. Production Katana writes happen only through existing, flag-gated Inngest functions.
- **K-2.** Never flip any mode flag to `live` in any env file: `ORDER_PIPELINE_MODE`, `CATALOG_PUBLISH_MODE`, `GHL_FACTORY_ORDERS`, `KATANA_REVERSE_SYNC_MODE`, `WOO_CATALOG_PUBLISH_MODE`, `QBO_LEDGER_MODE`, `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`, `LEDGER_PIPELINE_MODE`, `PATH_A_GHL_SYNC_MODE`. Tests set flags in-process only.

**Code rules** (inherited from Parent Blueprint §0.3, G-1 … G-10; restated where they bite most)

- **C-1.** No swallowed errors. A `catch` must rethrow, throw `NonRetriableError`, or return a typed failure the caller turns into a throw or a non-2xx. `catch {}` and `catch (e) { console.error(e) }` are forbidden.
- **C-2.** Every new external write sits behind a `log`/`live` flag that fails closed (unset, empty, or garbage means `log`). Flags are read at runtime inside a function, never at module scope. Flag getters read `process.env` directly and never import `src/env.ts`.
- **C-3.** The global DLQ is the only alert authority. No new Inngest function defines `onFailure` that alerts.
- **C-4.** Any function with `KATANA_TENANT_CONCURRENCY` performs only Katana and local Postgres I/O. QBO and GHL calls go in separate functions (Parent D-11).
- **C-5.** Never use `getMutexDb()` outside the QBO token mutex (Parent §VI R-5).
- **C-6.** Next.js: before touching a route, server action, or cache API, read the matching guide in `node_modules/next/dist/docs/` (`AGENTS.md`). Webhook routes keep `runtime = "nodejs"` and `dynamic = "force-dynamic"`. Mutations that change a rendered page call `revalidatePath` for that page.
- **C-7.** Never weaken, skip, or delete an existing test assertion. Never mock Postgres in `qa:phase2-db`. New behavior requires new tests.
- **C-8.** Still forbidden (`CLAUDE.md` §4): V8 custom outbox, Redis CCR leases, `effect_claims`, Trigger.dev, DLQ UI, `/api/admin/redrive`, JSONB BOM trees, visual field mappers, auto-Approve of catalog products from CAD.

**Process rules**

- **P-1. Lock compliance.** Edit only paths in the active `.cursor/phase.lock` `allowed_files`. **You never edit `.cursor/phase.lock`.** Each phase below lists the lock body the operator installs before you start. If you need a file that is not listed, HALT and ask.
- **P-2. One phase per session.** Execute steps in order. At a STOP, end your turn. Resume only when the operator replies with the exact phrase `PROCEED TO PHASE <n>`.
- **P-3. Commits.** Stage explicit paths only (`git add <path> ...`). Never `git add -A` / `git add .`, `--no-verify`, `commit --amend`, `push --force`, `reset --hard`, `stash drop`, or branch deletion. Never push. Commit message format: `<phase-id>(<step>): <imperative summary>`. If `next dev` re-adds the `AGENTS.md` block, commit it with your work.
- **P-4. Iteration budget.** On a failing gauntlet, fix and re-run. If the **same** failure survives 5 full fix cycles, HALT with a report: the failing command, raw output, the hypotheses you tried, and the next hypothesis. Do not loop indefinitely and do not paper over the failure.
- **P-5. Evidence, not assertions.** "Done" means the raw, unedited `npm run qa:lifecycle` stdout ending in exit 0, plus the verbatim JSON of `node .cursor/skills/qca/scripts/qca.mjs`. QCA exit 2 (`DEFECT_REJECTED`) is never reported as certified.
- **P-6. HALT conditions.** Halt immediately on any of these:
  - a baseline mismatch (§0.2);
  - a lock violation you would need;
  - a DB-1 host check failing;
  - any need to write production or call a Katana write;
  - a VERIFY item contradicting a blueprint assumption;
  - a missing referenced file;
  - a test that can only pass by weakening it.

### 0.5 Standard handback (print this at every STOP, in this order)

1. `## Phase <n> handback`. List each step as DONE, NOT DONE, or HALTED.
2. Commits: `git log --oneline <base_ref>..HEAD`.
3. Files: `git diff --stat <base_ref>..HEAD`.
4. Lock check: `git diff --name-only <base_ref>..HEAD`, followed by the statement "all paths ⊆ allowed_files", or the offending list.
5. Validation checkpoint outputs (raw).
6. `### Proof of Life Verification`, followed by a fenced block with the raw `npm run qa:lifecycle` output (exit 0).
7. QCA JSON, verbatim.
8. VERIFY answers and open questions for the operator. Surface them; do not decide them.
9. Operator Runbook items the operator must execute before the next phase.
10. The literal line: `STOPPED. Awaiting "PROCEED TO PHASE <n+1>".`

---

## PHASE 0 — Operator pre-flight (HUMAN ONLY; the Agent does not execute this phase)

**Objective:** Make the environment safe and testable before the Agent starts.

**Operator actions:**
1. **Close H-2 now.** In the Supabase SQL editor for production, run the body of `src/server/db/migrations/0053_rls_qbo_tokens_incoming_webhooks.sql` verbatim. It is idempotent and creates no policies. Then confirm `select relname, relrowsecurity from pg_class where relname in ('qbo_auth_tokens','incoming_webhooks');` returns `true` twice. Confirm the app still works (it connects as the table owner and bypasses RLS).
2. Take a production backup or confirm PITR is enabled, and record the restore point.
3. Start the local test database (`npx supabase start`) and confirm `127.0.0.1:54322` accepts connections.
4. Install the Phase 1 lock (§1.0) with `base_ref: 3b02dc2`.
5. Confirm the Phase 0 decisions below by editing this table, or leave the defaults.

| ID | Decision | Default ruling |
|---|---|---|
| OD-1 | Airlock release granularity: release the Path A job only when **every** `custom_build_job_items` row of the job has an `approved` airlock build | **Yes**. An item without a build blocks release (fail closed). |
| OD-2 | A customer deposit on a job that has airlock builds records the deposit but does **not** emit a release | **Yes** (`AIRLOCK_DUAL_APPROVAL.md` step 6). |
| OD-3 | New migration tags: `0058_factory_airlock` (journal idx 60, `meta/0060_snapshot.json`) and `0059_employee_certifications` (idx 61, `meta/0061_snapshot.json`) | **Yes**. This supersedes the "0059_factory_airlock" name in `AIRLOCK_DUAL_APPROVAL.md` and the `schema.ts:1701` comment. |
| OD-4 | Academy first cut ports the 6 existing Katana roles from `TrainingHub.tsx` as v1 modules and mounts at a new route `/embed/academy`; `/embed/training` stays unchanged until a separate cut-over approval | **Yes** |
| OD-5 | Academy practical evidence is text plus a rubric checklist only (no file uploads in the scaffold) | **Yes** |

---

## PHASE 1 — Codebase Stabilization & Drizzle Surgery

**Objective:** Checkpoint the Phase 15 work in progress, fix the `ORDER_PIPELINE_MODE` env validation bug, and ship a verified, dry-run-first script that reconciles the production Drizzle tracker for 0046–0054.

### 1.0 Lock (operator installs; amends the active Phase 15 lock)

`phase_id: "phase-15-katana-lifecycle"`, `base_ref: "3b02dc2"`. Add to `allowed_files`:

```
docs/AUTONOMOUS_BUILD_BLUEPRINT.md
tests/env.test.ts
scripts/ops/reconcile-drizzle-ledger.ts
src/server/ops/drizzle-ledger-plan.ts
tests/drizzle-ledger-reconcile.test.ts
```

### Context & Constraints

- DB-1 … DB-5, P-1 … P-6 apply.
- Step 1.1 commits the working tree **as-is**, without refactoring it. The goal is a clean diff base for Phase 2.
- The reconcile script **never** runs DDL. It inserts tracker rows only, and only for migrations whose objects it has verified exist.
- Drizzle's migrator decides what to run by comparing each journal `when` with the **single latest** `created_at` in the tracker (`dialect.js:57-62`). It does not compare hashes. A wrong `created_at` therefore causes silent skips or re-runs. `created_at` must equal the journal `when` exactly.
- Hash parity: Drizzle computes `sha256(fs.readFileSync(<tag>.sql).toString())` (`node_modules/drizzle-orm/migrator.js`). `0054_sre_dlq_saga_buckets.sql` has **mixed line endings** (`git ls-files --eol`). Hash the bytes on disk, never normalize.

### Action Steps

**1.1 Checkpoint commit (no code changes).**
1. `git status --short` must equal the 32 paths in `.cursor/aar.json` **plus** `docs/AUTONOMOUS_BUILD_BLUEPRINT.md`, which is new and untracked. `.cursor/phase.lock` and `.cursor/session-stamp.json` may also differ. On any other difference, HALT.
2. Run `npx tsc --noEmit`. If it fails, do **not** fix anything in this step. Record the errors in the handback and continue to 1.2. The checkpoint is a snapshot, not a claim of correctness.
3. `git add` exactly those paths (including the two staged deletions and this blueprint). Commit: `phase-15(1.1): checkpoint uncommitted reverse-flow scaffolding`.

**1.2 Fix `ORDER_PIPELINE_MODE` validation (Parent C-10).**
1. Read `src/server/pipeline/mode.ts` and confirm it accepts `log | approve | live`.
2. `src/env.ts:24`: `ORDER_PIPELINE_MODE: z.enum(["log", "approve", "live"]).default("log")`.
3. In the same edit, add the Parent §I.3 variables as `z.enum(["log","live"]).optional()`: `QBO_LEDGER_MODE`, `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`, `WOO_CATALOG_PUBLISH_MODE`, `KATANA_REVERSE_SYNC_MODE`. Also add `WOOCOMMERCE_TARGET: z.enum(["devsite","production"]).default("devsite")`. Do **not** change `LEDGER_PIPELINE_MODE` or `CATALOG_PUBLISH_MODE`.
4. Document every new variable in `.env.example`, with an empty or `log` value and a one-line comment.
5. `tests/env.test.ts`: add cases for `approve` accepted, garbage rejected, and new flags optional (unset accepted).
6. Commit: `phase-15(1.2): accept ORDER_PIPELINE_MODE=approve and declare split mode flags`.

**1.3 Drizzle tracker reconciliation script.**

Create the pure planner `src/server/ops/drizzle-ledger-plan.ts` (no I/O, fully unit-tested):

```ts
export type JournalEntry = { idx: number; tag: string; when: number };
export type ProbeResult = { tag: string; ok: boolean; failures: string[] };
export type TrackerState = { lastCreatedAt: number | null; hashes: Set<string> };
export type LedgerPlan = {
  toInsert: Array<{ tag: string; hash: string; createdAt: number }>;
  stoppedAt: { tag: string; failures: string[] } | null; // first unverified migration
  alreadyTracked: string[];
};
export function planLedgerReconcile(input: {
  journal: JournalEntry[]; hashes: Record<string, string>; probes: ProbeResult[];
  tracker: TrackerState; expectedLastCreatedAt: number; upToTag: string;
}): LedgerPlan;
// Rules:
// - Throw if tracker.lastCreatedAt !== expectedLastCreatedAt (someone migrated since the audit).
// - Candidates = journal entries with when > tracker.lastCreatedAt and idx <= idx(upToTag), ascending idx.
// - Walk candidates in order; include while probe.ok; on the FIRST failing probe set stoppedAt and stop.
//   A later verified migration must never be inserted past an unverified one (the tracker is a high-water mark).
// - Skip (alreadyTracked) any candidate whose hash is already in tracker.hashes.
```

Create the I/O shell `scripts/ops/reconcile-drizzle-ledger.ts`:
- Flags: `--up-to=<tag>` (default `0054_sre_dlq_saga_buckets`; hard maximum `0054_sre_dlq_saga_buckets`), `--expect-last=<ms>` (default `1791139890227`), `--confirm`.
- Always: print `new URL(POSTGRES_URL).hostname`, the tracker row count, and the max `created_at`; run every probe inside `sql.begin("read only", ...)`; print a plan table (tag, when, hash prefix, probe result, action).
- Probes: you must read each SQL file **in full** and probe **every** object it creates or alters. Minimum set:

| Tag | Required probes |
|---|---|
| `0046_bitter_red_ghost` | table `nomenclature_sku_tokens` (+ its indexes) |
| `0047_strange_wong` | columns `ecommerce_listings.sale_price`, `ecommerce_listings.sale_ends_at` |
| `0048_reflective_human_cannonball` | type `factory_release_status`; table `factory_release_gate` |
| `0049_free_stellaris` | column `cad_uploads.geometry_snapshot` |
| `0050_even_chamber` | type `cushion_fulfillment_mode`; columns `recipe_estimates_draft.gross_freight_weight_lbs`, `.cushion_fulfillment_mode` |
| `0051_numerous_adam_warlock` | enum label `shop_drawing` on `product_asset_kind` |
| `0052_custom_build_jobs` | table `custom_build_jobs` |
| `0053_rls_qbo_tokens_incoming_webhooks` | `relrowsecurity = true` on `qbo_auth_tokens` **and** `incoming_webhooks` |
| `0054_sre_dlq_saga_buckets` | type `saga_status`; tables `dlq_events`, `rate_limit_buckets`, `saga_runs` (+ indexes) |

- With `--confirm`: require `DRIZZLE_LEDGER_RECONCILE_ACK=I_HAVE_A_BACKUP`. Insert `plan.toInsert` in **one** transaction with `insert into drizzle.__drizzle_migrations (hash, created_at) select $1, $2 where not exists (select 1 from drizzle.__drizzle_migrations where hash = $1)`. Re-read and print the new max `created_at`. Any error rolls back and exits 1.
- Without `--confirm`: exit 0 after printing. If `stoppedAt` is set, exit 3 (distinct from errors), print the failures, and print the remedy: "apply that migration's SQL by hand, then re-run".
- `package.json`: `"ops:reconcile-drizzle-ledger": "npx dotenv -e .env.local -- tsx scripts/ops/reconcile-drizzle-ledger.ts"`. **Do not** add a `:confirm` alias; the operator types `--confirm` deliberately.

Tests, in `tests/drizzle-ledger-reconcile.test.ts` (add to `qa:phase0-unit`):
- (a) The hash helper equals `readMigrationFiles({ migrationsFolder })` from `drizzle-orm/migrator` for every tag 0046–0054, including the mixed-EOL `0054`.
- (b) All probes ok gives 9 inserts, with `createdAt` equal to the journal `when`.
- (c) The 0053 probe failing gives 7 inserts (0046–0052) and `stoppedAt = 0053`. 0054 is **not** inserted even though it is verified.
- (d) A tracker last value ≠ expected throws.
- (e) A hash already present is skipped.
- (f) `--up-to` beyond 0054 is rejected.
- (g) A static check that the script contains no `CREATE`, `ALTER`, `DROP`, or `DELETE` SQL text.

Commit: `phase-15(1.3): add dry-run-first Drizzle tracker reconciliation for 0046-0054`.

### Validation Checkpoint

1. `npx tsc --noEmit` exits 0.
2. `npx vitest run tests/env.test.ts tests/drizzle-ledger-reconcile.test.ts` passes.
3. DB-1 host check, then `npx dotenv -e .env.test.local -- npx tsx scripts/ops/reconcile-drizzle-ledger.ts` (dry run against the **test** DB). Paste the plan. On a fully migrated test DB the expected result is "0 candidates".
4. `npm run qa:lifecycle` exits 0. If failures pre-date this phase, fix them only if the fix is inside the lock. Otherwise HALT and report.
5. `node .cursor/skills/qca/scripts/qca.mjs`, verbatim JSON.

### Operator Runbook (after QC, before Phase 3; never by the Agent)

1. `npm run ops:reconcile-drizzle-ledger`, a production dry run. Expect 0046–0054 all verified, provided Phase 0 step 1 applied 0053. Otherwise expect `stoppedAt = 0053`.
2. `DRIZZLE_LEDGER_RECONCILE_ACK=I_HAVE_A_BACKUP npm run ops:reconcile-drizzle-ledger -- --confirm`.
3. Re-run the dry run. Expect max `created_at` = journal `when` of `0054_sre_dlq_saga_buckets` (`1791917907682`).

### Stop & Commit

Three commits (1.1, 1.2, 1.3). Print the §0.5 handback, then STOP. `Awaiting "PROCEED TO PHASE 2".`

---

## PHASE 2 — Finish the Katana Reverse Flow

**Objective:** Consume the Katana sales-order and manufacturing-order events (H-4), persist factory status into the hub, push monotonic GHL stage moves behind `KATANA_REVERSE_SYNC_MODE`, and land the PO-receipt delta ledger with the two missing Phase 15 test files.

Phase 2 has **two stops**: 2A (status flow), then 2B (PO bill ledger).

### 2.0 Lock

The active `phase-15-katana-lifecycle` lock, unchanged from Phase 1. All Phase 2 files are already in it. Operator sets `base_ref` to the Phase 1 HEAD.

### Context & Constraints

- Implement Parent §15.0, §15.2, §15.3 (already mostly built), §15.4, §15.5, **as amended by §VI (R-1 … R-17) and §VII (S-1 … S-9)**. Read §VI and §VII **before** writing code; they move GHL I/O out of Katana-slot functions, make `katana-mo-done` hub-first with zero Katana calls, and add a reconciliation cron.
- Reverse flow is **read-only against Katana** (K-1). Hub persistence happens in both modes; only the GHL PUT is gated (Parent D-5).
- Never write `order_intake.status` or `order_intake.version`. Never move a GHL opportunity backwards, across pipelines, or out of a foreign stage (Parent D-8, §VI R-11).
- Hub lookup is by opportunity id derived from `order_no` (§VI R-2). Persistence uses compare-and-set UPDATEs on `getDb()` (§VI R-3).
- QBO vendor id comes **only** from `QBO_ID: <id>` in the Katana supplier comment. No auto-create, no name matching, no default account ids (Parent D-10, D-12, §VII S-2).
- Tests run against the **test** DB with `0057` applied via DB-2. `0057` is **not** applied to production in this phase.

### Action Steps — 2A: Order status flow

1. **Fixtures (Parent §15.0).** Already present: `manufacturing-order-done.json`, `purchase-order-received.json`, `sales-order-legacy-deleted.json`, `supplier.json`. Capture the missing ones with read-only `katanaFetch` GETs and redact PII: `sales-order-ghl.json`, `manufacturing-orders-by-so.json`, `purchase-order-partially-received.json`. Answer V-3, V-4, V-5, V-6 in the handback with the fixture path as proof.
2. **Test DB migration.** DB-1 check, then DB-2. Confirm `katana_po_bills` exists on the test DB.
3. **Create `src/server/pipeline/katana-reverse-mode.ts`**: `getKatanaReverseSyncMode()` / `canPushGhlFactoryStage()`, fail closed, same shape as `ghl-factory-mode.ts`.
4. **Create `src/server/katana/order-status.ts`** (Parent §15.4a, with the §VI R-12 `expectedMoIds` signature). Pure; status literals come from fixtures and are exported as `as const` arrays.
5. **Create `src/server/ghl/opportunity-stage.ts`** (Parent §15.4b plus all §VI R-11 closed-set rules): `stageIdFor`, `assertStageConfigDisjoint`, `moveOpportunityStage`. No Katana imports. `GhlResult` `!ok` throws.
6. **Create `src/inngest/katana-order-status.ts`** with `katanaMoDone`, `syncKatanaOrderStatus`, and `katanaOrderStatusReconcile`. Use the exact ids, triggers, concurrency, and options from Parent §VI.3 and §VII.3. `syncKatanaOrderStatus` ends after `persist-hub-status` and emits `ghl/factory_stage.push_requested` with **no stage in the payload** (§VII S-1).
7. **Create `src/inngest/ghl-factory-stage-push.ts`** (`push-ghl-factory-stage`, no `KATANA_TENANT_CONCURRENCY`, throttle 20/10 s, retries 4). It re-reads the hub row and calls `moveOpportunityStage` only when `canPushGhlFactoryStage()` returns true. For `path_a` rows, emit `PATH_A_GHL_SYNC_REQUESTED_EVENT`. First read `src/inngest/path-a-ghl-sync.ts` for the exact `data` shape.
8. **Register** all new functions in `inngestFunctions` (`src/inngest/functions.ts`). Extend the Katana-tenant `it.each` in `tests/woo-static-guards.test.ts` per Parent §VI.3 and §VII.3.
9. **Tests:**
   - Extend `tests/phase15-katana-reverse-flow.test.ts` (parsers, `deriveFactoryStage` truth table, route).
   - Create `tests/phase15-reverse-flow-resilience.test.ts` with every `QA-R*` and `QA-S*` case that is not a parser or ledger unit (Parent §VI.4).
   - Cover QA-15.4-01 … 09.
10. **`package.json` `qa:phase0-unit`:** append `tests/phase15-reverse-flow-resilience.test.ts`, `tests/ledger-mode.test.ts`, and `tests/woo-static-guards.test.ts` if absent. A test not listed there does not run in `qa:lifecycle`.
11. **`scripts/qa/simulate-webhooks.ts`:** add signed `sales_order.updated` and `manufacturing_order.done` deliveries that assert 200 + `queued: true` (Parent §15.5.2).

Commit: `phase-15(2A): consume Katana SO/MO status events and gate GHL stage push`.

### Validation Checkpoint — 2A

1. `npx vitest run tests/phase15-katana-reverse-flow.test.ts tests/phase15-reverse-flow-resilience.test.ts tests/woo-static-guards.test.ts` passes.
2. Grep gates, each expecting 0 hits:
   - `rg "fetchKatana" src/inngest/katana-order-status.ts src/inngest/ghl-factory-stage-push.ts`
   - `rg "@/lib/katana" src/server/ghl/opportunity-stage.ts`
   - `rg "onFailure" src/inngest/katana-order-status.ts src/inngest/ghl-factory-stage-push.ts`
   - `rg "getMutexDb" src/inngest/katana-order-status.ts`
3. Registration test: no duplicate function ids.
4. `npm run qa:lifecycle` exits 0, then the QCA JSON.

**STOP 2A.** Print the §0.5 handback. `Awaiting "PROCEED TO PHASE 2B".`

### Action Steps — 2B: PO receipt delta ledger

1. **Create `src/server/katana/po-receipt-ledger.ts`** (Parent §15.2a as amended by §VI R-4 and §VII S-5). It is pure. No `Date.now`, `new Date(`, or `randomUUID`.
2. **Rewire `src/inngest/katana-po-received.ts`** so it ends after `record-receipt`. The receipt is always recorded, and supplier problems are stored as `vendor_ref_error` (§VII S-7). Use a transaction-scoped advisory lock on `getDb()`.
3. **Create `src/inngest/katana-po-bill-post.ts`** with `post-katana-po-bill`, `redrive-katana-po-bill`, and `resolve-katana-po-bill` (§VII.3). No function-level idempotency on `post-katana-po-bill`. Redrive uses a new `requestid` suffix (§VII S-3).
4. **Change `src/server/integrations/qbo/client.ts`.** `requestId` and `docNumber` are required inputs. Delete the `"81"` fallback. Delete `resolveOrCreateQboVendor` (D-12). Throw on a missing bill id.
5. **Split the ledger flags in `src/server/pipeline/ledger-mode.ts`** (Parent §I.3). Rewire only the Phase 15 call sites: `clover-sync.ts`, `katana-po-received.ts`, `qbo/client.ts`. The `woo-order.ts` / `ledger-leg.ts` rewiring is deferred (§VI R-15).
6. **Create `scripts/ops/redrive-parked-po-bills.ts`** (§VII S-4). It emits typed events only, never writes the DB, never calls Katana or QBO, and is dry-run by default.
7. **Create `tests/phase15-po-receipt-ledger.test.ts`** covering QA-15.2-01 … 08 and every ledger-related `QA-R*` / `QA-S*`. Extend `tests/ledger-mode.test.ts` per QA-I-03. Do not modify existing assertions.
8. Add two identical `purchase_order.partially_received` deliveries to `simulate-webhooks.ts`, asserting two 200s.

Commit: `phase-15(2B): delta-bill Katana PO receipts and park QBO bills fail-closed`.

### Validation Checkpoint — 2B

1. The lock's `target_test`: `npx vitest run tests/phase15-katana-reverse-flow.test.ts tests/phase15-po-receipt-ledger.test.ts tests/phase15-reverse-flow-resilience.test.ts` passes.
2. Grep gates:
   - `rg '"81"' src/server/integrations/qbo/` expects 0 hits.
   - `rg "Katana Vendor" src/` expects 0 hits.
   - `rg "resolveOrCreateQboVendor" src/` expects 0 hits.
   - `rg "LEDGER_PIPELINE_MODE" src/` may hit only `ledger-mode.ts`, `env.ts`, and the deferred Woo files.
3. `npm run qa:lifecycle` exits 0, then the QCA JSON.

### Stop & Commit

**STOP 2B.** Print the §0.5 handback, including all V-1 … V-14 answers. `Awaiting "PROCEED TO PHASE 3".`

---

## PHASE 3 — Migration Execution & Airlock Hand-off

**Objective:** Write the airlock migration, prove the full 0055 → 0058 chain on the test DB, wire `factory-airlock-release` to the existing Path A Katana writer, and hand the operator an exact production migration runbook.

### 3.0 Lock (operator installs)

`phase_id: "phase-15b-airlock-handoff"`, `base_ref: <Phase 2 HEAD>`, `mode: "edit"`, `target_test: "npx vitest run tests/factory-airlock-release.test.ts tests/factory-airlock-migration.test.ts tests/path-a-release-request.test.ts tests/path-a-events.test.ts"`, `allowed_files`:

```
.cursor/phase.lock
.cursor/session-stamp.json
docs/AUTONOMOUS_BUILD_BLUEPRINT.md
docs/AIRLOCK_DUAL_APPROVAL.md
package.json
src/server/db/schema.ts
src/server/db/migrations/0058_factory_airlock.sql
src/server/db/migrations/meta/
src/inngest/factory-airlock.ts
src/inngest/functions.ts
src/server/factory-bom/airlock-actions.ts
src/server/path-a/events.ts
src/server/path-a/release-store.ts
src/server/path-a/release-request.ts
src/server/path-a/airlock-release.ts
tests/factory-airlock-release.test.ts
tests/factory-airlock-migration.test.ts
tests/path-a-release-request.test.ts
tests/path-a-events.test.ts
tests/path-a-static-guards.test.ts
tests/woo-static-guards.test.ts
```

### Context & Constraints

- **Ruling: "connect directly to the Katana writer" means a direct event hand-off to the one existing Katana writer for custom builds, `path-a-release-to-production` (`src/inngest/path-a-release.ts`).** A second Katana sales-order or manufacturing-order writer is forbidden. `factory-airlock-release` makes **zero** Katana calls, imports nothing from `@/lib/katana`, and does **not** carry `KATANA_TENANT_CONCURRENCY`.
- Katana writes stay gated by `GHL_FACTORY_ORDERS` (`canPushGhlFactoryOrders()`). `ORDER_PIPELINE_MODE` must never enable these writes (QCA B1 in `path-a-release.ts` header).
- OD-1 and OD-2 apply (Phase 0).
- `release_source` is a `text` column, so adding the value `factory_airlock` needs no SQL. It is a TypeScript and Zod change only.
- The migration is hand-checked, additive, and never pushed (DB-2 … DB-5). `CREATE TYPE factory_airlock_status` is allowed: it is a **new** type, not `ADD VALUE`.

### Action Steps

**3.1 Write `0058_factory_airlock.sql`.**
1. DB-1 host check. Generate a draft: `npx dotenv -e .env.test.local -- npx drizzle-kit generate --name factory_airlock`. Generate does not connect, but the config demands `POSTGRES_URL`.
2. Make sure the result is: tag `0058_factory_airlock`, journal idx **60**, snapshot `meta/0060_snapshot.json`. If drizzle-kit chose another tag, fix the tag in the journal entry and the file name. Never renumber older entries.
3. The generated DDL must contain **only** the `factory_airlock_status` type, the two `factory_airlock_*` tables, their indexes, CHECKs, and FKs. Compare with `docs/AIRLOCK_DUAL_APPROVAL.md` "Schema change". Any other statement means the snapshot and schema have drifted: HALT.
4. Prepend the hand-written header used by `0057`: "ADDITIVE ONLY ... never applied with drizzle-kit push". Append `ENABLE ROW LEVEL SECURITY` for both tables, if drizzle did not emit it, and guarded `REVOKE ALL ... FROM anon, authenticated` blocks in the `0057` style.
5. Update the `schema.ts:1701` comment so it reads "Migration 0058_factory_airlock". Update `AIRLOCK_DUAL_APPROVAL.md` status and file name (OD-3).
6. Create `tests/factory-airlock-migration.test.ts`:
   - The static check from QA-15.1-01 (no `DROP`, `ALTER COLUMN`, `ALTER TYPE`, `RENAME`, `TRUNCATE`, `DELETE`).
   - The CHECK strings in `schema.ts` equal those in the SQL (the Phase 14 technique).
   - The journal's last entry is idx 60, tag `0058_factory_airlock`.
7. `npx dotenv -e .env.test.local -- npx drizzle-kit check` exits 0.

Commit: `phase-15b(3.1): add additive 0058_factory_airlock migration`.

**3.2 Prove the migration chain on a scratch database.**
1. DB-1 check. Create a scratch database on the local Postgres (`createdb ccpatio_chain_proof` or `create database` via psql on `127.0.0.1:54322`). Never on a remote host.
2. Reproduce H-3: run `drizzle-kit migrate` from zero against the scratch DB with `POSTGRES_URL` pointing at it, and record whether 0055 fails with `unsafe use of new value`.
3. Prove the remedy: on a fresh scratch DB, migrate up to 0054. Then run `ALTER TYPE "public"."saga_status" ADD VALUE IF NOT EXISTS 'AWAITING_DEPOSIT';` **alone**, in autocommit. Then run `drizzle-kit migrate` to the end (0055 … 0058). It must succeed. The `IF NOT EXISTS` in 0055 makes its own `ALTER TYPE` a no-op.
4. Paste both raw outputs in the handback. Drop the scratch databases.

**3.3 Airlock hand-off code.**
1. **`src/server/path-a/events.ts`.**
   - `PathAReleaseSource` gains `"factory_airlock"`; the Zod enum in `pathAReleaseEventSchema` gains it too.
   - `PathAReleaseDiscriminator` gains `{ airlock: string }`, encoded as `airlock:<jobId>`.
   - Update `tests/path-a-events.test.ts` with new cases only.
2. **`src/server/path-a/release-store.ts`.** Widen the `requestRelease` source type. Before changing it, read every branch on `source` in `release-store.ts`, `release-request.ts`, and `path-a-release.ts`, and list them in the handback.
3. **Create `src/server/path-a/airlock-release.ts`** (pure decision plus a DB helper):
   - `loadJobAirlockState(jobId, db)` returns `{ items: Array<{ itemId; buildId | null; status | null }> }`.
   - `decideAirlockRelease(state)` returns `{ kind: "release" } | { kind: "waiting"; unapprovedItemIds: string[] } | { kind: "already_pushed" }`. Release requires every item to have a build with status `approved` or `pushed`, and at least one `approved` (OD-1).
4. **Rewrite the body of `src/inngest/factory-airlock.ts`.** Keep the id `factory-airlock-release`, the trigger, and `idempotency: IDEMPOTENCY_BY_EVENT_ID`. Steps:
   1. `reread-approved-build`: the existing checks, unchanged.
   2. Mode gate: `!canPushGhlFactoryOrders()` returns `{ ok: true, dryRun: true }` and leaves the row at `approved` (unchanged behavior).
   3. `decide-release` (`step.run`): resolve the job from `jobItemId`, call `decideAirlockRelease`. `waiting` returns `{ ok: true, waiting: true, unapprovedItemIds }`. `already_pushed` returns early.
   4. `record-release-request` (`step.run`): one `db.transaction` that calls `requestRelease({ oppId, source: "factory_airlock", requestedBy: approvedBy, reason: "factory airlock approved <buildId>" })` and inserts a `pim_audit_log` row (`action: "factory_airlock_release"`). Outcomes:
      - Saga missing: `NonRetriableError` (data defect, so the DLQ alerts).
      - Saga `COMPLETED` or `IN_PROGRESS`: return `{ ok: true, skipped: "saga_<status>" }`.
      - `already_requested` by a different source: return `{ ok: true, skipped: "release_already_requested" }`. Log it and do not override.
   5. `bump-attempt`, then `step.sendEvent("request-path-a-release", { id: attempt === 1 ? pathAReleaseEventId(opp, { airlock: jobId }) : pathAReleaseEventId(opp, { retry: attempt }), name: PATH_A_RELEASE_TO_PRODUCTION_EVENT, data: buildPathAReleaseEventData({...source: "factory_airlock"...}) })`.
5. **`approved → pushed`.** Add `factoryAirlockMarkPushed` to `src/inngest/factory-airlock.ts`:
   - `id: "factory-airlock-mark-pushed"`, trigger `PATH_A_RELEASE_COMPLETED_EVENT`, no Katana I/O, no `onFailure`.
   - One step: compare-and-set `UPDATE factory_airlock_builds SET status='pushed', version=version+1, updated_at=now() WHERE status='approved' AND job_item_id IN (items of the opportunity's job) RETURNING id`.
   - Register it in `inngestFunctions`.
   - **Before wiring,** read `path-a-ghl-sync.ts`, which already listens to the same event, and confirm the event payload carries the opportunity id.
6. **Deposit path (OD-2).** In `release-request.ts` `recordDepositAndRequestRelease`: if the job has **any** `factory_airlock_builds` row and `decideAirlockRelease` is not `release`, record the deposit and return the new outcome `{ outcome: "recorded_awaiting_airlock" }` without emitting a release event. Add it to `RecordDepositResult` and handle it in every caller (grep for `recordDepositAndRequestRelease`).
7. **Static guards.** In `tests/path-a-static-guards.test.ts`, add new assertions only: `src/inngest/factory-airlock.ts` and `src/server/path-a/airlock-release.ts` import nothing from `@/lib/katana` and contain no `KATANA_TENANT_CONCURRENCY`.
8. **Create `tests/factory-airlock-release.test.ts`** (fake step, real test DB or pglite following `tests/pglite-path-a-store.test.ts`). It must prove `AIRLOCK_DUAL_APPROVAL.md` step 7:
   - Designer submit leaves `pending_manager` with zero Katana ids.
   - Approve called with a non-manager session returns `not_authorized`.
   - Manager approve emits exactly one `factory/airlock.approved`.
   - `GHL_FACTORY_ORDERS=log` gives `dryRun`, no release event, and the row stays `approved`.
   - Live with 1 of 2 items approved gives `waiting`, no event. Live with 2 of 2 gives exactly one `path-a/release-to-production` with `source: "factory_airlock"`.
   - A second delivery of the same event id produces no second release event.
   - `path-a/release.completed` moves both builds to `pushed`. A replay changes nothing.
   - Deposit on an unapproved airlock job gives `recorded_awaiting_airlock` and no event.

Commit: `phase-15b(3.3): hand approved airlock builds to the Path A Katana writer`.

### Validation Checkpoint

1. The lock `target_test` passes.
2. `npx vitest run tests/path-a-release-saga.test.ts tests/path-a-claim-release.test.ts tests/path-a-static-guards.test.ts` passes. Existing Path A behavior is unchanged.
3. `rg "@/lib/katana|KATANA_TENANT_CONCURRENCY" src/inngest/factory-airlock.ts src/server/path-a/airlock-release.ts` returns 0 hits.
4. The scratch-DB chain proof from 3.2 is pasted.
5. `npm run qa:lifecycle` exits 0, then the QCA JSON.

### Operator Runbook — production migration (HUMAN ONLY, after Phase 3 QC)

Prerequisite: the Phase 1 runbook is done, so the tracker high-water mark is `0054`.
1. Take a backup or record a PITR timestamp.
2. In the Supabase SQL editor (autocommit), run alone: `ALTER TYPE "public"."saga_status" ADD VALUE IF NOT EXISTS 'AWAITING_DEPOSIT';` (H-3).
3. From a checkout at the Phase 3 HEAD, run `npm run db:migrate`. It applies 0055, 0056_pos_receipts, 0056_ledger_triage, 0057, and 0058 in one transaction.
4. Verify with read-only queries: `to_regclass` is not null for `custom_build_job_items`, `pos_receipts`, `ledger_triage`, `katana_po_bills`, `factory_airlock_builds`, `factory_airlock_decisions`; and the tracker max `created_at` equals the journal `when` of `0058_factory_airlock`.
5. Deploy the app **after** step 4. Keep `GHL_FACTORY_ORDERS`, `KATANA_REVERSE_SYNC_MODE`, `QBO_LEDGER_MODE`, and `CLOVER_LEDGER_MODE` at `log`.
6. Ensure the Factory Manager (Christian) has a `user_roles` row with `Ops_Manager`.
7. In Katana settings, add webhook subscriptions for `sales_order.updated`, `sales_order.packed`, `sales_order.delivered`, `manufacturing_order.done` (Parent §I.5.5).

### Stop & Commit

Two commits (3.1, 3.3). Print the §0.5 handback, including the source-branch inventory from 3.3.2. STOP. `Awaiting "PROCEED TO PHASE 4".`

---

## PHASE 4 — WooCommerce Prep (Path B catalog)

**Objective:** Stop $0 and unflagged Woo catalog publishes, add the `WOO_CATALOG_PUBLISH_MODE` gate and the DevSite host guard, and ship the Woo-only catalog backfill.

### 4.0 Lock (operator installs)

`phase_id: "phase-16-woo-devsite-mto"`, `base_ref: <Phase 3 HEAD>`, `target_test: "npx vitest run tests/phase16-woo-catalog-safety.test.ts tests/woo-static-guards.test.ts tests/catalog-publish-idempotency.test.ts"`, `allowed_files`:

```
.cursor/phase.lock
.cursor/session-stamp.json
docs/AUTONOMOUS_BUILD_BLUEPRINT.md
.env.example
package.json
src/server/pipeline/woo-catalog-mode.ts
src/server/woocommerce/devsite-guard.ts
src/mappers/types.ts
src/mappers/woocommerce.ts
src/lib/woocommerce-catalog.ts
src/server/mdm/publish-channels.ts
src/server/mdm/load-hub-product-graph.ts
src/app/api/webhooks/woocommerce/route.ts
src/inngest/woo-catalog-backfill.ts
src/inngest/functions.ts
scripts/ops/trigger-woo-catalog-backfill.ts
tests/phase16-woo-catalog-safety.test.ts
tests/woo-static-guards.test.ts
tests/catalog-publish-idempotency.test.ts
tests/woo-webhook-route.test.ts
```

### Context & Constraints

- Implement Parent §I.2, §16.1, §16.2, §16.3, §16.4 **exactly**. Out of scope for this phase (do not build): §I.3 Woo call-site rewiring, §I.4 (D-6 terminal state), §16.5 replay utility, and anything for Parent Phase 17.
- `CATALOG_PUBLISH_MODE` stays Katana-only (Parent C-5). The Woo gate is the new `WOO_CATALOG_PUBLISH_MODE`.
- Keep `WOOCOMMERCE_URL`. `WOOCOMMERCE_API_URL` must never appear (Parent C-2).
- Woo `status: "draft"` on **create only**; on **update**, omit `status` (Parent C-6). Never `manage_stock: true`.
- The backfill makes no Katana, Clover, or QBO calls and does not carry `KATANA_TENANT_CONCURRENCY`.
- The Woo lane must never reach `order_intake` or `src/server/ghl/` (Parent §16.4).

### Action Steps

1. **Create `src/server/woocommerce/devsite-guard.ts`** (Parent §I.2). Wire usage site 1 (`wooFetch` non-GET) and usage site 2 (the Woo webhook route floor check: 200 `below_devsite_floor`, or 503 when the floor is unset on devsite).
2. **Create `src/server/pipeline/woo-catalog-mode.ts`**: `getWooCatalogPublishMode()`, `canMutateWooCatalog()`, fail closed, runtime read.
3. **`src/mappers/woocommerce.ts`** (Parent §16.1a and §16.2):
   - Delete the `(commerce.msrp?.trim() || "0.00")` fallback; a price ≤ 0 or unparseable gives `{ skip: true, reason: "msrp_missing_or_zero" }`.
   - The only status the mapper emits is `"draft"`. Remove `"publish"` from the type.
   - Add the MTO stock rule (`isKatanaMtoItem`) and `WOO_MTO_STOCK_STATUS`.
4. **`src/mappers/types.ts` and `load-hub-product-graph.ts`**: add `productOrigin` and `itemType` (Parent §16.2).
5. **`src/server/mdm/publish-channels.ts` `publishToWooCommerce`**: add the `onMissingPrice` option and the dry-run path (no HTTP, `channel_sync` row set to `pending`). The missing-price path records `failed` / `msrp_missing_or_zero`, then throws `NonRetriableError` or returns, depending on `onMissingPrice` (Parent §16.1b).
6. **`src/lib/woocommerce-catalog.ts`**:
   - Add the 15 s `AbortSignal.timeout`.
   - Add the host guard on writes.
   - Create sends POST with `status: "draft"`; update sends PUT without `status`.
   - The SKU lookup uses `status=any`.
7. **Create `src/inngest/woo-catalog-backfill.ts`**: `wooCatalogBackfill` and `wooCatalogPublishSku` with the exact options from Parent §16.3. Register both.
8. **Create `scripts/ops/trigger-woo-catalog-backfill.ts`**:
   - Dry run by default.
   - Refuses unless `WOOCOMMERCE_TARGET=devsite` and the host is not a production host.
   - Prints a pre-flight count of SKUs with missing or zero MSRP.
   - Add the two `package.json` aliases (Parent §16.3).
9. **Tests:**
   - Create `tests/phase16-woo-catalog-safety.test.ts` covering QA-I-04, QA-I-05, QA-I-06, QA-16.1-01 … 06, QA-16.2-01 … 03, QA-16.3-01 … 05.
   - Extend `tests/woo-static-guards.test.ts` per §16.4 (new `describe` only).
   - Add all new test files to `qa:phase0-unit`.

Commits:
- `phase-16(4.1): gate Woo catalog writes and block $0 MSRP publishes` (steps 1–6).
- `phase-16(4.2): add Woo-only catalog backfill` (steps 7–9).

### Validation Checkpoint

1. The lock `target_test` passes.
2. Grep gates:
   - `rg '"publish"' src/mappers/woocommerce.ts src/lib/woocommerce-catalog.ts` expects 0 hits.
   - `rg '"0.00"' src/mappers/woocommerce.ts` expects 0 hits.
   - `rg "manage_stock: true" src/` expects 0 hits.
   - `rg "WOOCOMMERCE_API_URL"` over `src/ scripts/ tests/ .env.example` expects 0 hits.
   - `rg "@/lib/katana|KATANA_TENANT_CONCURRENCY" src/inngest/woo-catalog-backfill.ts` expects 0 hits.
3. With `WOO_CATALOG_PUBLISH_MODE` unset, a `fetch` spy records 0 calls for an approved product (QA-16.1-02).
4. DB-1 check, then run the backfill script dry run against the **test** env. Paste the output. Never use `--confirm`.
5. `npm run qa:lifecycle` exits 0, then the QCA JSON.

### Operator Runbook (after QC)

Complete Parent §I.5 items 1–4 for the DevSite. Then run `npm run ops:woo-catalog-backfill` (dry run), review it, and only then add `--confirm`, with `WOO_CATALOG_PUBLISH_MODE=live` on the **DevSite** hub deployment only.

### Stop & Commit

Print the §0.5 handback. STOP. `Awaiting "PROCEED TO PHASE 5".`

---

## PHASE 5 — Enterprise Academy Scaffold

**Objective:** Replace the non-persistent Katana training sign-off with a persisted, role-based Academy: the `employee_certifications` schema, a typed module catalog, a Practical Application state machine with manager sign-off, and an `AcademyShell` UI at `/embed/academy`.

### 5.0 HALT check (do this first)

Search the repo, `.cursor/plans/`, and `docs/` for `ENTERPRISE_ACADEMY_PLAN.md` or any "Academy Blueprint".
- **If found:** HALT and report its path. The operator decides whether it supersedes §5 below.
- **If not found** (the state on 2026-11-03): build exactly the specification in this section. Do not invent features beyond it: no quizzes engine beyond the knowledge-check shape below, no file uploads (OD-5), no GHL writes, no email.

### 5.1 Lock (operator installs)

`phase_id: "phase-18-enterprise-academy"` (17 is reserved by the Parent Blueprint), `base_ref: <Phase 4 HEAD>`, `target_test: "npx vitest run tests/academy-practical-state.test.ts tests/academy-catalog.test.ts tests/academy-actions.test.ts tests/academy-migration.test.ts"`, `allowed_files`:

```
.cursor/phase.lock
.cursor/session-stamp.json
docs/AUTONOMOUS_BUILD_BLUEPRINT.md
package.json
src/server/db/schema.ts
src/server/db/migrations/0059_employee_certifications.sql
src/server/db/migrations/meta/
src/server/academy/catalog.ts
src/server/academy/practical-state.ts
src/server/academy/store.ts
src/server/auth/ops-manager.ts
src/components/academy/AcademyShell.tsx
src/components/academy/ModuleView.tsx
src/components/academy/PracticalPanel.tsx
src/app/embed/academy/page.tsx
src/app/embed/academy/actions.ts
src/app/admin/academy/page.tsx
src/app/admin/academy/EvaluatorQueue.tsx
src/app/admin/academy/actions.ts
tests/academy-practical-state.test.ts
tests/academy-catalog.test.ts
tests/academy-actions.test.ts
tests/academy-migration.test.ts
tests/e2e/academy.spec.ts
```

### Context & Constraints

- `TrainingHub.tsx` and `/embed/training` are **read-only references** in this phase (OD-4). Content is ported into `catalog.ts`, not deleted from the hub.
- Identity: inside the GHL iframe the principal is `ghl-embed@ccpatio.com`, and `ghlUserEmail` is an unverified label (`AIRLOCK_DUAL_APPROVAL.md`, "Manager view"). Employee self-actions are therefore **claims**. The trust anchor is the evaluator's sign-off, which requires a real Supabase user with `user_roles.role` in (`Ops_Manager`, `SuperAdmin`), checked server-side.
- No `pgEnum` for statuses or roles. Use `text` + `CHECK` for statuses (closed set). Role ids and module ids are validated in TypeScript against `catalog.ts`, so new roles never need DDL.
- Every state change is a compare-and-set on `version` plus an append-only event row, the same pattern as the airlock.
- Server actions call `revalidatePath("/embed/academy")` and/or `revalidatePath("/admin/academy")` after a successful mutation (C-6).

### Specification

**Practical Application state machine** (`src/server/academy/practical-state.ts`, pure):

| From | To | Actor | Guard |
|---|---|---|---|
| (none) | `enrolled` | employee (embed) | module exists in catalog for the chosen role |
| `enrolled` | `knowledge_passed` | employee (embed) | knowledge-check score ≥ module `passMark` (server-scored; answers never trusted from the client as a score) |
| `knowledge_passed` or `practical_rejected` | `practical_submitted` | employee (embed) | evidence text 20–4000 chars; every rubric item acknowledged |
| `practical_submitted` | `certified` | evaluator (Ops_Manager/SuperAdmin) | evaluator ≠ employee key; all rubric items marked met |
| `practical_submitted` | `practical_rejected` | evaluator | comment 10–2000 chars |
| `certified` | `revoked` | evaluator | comment 10–2000 chars |

Exports:
- `ACADEMY_STATUSES` (`as const`).
- `assertLegalAcademyTransition(from, to, actorKind)`, which throws a typed `IllegalAcademyTransitionError`.
- `isExpired(certifiedAt, validityDays, now)`. Expiry is **computed**, never stored.
- `revoked` is terminal for that row. Re-certification creates a new row with `module_version` ≥ the current one.

**Migration `0059_employee_certifications.sql`** (journal idx 61, `meta/0061_snapshot.json`; generate via the DB-1/DB-2-safe `drizzle-kit generate`, then add the hand header, RLS, and guarded REVOKEs exactly as in 3.1):

```sql
CREATE TABLE "employee_certifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "employee_key" text NOT NULL,            -- lower-cased email or GHL user id; a label, not an auth identity
  "employee_name" text NOT NULL,
  "role_id" text NOT NULL,                 -- validated in TS against catalog.ts
  "module_id" text NOT NULL,
  "module_version" integer NOT NULL,
  "status" text DEFAULT 'enrolled' NOT NULL,
  "knowledge_score" integer,
  "evidence_text" text,
  "rubric_results" jsonb,                  -- [{ itemId, employeeAck, evaluatorMet }]
  "evaluator_email" text,
  "evaluator_comment" text,
  "certified_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "employee_certifications_status_check" CHECK ("status" in ('enrolled','knowledge_passed','practical_submitted','practical_rejected','certified','revoked')),
  CONSTRAINT "employee_certifications_module_version_positive" CHECK ("module_version" >= 1),
  CONSTRAINT "employee_certifications_score_range" CHECK ("knowledge_score" is null or ("knowledge_score" between 0 and 100)),
  CONSTRAINT "employee_certifications_certified_stamped" CHECK ("status" <> 'certified' or ("evaluator_email" is not null and "certified_at" is not null)),
  CONSTRAINT "employee_certifications_revoked_stamped" CHECK ("status" <> 'revoked' or ("revoked_at" is not null and "evaluator_comment" is not null))
);
CREATE UNIQUE INDEX "employee_certifications_active_uidx" ON "employee_certifications" ("employee_key","module_id","module_version") WHERE "status" <> 'revoked';
CREATE INDEX "employee_certifications_status_idx" ON "employee_certifications" ("status","updated_at");

CREATE TABLE "employee_certification_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "certification_id" uuid NOT NULL REFERENCES "employee_certifications"("id") ON DELETE RESTRICT,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_label" text NOT NULL,
  "actor_kind" text NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "employee_certification_events_actor_kind_check" CHECK ("actor_kind" in ('employee_claim','evaluator'))
);
CREATE INDEX "employee_certification_events_cert_idx" ON "employee_certification_events" ("certification_id","created_at");
-- + ENABLE ROW LEVEL SECURITY on both, guarded REVOKE ALL FROM anon, authenticated (0057 style)
```

The Drizzle mirror in `schema.ts` has `.enableRLS()`, and its CHECK text matches the SQL character for character.

**Catalog** (`src/server/academy/catalog.ts`, static, typed, no I/O):

```ts
export const ACADEMY_ROLES = ["procurement_manager","receiving_dock","warehouse_manager",
  "floor_foreman","line_operator","shipping_fulfillment"] as const; // = TrainingRoleId
export type AcademyModule = {
  id: string; version: number; roleIds: readonly AcademyRoleId[]; title: string;
  summary: string; videoUrl: string | null; steps: Array<{ title: string; detail: string }>;
  knowledgeCheck: { passMark: number; questions: Array<{ id: string; prompt: string;
    options: string[]; correctIndex: number }> };          // correctIndex never sent to the client
  practical: { title: string; instructions: string;
    rubric: Array<{ id: string; criterion: string }> };
  validityDays: number | null;
};
export function modulesForRole(roleId: AcademyRoleId): AcademyModule[];
export function getModule(id: string, version?: number): AcademyModule | null;
export function toClientModule(m: AcademyModule): Omit<AcademyModule,"knowledgeCheck"> & {
  knowledgeCheck: { passMark: number; questions: Array<Omit<...,"correctIndex">> } };
```

Seed: one module per role, id `katana-v1-<roleId>`, version 1. Port `steps`, `videoTitle`/`watchUrl`, and `checklist` from the matching `ROLES` entry in `TrainingHub.tsx`; each checklist item becomes a rubric item. Write 3–5 knowledge-check questions per module, drawn **only** from facts already stated in that role's `TrainingHub` content. `validityDays: 365`.

**Server actions:**
- `src/app/embed/academy/actions.ts` (employee claims): `enrollAction`, `submitKnowledgeCheckAction` (server scores against `catalog.ts`), `submitPracticalAction`.
- `src/app/admin/academy/actions.ts` (evaluator): `listPendingPracticalsAction`, `certifyPracticalAction`, `rejectPracticalAction`, `revokeCertificationAction`. Each evaluator action first calls `requireOpsManager()` from the new `src/server/auth/ops-manager.ts`, which implements the same check as `requireAirlockManager` (`airlock-actions.ts:69`): Supabase `getUser()`, a `user_roles` lookup, and refusal of the embed principal. Do not modify `airlock-actions.ts` in this phase.
- Return typed `{ ok: false, error }` results for user errors, and throw on infrastructure errors (C-1). An `academy_schema_pending` result is returned when the tables are absent, mirroring `isAirlockSchemaMissing`.

**UI:**
- `AcademyShell.tsx` is a client component: role picker → module list (with computed status badges: not started / in progress / submitted / certified / expired / rejected) → `ModuleView` (steps, video link, knowledge check) → `PracticalPanel` (evidence textarea plus rubric acknowledgements).
- Follow the existing Tailwind 4 and `TrainingHub` visual conventions.
- `src/app/embed/academy/page.tsx` mounts it.
- `/admin/academy` shows `EvaluatorQueue` (pending practicals, rubric marking, certify/reject with comment).

### Action Steps

1. Run the 5.0 HALT check.
2. **Migration and mirror** (DB-1, DB-2, test DB only). Create `tests/academy-migration.test.ts`: the additive static check, CHECK-string parity, and the journal's last entry being idx 61.
   Commit: `phase-18(5.1): add employee_certifications schema`.
3. **Pure modules.** Create `practical-state.ts` and `catalog.ts`.
   - `tests/academy-practical-state.test.ts`: every legal transition, every illegal transition (full from×to×actor matrix), evaluator equal to employee is rejected, expiry math.
   - `tests/academy-catalog.test.ts`: 6 modules, unique ids, every role covered, `toClientModule` strips `correctIndex`, `passMark` within 1–100.
   Commit: `phase-18(5.2): add academy catalog and practical state machine`.
4. **Store, auth helper, and actions.** Create `store.ts` (compare-and-set on `version` plus an event insert in one transaction), `ops-manager.ts`, and both action files.
   - `tests/academy-actions.test.ts` (test DB): the full happy path enrolled → certified; a client-sent score is ignored; a non-manager certify returns `not_authorized`; a stale `version` returns `conflict`; a duplicate active enrolment is rejected by the unique index and surfaced as a typed error.
   Commit: `phase-18(5.3): persist academy progress with evaluator sign-off`.
5. **UI.** Create the shell, its components, both pages, and `tests/e2e/academy.spec.ts`. The e2e test enrolls, passes the knowledge check, and submits a practical, then the evaluator certifies via the existing god-mode auth helper and the badge shows "certified". Add the unit tests to `qa:phase0-unit`.
   Commit: `phase-18(5.4): add AcademyShell and evaluator queue`.

### Validation Checkpoint

1. The lock `target_test` passes.
2. `rg "correctIndex" src/components/academy/ src/app/embed/academy/` expects 0 hits (answers never reach the client).
3. `rg "Math.random" src/server/academy/ src/app/embed/academy/ src/app/admin/academy/` expects 0 hits.
4. `git diff <base_ref>..HEAD -- src/components/mission-control/TrainingHub.tsx src/app/embed/training/` is empty.
5. `npm run qa:lifecycle` exits 0 (includes the new e2e), then the QCA JSON.

### Operator Runbook (after QC)

Apply `0059_employee_certifications` to production with `npm run db:migrate`. It is a single additive migration on top of 0058, with no enum hazard. Verify `to_regclass`. Deploy. Pilot `/embed/academy` with one role before any cut-over from `/embed/training` (a separate decision).

### Stop & Commit

Print the §0.5 handback. STOP. **End of this blueprint.** Do not start any further work.

---

## Appendix A — Quick "never" list

- Never run `npm run db:migrate`, `db:push`, `drizzle-kit push`, `db:seed*`, `migrate:*`, or any `--confirm` script.
- Never point any command at a non-local Postgres host.
- Never call a Katana write endpoint. Never create a second Katana sales-order or manufacturing-order writer.
- Never set a mode flag to `live` in a file.
- Never edit `.cursor/phase.lock`, an existing migration SQL file, or an existing snapshot.
- Never weaken a test or mock Postgres in Phase 2 DB proof.
- Never swallow an error. Never add an alerting `onFailure`.
- Never call QBO or GHL from a function that holds `KATANA_TENANT_CONCURRENCY`.
- Never write `order_intake.status` / `version` from the reverse flow.
- Never send Woo `status` on update, `"publish"`, a `$0.00` price, or `manage_stock: true`.
- Never trust a client-sent quiz score, or an embed-iframe email, as an authorization.
- Never continue past a STOP without `PROCEED TO PHASE <n>`.

## Appendix B — Migration numbering after this blueprint

| Journal idx | SQL tag | Snapshot | Production state at start |
|---|---|---|---|
| 46 | `0045_ecommerce_listings_slug_unique` | `0046_snapshot.json` | applied and tracked (high-water mark) |
| 47–55 | `0046` … `0054` | `0047` … `0055` | objects present except 0053; **untracked** (Phase 1 runbook) |
| 56 | `0055_path_a_stateless_release` | `0056_snapshot.json` | not applied (H-3 pre-step required) |
| 57 | `0056_pos_receipts` | `0057_snapshot.json` | not applied |
| 58 | `0056_ledger_triage` | `0058_snapshot.json` | not applied |
| 59 | `0057_katana_reverse_flow` | `0059_snapshot.json` | not applied |
| 60 | `0058_factory_airlock` (Phase 3) | `0060_snapshot.json` | not yet written |
| 61 | `0059_employee_certifications` (Phase 5) | `0061_snapshot.json` | not yet written |
