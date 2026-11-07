# AUTONOMOUS BUILD BLUEPRINT — CC Patio MDM Hub completion

**Document type:** Execution playbook and system prompt for an autonomous coding agent ("the Agent", e.g. Antigravity).
**Author role:** Lead Systems Architect (Cursor).
**Date:** 2026-11-07 (revision 2; supersedes the 2026-11-03 revision). **Baseline commit:** `0cdda91` on `main`, pushed to `origin/main`.
**Status:** BINDING. Read §0 in full before touching any file. You execute exactly one Phase at a time, then STOP.

---

## 0. OPERATING CONTRACT (read first, applies to every phase)

### 0.1 Precedence

1. `FINAL_INTEGRATION_ROADMAP.md`. It is supreme (per `CLAUDE.md`).
2. `CLAUDE.md` hard guardrails and the Triad Kernel rule (`.cursor/rules/triad-kernel.mdc`).
3. `docs/BLUEPRINT_Katana_ReverseFlow_WooCommerce_DevSite_Phases15-16.md` (the **Parent Blueprint**). Sections VI and VII are binding and win over its own earlier sections.
4. This document. It orders the work and adds production-safety rules. When this document cites a Parent Blueprint section, implement that section **exactly**. Where this document and the Parent Blueprint disagree, **this document wins only on the topics it addresses explicitly**: production DB access, migration numbering, airlock hand-off, and Academy.
5. `docs/AIRLOCK_DUAL_APPROVAL.md` for the airlock (Phase 3), as amended by §3 below.

### 0.2 Verified baseline (2026-11-07). Re-verify before Phase 1; on any mismatch, HALT.

| Fact | Value | How to re-verify |
|---|---|---|
| HEAD | `0cdda91` (`feat(phase-15): implement katana reverse flow listeners and tests`), parent `68bdd89`. Also accepted: exactly one commit on top of `0cdda91` whose only changed path is `docs/AUTONOMOUS_BUILD_BLUEPRINT.md` (this revision) | `git log -3 --format=%h` and `git diff --name-only 0cdda91..HEAD` |
| Remote | `main` is in sync with `origin/main` (0 ahead, 0 behind) | `git status -sb` |
| Working tree | Clean. The only permitted difference is `.cursor/session-stamp.json`, which the session hook rewrites at the start of every session | `git status --short` |
| Active lock | `phase-15-katana-lifecycle`, `base_ref: 3b02dc2` until the operator installs the §1.0 amendment | read `.cursor/phase.lock` |
| Local migration journal | 60 entries (idx 0–59); last = idx 59, tag `0057_katana_reverse_flow`, `when` `1793289542107`; two `0056_*` tags exist (idx 57, 58) | `src/server/db/migrations/meta/_journal.json` |
| Last snapshot | `meta/0059_snapshot.json` (tracked). Contains `katana_po_bills`, does **not** contain `factory_airlock_*` | grep the file |
| Snapshot numbering | snapshot file number = journal **idx**, not SQL tag. `meta/0056_snapshot.json` (idx 56, `0055`) does not exist; `drizzle-kit generate` diffs against the latest, `0059_snapshot.json` | `meta/` |
| Production Drizzle tracker | `drizzle.__drizzle_migrations`: **58 rows**; `max(created_at) = 1793289542107` = journal idx 59 = tag `0057_katana_reverse_flow`. Repaired manually by the operator on 2026-11-07 | read-only query (operator only; the Agent never connects to production) |
| Production objects 0046–0057 | **all present and tracked**, including 0053 RLS (`relrowsecurity = true` on `qbo_auth_tokens` and `incoming_webhooks`), `custom_build_job_items`, `pos_receipts`, `ledger_triage`, `katana_po_bills` | operator-attested |
| Production `saga_status` enum | `AWAITING_DEPOSIT` label committed | operator-attested |
| Production airlock tables | absent; **no SQL file exists**; Drizzle mirror exists at `src/server/db/schema.ts:1699-1777` | grep |
| `employee_certifications` / Academy | absent everywhere (no table, no code, no `ENTERPRISE_ACADEMY_PLAN.md`) | `rg -i academy` |
| Test DB | `.env.test.local` → `127.0.0.1:54322` (local Supabase). Must be running before Phase 1 | Phase 0 |
| QA gauntlet | `npm run qa:lifecycle` = build → DB proof → unit → hygiene-live → phase14-live → webhooks → e2e | `package.json` |
| `qa:phase0-unit` | already lists `env.test`, `ledger-mode`, `woo-static-guards`, `phase15-katana-reverse-flow`, `phase15-po-receipt-ledger`, `phase15-reverse-flow-resilience` | `package.json` |
| Next.js / Inngest / Drizzle | 16.3.2 / 4.18.1 / orm ^0.45.2, kit ^0.31.10 | `package.json` |

**What is already on `main`:**
- `68bdd89` is the Phase 1.1 checkpoint. It also landed `ORDER_PIPELINE_MODE: z.enum(["log","approve","live"])` in `src/env.ts`.
- `0cdda91` landed most of the Phase 2 code. Inngest functions: `katana-order-status.ts`, `ghl-factory-stage-push.ts`, `katana-po-received.ts` (rewired), `katana-po-bill-post.ts`, `dlq-context.ts`. Server modules: `order-status.ts`, `opportunity-stage.ts`, `po-receipt-ledger.ts`, `katana-reverse-mode.ts`, plus the split `ledger-mode.ts`. Also `redrive-parked-po-bills.ts`, the three missing fixtures, the Phase 15 test files, and the env flags `QBO_LEDGER_MODE`, `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`, `KATANA_REVERSE_SYNC_MODE`.
- **Still missing from `src/env.ts`:** `WOOCOMMERCE_TARGET` and `WOO_CATALOG_PUBLISH_MODE`. `tests/env.test.ts` has no cases for any of the Phase 15 flags.

### 0.3 Known hazards (each one is handled by a specific phase; do not "fix" them out of order)

| ID | Hazard | Status / handled in |
|---|---|---|
| **H-1** | Production `__drizzle_migrations` stopped at `0045` while 0046–0054 objects existed. | **RESOLVED 2026-11-07.** The operator repaired the tracker by hand: 58 rows, high-water mark `1793289542107` (`0057`). No reconcile script is needed. |
| **H-2** | `0053` (RLS lockdown on `qbo_auth_tokens`, `incoming_webhooks`) was missing in production. | **RESOLVED 2026-11-07.** RLS enabled on both tables; tracked. |
| **H-3** | `0055` adds the enum value `AWAITING_DEPOSIT` and uses it in the same transaction (`unsafe use of new value`). | **RESOLVED in production 2026-11-07.** The value is committed and 0055 is tracked. It can still bite a **local** database that is behind 0055; see Phase 2 step 2.2 for the test-DB-only remedy. |
| **H-4** | The Katana webhook route emits `katana/sales_order.status_changed` and `katana/manufacturing_order.done`. | Consumers implemented in `0cdda91`; **certified in Phase 2**. |
| **H-5** | `publishToWooCommerce` reads no mode flag, the mapper falls back to `regular_price "0.00"` and always sends `status: "publish"`. Every approved product is published live to whatever `WOOCOMMERCE_URL` points at, including $0 products. | Phase 4 |
| **H-6** | `npm run db:migrate` / `db:generate` load `.env.local` via `drizzle.config.ts` (`loadEnvConfig`). **`.env.local` points at PRODUCTION.** Any bare `npm run db:*` command is a production command. | Rule DB-1 (permanent) |
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
- **DB-5.** Never edit an existing migration SQL file or an existing snapshot. New migrations only. **Never edit an existing `_journal.json` entry**: production's tracker high-water mark is `1793289542107`, and any new entry must have a strictly greater `when`.
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

**Completed by the operator on 2026-11-07:**
- [x] Production tracker repaired: 58 rows, high-water mark `1793289542107` (`0057_katana_reverse_flow`) (H-1).
- [x] 0053 RLS applied to `qbo_auth_tokens` and `incoming_webhooks` (H-2).
- [x] `saga_status.AWAITING_DEPOSIT` committed; 0055 tracked (H-3).
- [x] All local commits pushed; `main` = `origin/main` = `0cdda91`.

**Remaining operator actions before Phase 1:**
1. Confirm a production backup or PITR restore point exists after the manual repair, and record it.
2. Start the local test database (`npx supabase start`) and confirm `127.0.0.1:54322` accepts connections.
3. Install the Phase 1 lock amendment (§1.0).
4. Confirm the Phase 0 decisions below by editing this table, or leave the defaults.

| ID | Decision | Default ruling |
|---|---|---|
| OD-1 | Airlock release granularity: release the Path A job only when **every** `custom_build_job_items` row of the job has an `approved` airlock build | **Yes**. An item without a build blocks release (fail closed). |
| OD-2 | A customer deposit on a job that has airlock builds records the deposit but does **not** emit a release | **Yes** (`AIRLOCK_DUAL_APPROVAL.md` step 6). |
| OD-3 | New migration tags: `0058_factory_airlock` (journal idx 60, `meta/0060_snapshot.json`) and `0059_employee_certifications` (idx 61, `meta/0061_snapshot.json`) | **Yes**. This supersedes the "0059_factory_airlock" name in `AIRLOCK_DUAL_APPROVAL.md` and the `schema.ts:1701` comment. |
| OD-4 | Academy first cut ports the 6 existing Katana roles from `TrainingHub.tsx` as v1 modules and mounts at a new route `/embed/academy`; `/embed/training` stays unchanged until a separate cut-over approval | **Yes** |
| OD-5 | Academy practical evidence is text plus a rubric checklist only (no file uploads in the scaffold) | **Yes** |

---

## PHASE 1 — Codebase Stabilization

**Objective:** Finish the env validation work: declare the two missing Woo variables in `src/env.ts` and cover every Phase 15 flag in `tests/env.test.ts`.

### 1.0 Lock (operator installs; amends the active Phase 15 lock)

`phase_id: "phase-15-katana-lifecycle"`, `base_ref: <current HEAD>` (`0cdda91`, or the blueprint-revision commit on top of it). Add to `allowed_files`:

```
tests/env.test.ts
```

(`src/env.ts`, `.env.example`, `package.json`, and `docs/AUTONOMOUS_BUILD_BLUEPRINT.md` are already listed.)

### Context & Constraints

- DB-1 … DB-5, P-1 … P-6 apply.
- Do not touch any Phase 2 file in this phase.

### Action Steps

**1.1 Checkpoint commit.** **DONE** in `68bdd89` (`chore(phase-15): stabilize env validation and checkpoint katana reverse flow scaffold`). Do not redo it.

**1.2 Declare the missing Woo variables and test the env schema.**
1. Read `src/env.ts` and confirm these are already present and **leave them unchanged**: `ORDER_PIPELINE_MODE: z.enum(["log","approve","live"]).default("log")`, `QBO_LEDGER_MODE`, `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`, `KATANA_REVERSE_SYNC_MODE` (each `z.enum(["log","live"]).optional()`). If any is missing, HALT (baseline mismatch).
2. Add to `coreEnvSchema` in `src/env.ts`:
   - `WOOCOMMERCE_TARGET: z.enum(["devsite","production"]).default("devsite")`
   - `WOO_CATALOG_PUBLISH_MODE: z.enum(["log","live"]).optional()` (Parent §I.3; Phase 4 reads it at runtime from `process.env` per C-2, but the schema must declare it).
   - Do **not** change `LEDGER_PIPELINE_MODE` or `CATALOG_PUBLISH_MODE`.
3. Document both in `.env.example` with a one-line comment each: `WOOCOMMERCE_TARGET=devsite` and `WOO_CATALOG_PUBLISH_MODE=log`.
4. `tests/env.test.ts`: add **new** cases only (C-7):
   - `ORDER_PIPELINE_MODE=approve` is accepted; `ORDER_PIPELINE_MODE=garbage` is rejected.
   - `WOOCOMMERCE_TARGET` defaults to `devsite` when unset; `production` is accepted; any other value is rejected.
   - `QBO_LEDGER_MODE`, `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`, `KATANA_REVERSE_SYNC_MODE`, `WOO_CATALOG_PUBLISH_MODE`: unset is accepted (value `undefined`); `log` and `live` are accepted; garbage is rejected.
5. Commit: `phase-15(1.2): declare WOOCOMMERCE_TARGET and WOO_CATALOG_PUBLISH_MODE and test env flags`.

**1.3** — **REMOVED.** The operator's manual tracker repair (H-1) made the Drizzle reconcile script obsolete. Do not create `scripts/ops/reconcile-drizzle-ledger.ts`, `src/server/ops/drizzle-ledger-plan.ts`, or `tests/drizzle-ledger-reconcile.test.ts`.

### Validation Checkpoint

1. `npx tsc --noEmit` exits 0.
2. `npx vitest run tests/env.test.ts` passes.
3. `rg "WOOCOMMERCE_API_URL" src/ scripts/ tests/ .env.example` returns 0 hits (Parent C-2).
4. `npm run qa:lifecycle` exits 0. If failures pre-date this phase, fix them only if the fix is inside the lock. Otherwise HALT and report.
5. `node .cursor/skills/qca/scripts/qca.mjs`, verbatim JSON.

### Stop & Commit

One commit (1.2). Print the §0.5 handback, then STOP. `Awaiting "PROCEED TO PHASE 2".`

---

## PHASE 2 — Certify the Katana Reverse Flow

**Objective:** Prove, on the local test database, that the reverse-flow code already committed in `0cdda91` works. It consumes the Katana SO and MO events (H-4), persists factory status, gates the GHL stage push behind `KATANA_REVERSE_SYNC_MODE`, and runs the PO-receipt delta ledger. Fill any gap against the Parent spec, then certify with `qa:lifecycle`.

`0057_katana_reverse_flow` is **already applied and tracked in production** (§0.2). In this phase you apply it to the **local test database only**.

### 2.0 Lock

The active `phase-15-katana-lifecycle` lock, unchanged from Phase 1. All Phase 2 files are already in it. The operator sets `base_ref` to the Phase 1 HEAD.

### Context & Constraints

- The binding spec is Parent §15.0, §15.2, §15.3, §15.4, §15.5, **as amended by §VI (R-1 … R-17) and §VII (S-1 … S-9)**. Read §VI and §VII before changing any code.
- Reverse flow is **read-only against Katana** (K-1). `katana-order-status.ts` and `katana-po-received.ts` read Katana through `katanaFetch` inside `runKatanaStep` (`assertKatanaDeferContext`). That is the sanctioned read path, not a violation.
- Never write `order_intake.status` or `order_intake.version`. Never move a GHL opportunity backwards, across pipelines, or out of a foreign stage (Parent D-8, §VI R-11).
- QBO vendor id comes **only** from `QBO_ID: <id>` in the Katana supplier comment. No auto-create, no name matching, no default account ids (Parent D-10, D-12, §VII S-2).
- This is a certification phase. Change code only to close a gap the audit in 2.3 finds, or to fix a gauntlet failure. Never weaken an existing assertion (C-7).

### Action Steps

**2.1 Pre-flight.**
1. Confirm the local test DB is up. Run the DB-1 host check; it must print `127.0.0.1` or `localhost`.

**2.2 Apply 0057 to the local test database only.**
1. Run DB-2: `npx dotenv -e .env.test.local -- npx drizzle-kit migrate`.
2. If it fails on `0055` with `unsafe use of new value "AWAITING_DEPOSIT"` (H-3 on a local DB behind 0055), then, **against the local test DB only** and after re-running the DB-1 check, run this statement alone in autocommit:
   `npx dotenv -e .env.test.local -- node -e "const p=require('postgres');const s=p(process.env.POSTGRES_URL);s.unsafe(\"ALTER TYPE public.saga_status ADD VALUE IF NOT EXISTS 'AWAITING_DEPOSIT'\").then(()=>s.end())"`
   Then re-run DB-2. Never run this against any other host.
3. Verify on the test DB that `to_regclass('public.katana_po_bills')` is not null, and that the test tracker's `max(created_at)` = `1793289542107`. Paste both results.

**2.3 Gap audit against the Parent spec.** For each item, state PRESENT or MISSING, citing `path:line`. Implement only what is MISSING, exactly per the cited Parent section.

| # | Deliverable | Parent ref |
|---|---|---|
| a | Fixtures `sales-order-ghl.json`, `manufacturing-orders-by-so.json`, `purchase-order-partially-received.json` (PII redacted); answer V-3 … V-6 with the fixture path as proof | §15.0 |
| b | `src/server/pipeline/katana-reverse-mode.ts`: `getKatanaReverseSyncMode()` / `canPushGhlFactoryStage()`, fail closed, runtime read | §15.4, C-2 |
| c | `src/server/katana/order-status.ts`: pure; status literals exported `as const`; `expectedMoIds` signature | §15.4a, §VI R-12 |
| d | `src/server/ghl/opportunity-stage.ts`: `stageIdFor`, `assertStageConfigDisjoint`, `moveOpportunityStage`; no Katana imports; `!ok` throws | §15.4b, §VI R-11 |
| e | `src/inngest/katana-order-status.ts`: `katanaMoDone` (hub-first, zero Katana calls), `syncKatanaOrderStatus` (ends after `persist-hub-status`, emits `ghl/factory_stage.push_requested` with **no stage** in the payload), `katanaOrderStatusReconcile`, with the exact ids, triggers, and concurrency | §VI.3, §VII.3, §VII S-1 |
| f | `src/inngest/ghl-factory-stage-push.ts`: no `KATANA_TENANT_CONCURRENCY`, throttle 20/10 s, retries 4; re-reads the hub row; `path_a` rows emit `PATH_A_GHL_SYNC_REQUESTED_EVENT` with the `data` shape from `path-a-ghl-sync.ts` | §VII.3 |
| g | `src/server/katana/po-receipt-ledger.ts`: pure; no `Date.now`, `new Date(`, `randomUUID` | §15.2a, §VI R-4, §VII S-5 |
| h | `src/inngest/katana-po-received.ts`: ends after `record-receipt`; always records; supplier problems stored as `vendor_ref_error`; transaction-scoped advisory lock on `getDb()` | §VII S-7 |
| i | `src/inngest/katana-po-bill-post.ts`: `post-katana-po-bill` (no function-level idempotency), `redrive-katana-po-bill` (new `requestid` suffix), `resolve-katana-po-bill` | §VII.3, §VII S-3 |
| j | `src/server/integrations/qbo/client.ts`: `requestId` and `docNumber` required; no `"81"` fallback; `resolveOrCreateQboVendor` deleted; throws on a missing bill id | D-10, D-12 |
| k | `src/server/pipeline/ledger-mode.ts` split; only `clover-sync.ts`, `katana-po-received.ts`, `qbo/client.ts` rewired (Woo deferred) | §I.3, §VI R-15 |
| l | `scripts/ops/redrive-parked-po-bills.ts`: emits typed events only, no DB writes, no Katana or QBO calls, dry run by default | §VII S-4 |
| m | Every function above registered in `inngestFunctions` (`src/inngest/functions.ts`), no duplicate ids; Katana-tenant `it.each` in `tests/woo-static-guards.test.ts` extended | §VI.3, §VII.3 |
| n | Tests cover QA-15.2-01 … 08, QA-15.4-01 … 09, every `QA-R*` and `QA-S*`, and QA-I-03 in `tests/ledger-mode.test.ts` | §VI.4 |

**2.4 Resolve the `fetchKatana` grep gate.** The old gate `rg "fetchKatana" src/inngest/katana-order-status.ts` is a false positive. It matches the sanctioned read helper `fetchKatanaSalesOrderSnapshot` (`katana-order-status.ts:59`), which calls `katanaFetch` inside `runKatanaStep`. The invariant it was meant to enforce is "no legacy `fetchKatana(` client calls and no Katana writes in the reverse flow". That invariant is already asserted by `tests/phase15-reverse-flow-resilience.test.ts` (`not.toContain("fetchKatana(")`). Replace the gate with the precise checks listed in Validation Checkpoint item 2 below. Do not rename the helper and do not weaken the test.

**2.5 Webhook simulation.**
1. Read `scripts/qa/simulate-webhooks.ts`. It currently covers the signature check, the SKU auto-heal, and a `sales_order.updated` delivery that asserts the non-enqueuing `failed` audit branch.
2. Add signed `manufacturing_order.done` and two identical `purchase_order.partially_received` deliveries. Assert 200, plus `queued: true` where the route enqueues (Parent §15.5.2). The duplicate PO delivery must return 200 twice and produce no second ledger row.
3. If an enqueue path cannot be exercised in the QA environment (for example, no Inngest dev server), do **not** assert a weaker result. Report it under VERIFY with the raw output.
4. DB-1 check, then `npm run qa:phase4-webhooks`. Paste the raw output.

**2.6 Certify.** `npm run qa:lifecycle` must exit 0. Then run QCA.

Commit (only if 2.3–2.5 changed files): `phase-15(2): certify Katana reverse flow and close audit gaps`.

### Validation Checkpoint

1. The lock `target_test`: `npx vitest run tests/phase15-katana-reverse-flow.test.ts tests/phase15-po-receipt-ledger.test.ts tests/phase15-reverse-flow-resilience.test.ts` passes.
2. Grep gates, each expecting **0 hits**:
   - `rg "fetchKatana\(" src/inngest/katana-order-status.ts src/inngest/ghl-factory-stage-push.ts`
   - `rg "@/lib/katana|KATANA_TENANT_CONCURRENCY" src/inngest/ghl-factory-stage-push.ts src/server/ghl/opportunity-stage.ts`
   - `rg "method:\s*[\"'](POST|PUT|PATCH|DELETE)[\"']" src/inngest/katana-order-status.ts src/inngest/katana-po-received.ts`
   - `rg "onFailure" src/inngest/katana-order-status.ts src/inngest/ghl-factory-stage-push.ts src/inngest/katana-po-bill-post.ts`
   - `rg "getMutexDb" src/inngest/katana-order-status.ts src/inngest/katana-po-received.ts`
   - `rg '"81"' src/server/integrations/qbo/`
   - `rg "Katana Vendor|resolveOrCreateQboVendor" src/`
3. `rg "LEDGER_PIPELINE_MODE" src/` may hit only `ledger-mode.ts`, `env.ts`, and the deferred Woo files.
4. Registration test: no duplicate function ids.
5. The 2.2 test-DB verification and the 2.5 `qa:phase4-webhooks` output, both raw.
6. `npm run qa:lifecycle` exits 0, then the QCA JSON.

### Operator Runbook (after QC)

None for the database (0057 is already in production). Keep `KATANA_REVERSE_SYNC_MODE`, `QBO_LEDGER_MODE`, and `CLOVER_LEDGER_MODE` at `log` in every deployment.

### Stop & Commit

Print the §0.5 handback, including all V-1 … V-14 answers. STOP. `Awaiting "PROCEED TO PHASE 3".`

---

## PHASE 3 — Airlock Migration & Hand-off

**Objective:** Write and migrate **only** `0058_factory_airlock.sql`, wire `factory-airlock-release` to the existing Path A Katana writer, and hand the operator a one-migration production runbook.

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
- Production and the test DB are both at high-water mark `1793289542107` (`0057`). `0058` is the **only** pending migration. Nothing in this phase touches 0046–0057.

### Action Steps

**3.1 Write `0058_factory_airlock.sql`.**
1. DB-1 host check. Generate a draft: `npx dotenv -e .env.test.local -- npx drizzle-kit generate --name factory_airlock`. Generate does not connect, but the config demands `POSTGRES_URL`.
2. Make sure the result is: tag `0058_factory_airlock`, journal idx **60**, snapshot `meta/0060_snapshot.json`, and journal `when` **strictly greater than `1793289542107`**. If drizzle-kit chose another tag, fix the tag in the new journal entry and the file name. Never renumber or edit older entries (DB-5).
3. The generated DDL must contain **only** the `factory_airlock_status` type, the two `factory_airlock_*` tables, their indexes, CHECKs, and FKs. Compare with `docs/AIRLOCK_DUAL_APPROVAL.md` "Schema change". Any other statement means the snapshot and schema have drifted: HALT.
4. Prepend the hand-written header used by `0057`: "ADDITIVE ONLY ... never applied with drizzle-kit push". Append `ENABLE ROW LEVEL SECURITY` for both tables, if drizzle did not emit it, and guarded `REVOKE ALL ... FROM anon, authenticated` blocks in the `0057` style.
5. Update the `schema.ts:1701` comment so it reads "Migration 0058_factory_airlock". Update `AIRLOCK_DUAL_APPROVAL.md` status and file name (OD-3).
6. Create `tests/factory-airlock-migration.test.ts`:
   - The static check from QA-15.1-01 (no `DROP`, `ALTER COLUMN`, `ALTER TYPE`, `RENAME`, `TRUNCATE`, `DELETE`).
   - The CHECK strings in `schema.ts` equal those in the SQL (the Phase 14 technique).
   - The journal's last entry is idx 60, tag `0058_factory_airlock`, and its `when` > `1793289542107`. The previous entry is still idx 59 `0057_katana_reverse_flow` with `when` `1793289542107`.
7. `npx dotenv -e .env.test.local -- npx drizzle-kit check` exits 0.

Commit: `phase-15b(3.1): add additive 0058_factory_airlock migration`.

**3.2 Migrate 0058 on the local test database.**
1. DB-1 check. Record the test tracker row count and `max(created_at)` (expect `1793289542107`).
2. Run DB-2: `npx dotenv -e .env.test.local -- npx drizzle-kit migrate`. It must apply exactly one migration, `0058_factory_airlock`.
3. Verify on the test DB: `to_regclass` is not null for `factory_airlock_builds` and `factory_airlock_decisions`; `relrowsecurity = true` on both; the tracker gained exactly one row; and the new `max(created_at)` equals the 0058 journal `when`.
4. Run DB-2 a second time. It must apply nothing.
5. Paste all raw outputs in the handback.

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
4. `git diff <base_ref>..HEAD --name-only -- src/server/db/migrations/` lists only `0058_factory_airlock.sql`, `meta/0060_snapshot.json`, and `meta/_journal.json`. The `_journal.json` diff adds one entry and changes nothing else.
5. The 3.2 test-DB migrate outputs are pasted.
6. `npm run qa:lifecycle` exits 0, then the QCA JSON.

### Operator Runbook — production migration (HUMAN ONLY, after Phase 3 QC)

Prerequisite: the production tracker high-water mark is still `1793289542107` (`0057`). Confirm it with a read-only `select count(*), max(created_at) from drizzle.__drizzle_migrations;`, which should return 58 and `1793289542107`. If not, stop.
1. Take a backup or record a PITR timestamp.
2. From a checkout at the Phase 3 HEAD, run `npm run db:migrate`. It applies exactly one migration: `0058_factory_airlock`. No enum pre-step is needed.
3. Verify with read-only queries: `to_regclass` is not null for `factory_airlock_builds` and `factory_airlock_decisions`; `relrowsecurity = true` on both; the tracker has 59 rows and `max(created_at)` equals the journal `when` of `0058_factory_airlock`.
4. Deploy the app **after** step 3. Keep `GHL_FACTORY_ORDERS`, `KATANA_REVERSE_SYNC_MODE`, `QBO_LEDGER_MODE`, and `CLOVER_LEDGER_MODE` at `log`.
5. Ensure the Factory Manager (Christian) has a `user_roles` row with `Ops_Manager`.
6. In Katana settings, add webhook subscriptions for `sales_order.updated`, `sales_order.packed`, `sales_order.delivered`, `manufacturing_order.done` (Parent §I.5.5).

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
- `CATALOG_PUBLISH_MODE` stays Katana-only (Parent C-5). The Woo gate is the new `WOO_CATALOG_PUBLISH_MODE`, declared in `src/env.ts` by Phase 1.2.
- Keep `WOOCOMMERCE_URL`. `WOOCOMMERCE_API_URL` must never appear (Parent C-2). `WOOCOMMERCE_TARGET` is declared in `src/env.ts` by Phase 1.2.
- Woo `status: "draft"` on **create only**; on **update**, omit `status` (Parent C-6). Never `manage_stock: true`.
- The backfill makes no Katana, Clover, or QBO calls and does not carry `KATANA_TENANT_CONCURRENCY`.
- The Woo lane must never reach `order_intake` or `src/server/ghl/` (Parent §16.4).

### Action Steps

1. **Create `src/server/woocommerce/devsite-guard.ts`** (Parent §I.2). Wire usage site 1 (`wooFetch` non-GET) and usage site 2 (the Woo webhook route floor check: 200 `below_devsite_floor`, or 503 when the floor is unset on devsite).
2. **Create `src/server/pipeline/woo-catalog-mode.ts`**: `getWooCatalogPublishMode()`, `canMutateWooCatalog()`, fail closed, runtime read from `process.env` (C-2).
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
- **If not found** (the state on 2026-11-07): build exactly the specification in this section. Do not invent features beyond it: no quizzes engine beyond the knowledge-check shape below, no file uploads (OD-5), no GHL writes, no email.

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

**Migration `0059_employee_certifications.sql`** (journal idx 61, `meta/0061_snapshot.json`, `when` > the 0058 `when`; generate via the DB-1/DB-2-safe `drizzle-kit generate`, then add the hand header, RLS, and guarded REVOKEs exactly as in 3.1):

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

Apply `0059_employee_certifications` to production with `npm run db:migrate`. It is a single additive migration on top of 0058, with no enum hazard. Verify `to_regclass` and that the tracker has 60 rows. Deploy. Pilot `/embed/academy` with one role before any cut-over from `/embed/training` (a separate decision).

### Stop & Commit

Print the §0.5 handback. STOP. **End of this blueprint.** Do not start any further work.

---

## Appendix A — Quick "never" list

- Never run `npm run db:migrate`, `db:push`, `drizzle-kit push`, `db:seed*`, `migrate:*`, or any `--confirm` script.
- Never point any command at a non-local Postgres host.
- Never call a Katana write endpoint. Never create a second Katana sales-order or manufacturing-order writer.
- Never set a mode flag to `live` in a file.
- Never edit `.cursor/phase.lock`, an existing migration SQL file, an existing snapshot, or an existing `_journal.json` entry.
- Never weaken a test or mock Postgres in Phase 2 DB proof.
- Never swallow an error. Never add an alerting `onFailure`.
- Never call QBO or GHL from a function that holds `KATANA_TENANT_CONCURRENCY`.
- Never write `order_intake.status` / `version` from the reverse flow.
- Never send Woo `status` on update, `"publish"`, a `$0.00` price, or `manage_stock: true`.
- Never trust a client-sent quiz score, or an embed-iframe email, as an authorization.
- Never continue past a STOP without `PROCEED TO PHASE <n>`.

## Appendix B — Migration numbering (production state as of 2026-11-07)

Production tracker: 58 rows, `max(created_at) = 1793289542107`. The local journal has 60 entries (idx 0–59). The tracker holds 58 rows because the operator's manual repair recorded the high-water mark rather than one row per historic entry. Drizzle only compares journal `when` values against the single latest `created_at`, so every entry at or below `1793289542107` counts as applied.

| Journal idx | SQL tag | Snapshot | Production state |
|---|---|---|---|
| 46 | `0045_ecommerce_listings_slug_unique` | `0046_snapshot.json` | applied and tracked |
| 47 | `0046_bitter_red_ghost` | `0047_snapshot.json` | applied and tracked |
| 48 | `0047_strange_wong` | `0048_snapshot.json` | applied and tracked |
| 49 | `0048_reflective_human_cannonball` | `0049_snapshot.json` | applied and tracked |
| 50 | `0049_free_stellaris` | `0050_snapshot.json` | applied and tracked |
| 51 | `0050_even_chamber` | `0051_snapshot.json` | applied and tracked |
| 52 | `0051_numerous_adam_warlock` | `0052_snapshot.json` | applied and tracked |
| 53 | `0052_custom_build_jobs` | `0053_snapshot.json` | applied and tracked |
| 54 | `0053_rls_qbo_tokens_incoming_webhooks` | `0054_snapshot.json` | applied and tracked (H-2 resolved) |
| 55 | `0054_sre_dlq_saga_buckets` | `0055_snapshot.json` | applied and tracked |
| 56 | `0055_path_a_stateless_release` | none (hand-written; no `0056_snapshot.json` exists, do not create one) | applied and tracked (H-3 resolved) |
| 57 | `0056_pos_receipts` | `0057_snapshot.json` | applied and tracked |
| 58 | `0056_ledger_triage` | `0058_snapshot.json` | applied and tracked |
| 59 | `0057_katana_reverse_flow` | `0059_snapshot.json` | applied and tracked; **high-water mark** `1793289542107` |
| 60 | `0058_factory_airlock` (Phase 3) | `0060_snapshot.json` | not yet written; the only migration Phase 3 creates |
| 61 | `0059_employee_certifications` (Phase 5) | `0061_snapshot.json` | not yet written |
