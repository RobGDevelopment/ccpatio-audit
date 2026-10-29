# BLUEPRINT — Katana Reverse Flow + WooCommerce DevSite (Phases 15–16)

**Document type:** Architectural execution blueprint + QA audit rubric. **No application code lives in this file.**
**Audience:** Google AntiGravity (AG), the implementing agent. Cursor grades AG's output against the `QA-*` criteria below.
**Author role:** Lead Integration Architect / QA Inspector (Cursor).
**Date:** 2026-10-29.
**Revision 2 (2026-10-29, same day):** imported into the repo at `docs/`; active lock rotated to `phase-15-katana-lifecycle`; executive decisions D-6 and D-10 recorded; NetSuite-grade edge-case sweep appended as **Section VI (R-1 … R-17)**. **Section VI is binding and wins over any earlier passage it amends.** Passages it overturns carry an inline `⚠ AMENDED BY §VI R-n` marker. AG must read Section VI before starting step 15.0.

---

## 0. READ THIS FIRST (AG operating contract)

### 0.1 Grounding baseline (verified against the repository on 2026-10-29)

| Fact | Value | Where verified |
|---|---|---|
| HEAD | `ec87d08` ("Require a factory manager to approve a custom BOM before Katana.") | `git log` |
| Active phase lock | `phase-15-katana-lifecycle` (`.cursor/phase.lock`, rotated in rev 2; was `phase-14-qbo-ledger`) | file |
| Next.js | `16.3.2` (App Router) | `package.json`, `PROJECT_STATE.md` |
| Inngest SDK | `4.18.1` | `node_modules/inngest/package.json` |
| Drizzle ORM / Kit | `^0.45.2` / `^0.31.10` | `package.json` |
| Zod | `^4.4.3` | `package.json` |
| Last migration SQL | `0056_ledger_triage.sql` (journal idx 58) | `src/server/db/migrations/meta/_journal.json` |
| Last snapshot | `meta/0058_snapshot.json` (snapshot numbers follow the journal idx, **not** the SQL tag; there are two `0056_*` SQL files) | `meta/` |
| QA gauntlet | `npm run qa:lifecycle` (build → DB proof → unit → hygiene-live → phase14-live → webhooks → e2e) | `package.json` |

**AG must re-verify every row above before starting.** If any value differs (e.g. HEAD moved, a `0057_*` migration already exists), STOP and report. Do not "adapt" silently.

### 0.2 Binding precedence (from `CLAUDE.md`)

1. `FINAL_INTEGRATION_ROADMAP.md` (supreme).
2. `docs/MDM_MASTER_BLUEPRINT.md` (catalog, PIM, Factory BOM, GHL factory lane §2.4).
3. This blueprint (scoped to Phases 15–16).

### 0.3 Global hard guardrails (apply to EVERY step; a single violation fails the phase)

| ID | Guardrail |
|---|---|
| G-1 | **Katana is ONE live tenant, no sandbox.** No step in this blueprint may create, update or delete a Katana sales order, MO, PO, product, material or variant, except the existing `archiveKatanaVariant` path (step 15.2c). Reverse flow is **read-only against Katana**. |
| G-2 | **Schema changes are additive only.** `CREATE TABLE`, `ADD COLUMN` (nullable or with default), `CREATE INDEX`. No `DROP`, no `ALTER COLUMN ... TYPE`, no `ALTER TYPE ... ADD VALUE`, no `RENAME`. |
| G-3 | **Never run `drizzle-kit push`** (`npm run db:push`). Never wipe hub data. Never delete a paid order or a `saga_runs` row. |
| G-4 | **No swallowed errors.** Every `catch` must either rethrow, throw `NonRetriableError`, or return a typed failure that the caller turns into a thrown error or a non-2xx response. `catch {}` and `catch (e) { console.error(e) }` without rethrow are forbidden. |
| G-5 | **Every new external write is behind a `log`/`live` mode flag that fails closed** (unset / empty / garbage ⇒ `log`). Flags are read at **runtime** (inside a function/step), never at module import. |
| G-6 | **Global DLQ is the single alert authority.** No new Inngest function may define an `onFailure` that calls `sendOhCrapAlert` / `alertPipelineFailure` (enforced by `tests/woo-static-guards.test.ts`). |
| G-7 | **Katana-calling functions carry `KATANA_TENANT_CONCURRENCY`** and wrap Katana I/O in `runKatanaStep(...)` using `katanaFetch` from `@/lib/katana` (the shared 1 req/s bucket). `fetchKatana` from `@/lib/katana/client` bypasses the bucket and is **not** allowed in new code. |
| G-8 | Still forbidden (CLAUDE.md §4): V8 custom outbox, Redis CCR leases, `effect_claims`, Trigger.dev, DLQ UI, `/api/admin/redrive`, JSONB BOM trees, visual field mappers, auto-Approve of catalog products from CAD. |
| G-9 | **Do not edit any test to force a pass.** Phase 2 (`qa:phase2-db`) talks to real Postgres. Adding new tests is required; weakening existing assertions is a defect. |
| G-10 | Next.js: before touching any route/caching API, read the relevant guide in `node_modules/next/dist/docs/` (per `AGENTS.md`). Keep `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` on webhook routes. |

### 0.4 Corrections to the brief (the brief contained assumptions that do not match the code)

These are authoritative. Where the brief and this section disagree, **this section wins**.

| ID | Brief said | Reality in code | Blueprint ruling |
|---|---|---|---|
| **C-1** | "Add `'katana'` to the `incoming_webhooks.source` **enum**" via SQL. | `incoming_webhooks.source` is a plain **`text`** column (`0005_incoming_webhooks.sql`: `source text NOT NULL`). The enum exists **only in Drizzle** (`schema.ts:1149`, `text("source", { enum: ["woocommerce","ghl","cad_convert"] })`) and in the TS union `WebhookLogInput.source` (`src/server/webhooks/incoming-log.ts:6`). There is **no Postgres enum type and no CHECK constraint**. | **No `ALTER TYPE`. No SQL is required for this change.** It is a TypeScript-only change in two files (step 15.1a). AG must NOT add a CHECK constraint on `incoming_webhooks` (it would be a new restriction on a live table holding PII and is out of scope). The phase-15 migration (`0057_katana_reverse_flow.sql`) exists for *other* additive objects (15.1b). |
| **C-2** | Env var `WOOCOMMERCE_API_URL`. | The code reads **`WOOCOMMERCE_URL`** in four places: `src/lib/woocommerce-catalog.ts:18`, `src/server/mdm/token-health.ts:19` and `:99`, `src/app/mission-control/actions.ts:74`. `.env.example:86` documents `WOOCOMMERCE_URL`. | **Keep `WOOCOMMERCE_URL`. Do NOT introduce `WOOCOMMERCE_API_URL`** (a second name for the same thing would split config and let one code path hit production while another hits the DevSite). Any occurrence of `WOOCOMMERCE_API_URL` in the diff is a defect. |
| **C-3** | "Append timestamp/qty to the QBO `requestid`." | `requestid` = `qboRequestId(\`katana:po:${id}\`, "ap-bill")` (`qbo/client.ts:191`). Appending a **wall-clock timestamp** would give every Inngest retry a *new* requestid, so a retried POST would create a **second bill**. That makes duplicates worse, not better. | Use a **deterministic receipt fingerprint** (hash of each PO row id + its cumulative received quantity). Same receipt state ⇒ same requestid, forever; a new partial receipt ⇒ new fingerprint ⇒ new requestid. `Date.now()`, `new Date()`, `crypto.randomUUID()` inside requestid derivation are **forbidden**. See 15.2a. |
| **C-4** | Partial receipts "create duplicate bills". | Two defects, not one: **(a) under-billing** — the route sends Inngest event id `katana:po:{id}:{action}` (`route.ts:99`), so a 2nd `purchase_order.partially_received` for the same PO within Inngest's 24 h idempotency window is **silently dropped**; **(b) over-billing** — lines use `received_quantity ?? quantity` (cumulative), so any bill posted after a prior receipt re-bills the already-billed quantity; and a final `purchase_order.received` re-bills the whole PO. | 15.2a fixes both with a delta-billing ledger table (`katana_po_bills`). |
| **C-5** | `CATALOG_PUBLISH_MODE=log` keeps Woo pushes safe. | `publishToWooCommerce` (`src/server/mdm/publish-channels.ts:245`) **never reads any mode flag.** Every `product.approved` event pushes to whatever `WOOCOMMERCE_URL` points at, published, today. Also, `CATALOG_PUBLISH_MODE` gates **Katana** catalog writes (`catalog-mode.ts`); flipping it to `live` to test the DevSite would open writes to the **live Katana tenant**. | New Woo-only flag **`WOO_CATALOG_PUBLISH_MODE`** (fail closed). `CATALOG_PUBLISH_MODE` stays `log` and stays Katana-only. See §I and 16.1. |
| **C-6** | "Push products as `draft`." | `upsertWooCommerceProduct` PUTs the full payload onto an **existing** product. Sending `status: "draft"` on update would **unpublish** every live/cloned product that already exists. | `status: "draft"` on **create only**. On **update**, `status` is **omitted** from the PUT body (the merchandiser owns publish state). See 16.1. |
| **C-7** | "Order routing lacks a terminal state." | The Woo saga never reaches `COMPLETED`: `runWooLedgerLeg` always leaves `IN_PROGRESS` (`ledger_dry_run` or `awaiting_ledger_step_8`). The header of `ledger-leg.ts` documents this as a Phase-10 invariant. | Decision **D-6** (needs operator sign-off): when `WOO_LEDGER_MODE=log`, the saga terminates `COMPLETED` with `current_step = 'completed_ledger_deferred'`. When `live`, unchanged (`IN_PROGRESS` / `awaiting_ledger_step_8`). See §I.4. |
| **C-8** | `readPurchaseOrderReceipt` lives in `katana-po-received.ts`. | It is **duplicated**: identical function + type in `src/inngest/katana-po-received.ts:14-71` **and** `src/server/katana/variant-webhook.ts:38-234`. The route imports the Inngest copy. | Consolidate into one pure module (15.3). |
| **C-9** | Katana webhook deliveries are audited. | The Katana route writes **nothing** to `incoming_webhooks` today. | 15.3 adds an append-only audit row per delivery (source `'katana'`). |
| **C-10** | `env.ts` matches `mode.ts`. | `src/env.ts:24` declares `ORDER_PIPELINE_MODE: z.enum(["log","live"])` but `src/server/pipeline/mode.ts` accepts `"approve"`. `coreEnvSchema.parse` would reject a valid `approve`. | Fix in §I.3 (add `"approve"` to the Zod enum). Additive, low risk. |
| **C-11** | Woo DevSite is isolated by URL alone. | A DevSite **cloned** from www.ccpatio.com inherits the order-id sequence. DevSite order `#N` and a future live order `#N` both map to `saga_runs(path_b_woo, N)` and Katana `WOO-N`. The unique index `saga_runs_type_correlation_uidx` would make the **live** order look like a duplicate. | Hard guard `WOO_DEVSITE_MIN_ORDER_ID` (§I.2) + operator pre-flight (§I.5). |

### 0.5 Decision register

| ID | Decision | Status |
|---|---|---|
| D-1 | Option A: `manage_stock: false` for Katana MTO items (manufactured finished goods). | **Approved by operator.** |
| D-2 | Block `$0.00`/missing MSRP publishes. | **Approved.** |
| D-3 | Woo create = `draft`; Woo update = omit `status` (C-6). | Architect ruling. |
| D-4 | Split ledger flag: `QBO_LEDGER_MODE` (master QBO kill-switch + Katana A/P bill lane), `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`. `QBO_LEDGER_MODE` and `CLOVER_LEDGER_MODE` fall back to legacy `LEDGER_PIPELINE_MODE` when unset (deprecation path); `WOO_LEDGER_MODE` **never** falls back. | Architect ruling. |
| D-5 | Reverse flow persists Katana status into the hub **in both modes**; only the GHL stage PUT is gated by `KATANA_REVERSE_SYNC_MODE`. | Architect ruling. |
| D-6 | Woo saga terminal state in `WOO_LEDGER_MODE=log` = `COMPLETED` / `completed_ledger_deferred` (C-7). This reverses the Phase 10 invariant for Woo sagas so log-mode orders stop generating monitoring noise. | **APPROVED by executive decision (rev 2).** AG executes §I.4 in Phase 16. |
| D-7 | Receipts processed while the A/P lane is in `log` are recorded as `dry_run` and count as "accounted" in delta math. Flipping to `live` never retro-bills old receipts. ⚠ AMENDED BY §VI R-4: "accounted" also includes `pending` and `requires_manual_intervention` rows. | Architect ruling. |
| D-8 | GHL stage moves are **monotonic forward only** and only within `GHL_FACTORY_PIPELINE_ID`. | Architect ruling. |
| D-9 | Phase 17 (BOM-driven lead-time sync) is out of scope. | **Approved.** |
| D-10 | `QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID` has **no default**. No fallback to `81` or any hard-coded integer. Missing or non-numeric ⇒ hard error, saga parked in `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`, Ops alerted through the global DLQ. Financial ledgers fail safe. Same rule for every QBO account id the A/P and Clover lanes read. | **APPROVED by executive decision (rev 2).** See §VI R-6. |
| D-11 | Any Inngest function that carries `KATANA_TENANT_CONCURRENCY` may perform **only** Katana I/O and local Postgres I/O. QBO and GHL calls run in separate functions that do not hold the Katana slot. | Architect ruling (rev 2). See §VI R-1. |
| D-12 | QBO vendor auto-create from the Katana supplier name (existing `resolveOrCreateQboVendor`) stays as-is for Phase 15, but an **inactive** QBO vendor with the same name parks the bill for a human instead of creating a duplicate. Whether to replace auto-create with a Katana-supplier → QBO-vendor mapping table is an **open operator question** (not Phase 15). | Open. AG surfaces in handback. |
| D-13 | Webhooks are hints, not the guarantee. A low-rate reconciliation cron re-drives open hub orders through the same status event. | Architect ruling (rev 2). See §VI R-10. |

### 0.6 Phase locks AG must create (Triad Kernel Track 2)

**Rev 2: the Phase 15 lock is ACTIVE.** `.cursor/phase.lock` now carries `phase_id: "phase-15-katana-lifecycle"`, `base_ref: "ec87d08"`, and `target_test: "npx vitest run tests/phase15-katana-reverse-flow.test.ts tests/phase15-po-receipt-ledger.test.ts tests/phase15-reverse-flow-resilience.test.ts"`. **The lock file is the authority for `allowed_files`**; the list below is the original proposal, kept for history. The live lock adds: this blueprint (`docs/BLUEPRINT_Katana_ReverseFlow_WooCommerce_DevSite_Phases15-16.md`), `src/inngest/katana-step.ts`, `src/inngest/katana-po-bill-post.ts` (new), `src/inngest/ghl-factory-stage-push.ts` (new), `src/inngest/katana-variant-heal.ts` (new), `src/inngest/dlq-context.ts`, and `tests/phase15-reverse-flow-resilience.test.ts` (new). See §VI R-16 for the dirty-tree pre-flight that must happen before AG's first edit.

~~Proposed lock bodies~~ (historical):

**Phase 15 lock (historical proposal, superseded by the live lock)** — `phase_id: "phase-15-katana-reverse-flow"`, `mode: "edit"`, `target_test: "npx vitest run tests/phase15-katana-reverse-flow.test.ts tests/phase15-po-receipt-ledger.test.ts"`, `allowed_files`:

```
.cursor/phase.lock
.cursor/session-stamp.json
.env.example
package.json
src/env.ts
src/server/pipeline/ledger-mode.ts
src/server/pipeline/katana-reverse-mode.ts            (new)
src/server/db/schema.ts
src/server/db/migrations/0057_katana_reverse_flow.sql  (new)
src/server/db/migrations/meta/
src/server/webhooks/incoming-log.ts
src/server/katana/webhook-events.ts                   (new)
src/server/katana/variant-webhook.ts
src/server/katana/po-receipt-ledger.ts                (new)
src/server/katana/order-status.ts                     (new)
src/server/ghl/factory-stage.ts
src/server/ghl/opportunity-stage.ts                   (new)
src/server/integrations/qbo/client.ts
src/inngest/katana-po-received.ts
src/inngest/katana-order-status.ts                    (new)
src/inngest/clover-sync.ts
src/inngest/functions.ts
src/app/api/webhooks/katana/route.ts
tests/phase15-katana-reverse-flow.test.ts             (new)
tests/phase15-po-receipt-ledger.test.ts               (new)
tests/ledger-mode.test.ts
tests/woo-static-guards.test.ts
tests/fixtures/katana/                                (new dir)
scripts/qa/simulate-webhooks.ts
```

**Phase 16 lock** — `phase_id: "phase-16-woo-devsite-mto"`, `target_test: "npx vitest run tests/phase16-woo-catalog-safety.test.ts tests/woo-static-guards.test.ts tests/woo-replay-dry-runs.test.ts"`, `allowed_files`:

```
.cursor/phase.lock
.cursor/session-stamp.json
.env.example
package.json
src/env.ts
src/server/pipeline/ledger-mode.ts
src/server/pipeline/woo-catalog-mode.ts               (new)
src/mappers/types.ts
src/mappers/woocommerce.ts
src/lib/woocommerce-catalog.ts
src/server/mdm/publish-channels.ts
src/server/mdm/load-hub-product-graph.ts
src/server/woocommerce/ledger-leg.ts
src/server/woocommerce/devsite-guard.ts               (new)
src/app/api/webhooks/woocommerce/route.ts
src/inngest/woo-order.ts
src/inngest/woo-catalog-backfill.ts                   (new)
src/inngest/functions.ts
scripts/ops/trigger-woo-catalog-backfill.ts           (new)
scripts/ops/replay-woo-dry-runs.ts                    (new)
tests/phase16-woo-catalog-safety.test.ts              (new)
tests/woo-replay-dry-runs.test.ts                     (new)
tests/woo-static-guards.test.ts
tests/woo-order-saga.test.ts
tests/ledger-mode.test.ts
```

Any edit outside the active lock's `allowed_files` is a **Track 2 violation** and fails QCA.

---

## I. Environment & DevSite Configuration

### I.1 Environment variable contract

All flags: lower-cased + trimmed on read; anything other than the literal `live` ⇒ `log`. Read via small getter functions in `src/server/pipeline/*` that read `process.env` directly. **Never import `src/env.ts` from these getters** (its Proxy throws when `POSTGRES_URL` is missing; see `ledger-mode.ts` header).

| Variable | Values / default | Read by (exact file) | Purpose |
|---|---|---|---|
| `WOOCOMMERCE_URL` | URL, no default | `src/lib/woocommerce-catalog.ts`, `src/server/mdm/token-health.ts`, `src/app/mission-control/actions.ts` (existing) | **Point at the DevSite** for Phases 15–16, e.g. `https://dev.ccpatio.com`. Trailing slash stripped (existing). |
| `WOOCOMMERCE_CONSUMER_KEY` / `WOOCOMMERCE_CONSUMER_SECRET` | strings | `woocommerce-catalog.ts` (existing) | **DevSite REST keys**, never the production keys. |
| `WOOCOMMERCE_WEBHOOK_SECRET` | string | `src/app/api/webhooks/woocommerce/route.ts:151` (existing) | The **DevSite** webhook secret. Route already fails closed (503) when unset. |
| `WOOCOMMERCE_TARGET` (**new**) | `devsite` \| `production`; default **`devsite`** | `src/server/woocommerce/devsite-guard.ts` (new) | Declares which store this hub deployment talks to. |
| `WOOCOMMERCE_PRODUCTION_HOSTS` (**new**) | comma list; default `ccpatio.com,www.ccpatio.com` | `devsite-guard.ts` | Hosts that are refused for any Woo REST **write** unless `WOOCOMMERCE_TARGET=production`. |
| `WOO_DEVSITE_MIN_ORDER_ID` (**new**) | positive integer; **required** when target=`devsite` | `devsite-guard.ts`, Woo route, replay script | Order-id floor (C-11). |
| `WOO_CATALOG_PUBLISH_MODE` (**new**) | `log`\|`live`; default `log` | `src/server/pipeline/woo-catalog-mode.ts` (new) | Gates Woo catalog REST writes (C-5). |
| `CATALOG_PUBLISH_MODE` | `log` (keep) | `src/server/pipeline/catalog-mode.ts` (existing) | **Katana catalog only.** Must remain `log` for the whole DevSite program. |
| `ORDER_PIPELINE_MODE` | `log` (keep) | `src/server/pipeline/mode.ts` (existing) | **Must remain `log`** during DevSite testing: `live` would create real Katana SOs/MOs from DevSite orders (G-1). |
| `QBO_LEDGER_MODE` (**new**) | `log`\|`live`; unset ⇒ falls back to `LEDGER_PIPELINE_MODE`, else `log` | `ledger-mode.ts` | Master QBO write kill-switch **and** the Katana PO → QBO Bill lane. |
| `CLOVER_LEDGER_MODE` (**new**) | same fallback as above | `ledger-mode.ts` | Clover → QBO SalesReceipt lane. |
| `WOO_LEDGER_MODE` (**new**) | `log`\|`live`; **no fallback**, default `log` | `ledger-mode.ts` | Woo ledger leg. Isolates Woo tests from Clover/QBO tests. |
| `LEDGER_PIPELINE_MODE` | legacy | `ledger-mode.ts` only (fallback source) | Deprecated. After Phase 16 no other file may read it. |
| `KATANA_REVERSE_SYNC_MODE` (**new**) | `log`\|`live`; default `log` | `src/server/pipeline/katana-reverse-mode.ts` (new) | Gates the GHL stage PUT in the reverse flow (D-5). |
| `GHL_FACTORY_PIPELINE_ID` (**new**) | GHL pipeline id | `src/server/ghl/opportunity-stage.ts` (new) | Only opportunities in this pipeline are moved (D-8). |
| `GHL_STAGE_ID_IN_PRODUCTION` (**new**) | GHL stage id, optional | `opportunity-stage.ts` | Target for derived stage `in_production`. Unset ⇒ that move is skipped (logged, not an error). |
| `GHL_STAGE_ID_BUILD_COMPLETE` (**new**) | optional | same | Target for `build_complete`. |
| `GHL_STAGE_ID_READY_TO_SHIP` (**new**) | optional | same | Target for `ready_to_ship`. |
| `GHL_STAGE_ID_DELIVERED` (**new**) | optional | same | Target for `delivered`. |
| `KATANA_WEBHOOK_SECRET` | existing | Katana route | Unchanged. |
| `QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID` | numeric QBO account id; **no default** (D-10) | `src/server/integrations/qbo/client.ts`, `post-katana-po-bill` | Missing/non-numeric in live ⇒ bill parked + DLQ alert (§VI R-6). |
| `QBO_GATEWAY_CLEARING_ACCOUNT_ID` | numeric; **no default** | `pushToQBO` | Same fail-closed rule (§VI R-6). |
| `LEDGER_COMPANY_TIMEZONE` (**new**, rev 2) | IANA zone, **no default** | `post-katana-po-bill` | Converts the Katana receipt date to the QBO `TxnDate` (§VI R-8). Required for live posting. |

**Echo-loop rule (mandatory):** none of the four `GHL_STAGE_ID_*` values may appear in `GHL_FACTORY_STAGE_IDS` or `GHL_WON_STAGE_IDS` (`src/server/ghl/factory-stage.ts`). Otherwise our own stage PUT re-triggers `/api/webhooks/ghl` (`route.ts:108` `isProduceFactoryOrderStage`) and re-enters the factory intake. `opportunity-stage.ts` must expose `assertStageConfigDisjoint()` which throws on overlap; the saga calls it before any PUT.

### I.2 DevSite guard module — `src/server/woocommerce/devsite-guard.ts` (new, Phase 16)

Pure functions, no I/O, `process.env` injectable as an argument for tests:

- `getWooTarget(env = process.env): "devsite" | "production"` — default `devsite`.
- `assertWooWriteHostAllowed(baseUrl: string, env = process.env): void` — parse `new URL(baseUrl).hostname`, lower-case. If hostname ∈ `WOOCOMMERCE_PRODUCTION_HOSTS` and target ≠ `production` ⇒ throw `WooCommerceApiError("Refusing Woo write: WOOCOMMERCE_URL host is a production host but WOOCOMMERCE_TARGET is not 'production'", 0)`. Never include keys/secrets in the message.
- `getDevsiteMinOrderId(env = process.env): number | null` — `null` when target=`production`; when target=`devsite` and value missing/invalid ⇒ **throw** (config error, fail closed).
- `isBelowDevsiteFloor(orderId: number, env = process.env): boolean`.

**Usage sites (exact):**
1. `src/lib/woocommerce-catalog.ts` → `wooFetch` calls `assertWooWriteHostAllowed(baseUrl)` when `options.method` is `POST`/`PUT`/`PATCH`/`DELETE`. GETs (token-health) unaffected.
2. `src/app/api/webhooks/woocommerce/route.ts` → after signature verification and JSON parse, **before** `insertIncomingWebhookOnce`: if `isBelowDevsiteFloor(order id)` ⇒ `logRoute("log","woo-webhook-below-devsite-floor",{orderId})` and return `200 { ignored: true, reason: "below_devsite_floor" }`. If `getDevsiteMinOrderId` throws ⇒ return `503 { error: "webhook_not_configured" }` (same contract as missing secret).
3. `scripts/ops/replay-woo-dry-runs.ts` (16.5).

### I.3 Ledger flag split — `src/server/pipeline/ledger-mode.ts`

Keep the existing exports (`LedgerPipelineMode`, `getLedgerPipelineMode`, `canMutateLedger`) **for one phase** as deprecated wrappers so nothing breaks mid-migration; add:

- `export type LedgerLane = "qbo" | "clover" | "woo";`
- `export function getLedgerMode(lane: LedgerLane, env = process.env): LedgerPipelineMode`
  - `woo`: reads `WOO_LEDGER_MODE` only.
  - `qbo`: reads `QBO_LEDGER_MODE`; if unset/empty ⇒ `LEDGER_PIPELINE_MODE`; else `log`.
  - `clover`: reads `CLOVER_LEDGER_MODE`; if unset/empty ⇒ `LEDGER_PIPELINE_MODE`; else `log`.
- `export function canPostToQbo(lane: "qbo" | "clover", env = process.env): boolean` ⇒ `getLedgerMode("qbo") === "live" && getLedgerMode(lane) === "live"` (master AND lane; for lane `qbo` that is just the master).

**Call-site rewiring (exact):** ⚠ AMENDED BY §VI R-15: the `woo-order.ts` and `ledger-leg.ts` rows are executed in **Phase 16** (those files are outside the Phase 15 lock). Phase 15 keeps the deprecated `getLedgerPipelineMode` wrapper so they still compile; QA-I-02 is graded at the Phase 16 gate.

| File | Today | After |
|---|---|---|
| `src/inngest/clover-sync.ts:78` | `getLedgerPipelineMode()` | `canPostToQbo("clover")` decides live vs dry-run; result `mode` field stays `"log"`/`"live"` (tests assert it). |
| `src/inngest/katana-po-received.ts:155` | `getLedgerPipelineMode()` | `getLedgerMode("qbo")`. Dry-run message text must name `QBO_LEDGER_MODE`. |
| `src/server/integrations/qbo/client.ts:88` (`pushToQBO`) | `getLedgerPipelineMode()` | `canPostToQbo("clover")`; error text keeps the substring `fail-closed ledger containment` (asserted by `tests/ledger-mode.test.ts:176`). |
| `src/server/integrations/qbo/client.ts:168` (`createQboVendorBillFromKatanaPo`) | `getLedgerPipelineMode()` | `canPostToQbo("qbo")`; same substring. |
| `src/inngest/woo-order.ts:94` (`defaultWooSagaDeps.getModes`) | `getLedgerPipelineMode()` | `getLedgerMode("woo")`. |
| `src/server/woocommerce/ledger-leg.ts:35` | `getLedgerPipelineMode()` | `getLedgerMode("woo")`. Log line text says `WOO_LEDGER_MODE`. |
| `src/env.ts` | `LEDGER_PIPELINE_MODE` only | add `QBO_LEDGER_MODE`, `CLOVER_LEDGER_MODE`, `WOO_LEDGER_MODE`, `WOO_CATALOG_PUBLISH_MODE`, `KATANA_REVERSE_SYNC_MODE` as `z.enum(["log","live"]).optional()` (optional so the fallback in `ledger-mode.ts` stays observable); `WOOCOMMERCE_TARGET: z.enum(["devsite","production"]).default("devsite")`; fix `ORDER_PIPELINE_MODE` to `z.enum(["log","approve","live"])` (C-10). |
| `.env.example` | — | document every new variable from I.1 with `log` / `devsite` defaults and a one-line comment. |

Constraint: `src/server/woocommerce/*` and `src/inngest/woo-order.ts` must still import **nothing** under `integrations/qbo` (existing static guard).

### I.4 Woo saga terminal state (D-6, APPROVED in rev 2; executed in Phase 16)

`src/server/woocommerce/ledger-leg.ts`:
- Add `export const WOO_LEDGER_DEFERRED_STEP = "completed_ledger_deferred";`
- In the `mode !== "live"` branch: `store.setStatus(WOO_SAGA_TYPE, orderId, "COMPLETED", { currentStep: WOO_LEDGER_DEFERRED_STEP })` instead of `IN_PROGRESS`/`ledger_dry_run`. Return `marker: WOO_LEDGER_DEFERRED_STEP`.
- The `live` branch is **unchanged** (`IN_PROGRESS` / `awaiting_ledger_step_8`).
- Rewrite the file header comment so it states the new invariant: *"In log mode the order leg is terminal (COMPLETED, completed_ledger_deferred); the future QBO ledger saga discovers deferred orders by that marker. In live mode the saga is never COMPLETED while the ledger leg is unbuilt."*
- `WooLedgerLegResult.marker` union gains the new constant. `WOO_LEDGER_DRY_RUN_STEP` stays exported (old rows exist with it).
- The dry-run branch of `runWooOrderSaga` (ORDER_PIPELINE_MODE≠live, `woo-order.ts:300`) is **untouched**: it must stay `PENDING`/`dry_run_logged` so the replay utility (16.5) can find it.

### I.5 Operator pre-flight (not code; AG writes it into the handback as a checklist)

1. DevSite WooCommerce order sequence bumped above `WOO_DEVSITE_MIN_ORDER_ID` (recommend `9000000`); proof = screenshot/SQL of the next order id.
2. DevSite webhook (topics `order.created`, `order.updated`) points at a **non-production hub deployment** whose env has `WOOCOMMERCE_TARGET=devsite`.
3. DevSite REST keys generated on the DevSite (Read/Write), not copied from production.
4. On the hub deployment used for DevSite: `ORDER_PIPELINE_MODE=log`, `CATALOG_PUBLISH_MODE=log`, `KATANA_REVERSE_SYNC_MODE=log`, `QBO_LEDGER_MODE=log`, `CLOVER_LEDGER_MODE=log`, `WOO_LEDGER_MODE=log`.
5. Katana webhook subscriptions added in Katana settings for `sales_order.updated`, `sales_order.packed`, `sales_order.delivered`, `manufacturing_order.done` (same endpoint `/api/webhooks/katana`, same secret).
6. (rev 2, §VI R-10) `POSTGRES_URL` on the hub deployment is the Supavisor transaction pooler (port 6543) or a direct connection, not the session pooler (5432).
7. (rev 2, §VI R-16) Phase 14 leftovers committed or stashed; `base_ref` in `.cursor/phase.lock` updated to that commit; `git status --short` clean apart from the lock and session stamp.
8. (rev 2, §VI R-6/R-8) Before any lane flips to `live`: `QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID`, `QBO_GATEWAY_CLEARING_ACCOUNT_ID` and `LEDGER_COMPANY_TIMEZONE` set on the deployment.

### QA Audit Criteria — Section I

- **QA-I-01** `rg "WOOCOMMERCE_API_URL"` over `src/ scripts/ tests/ .env.example` returns **0** hits. ⚠ AMENDED BY §VI R-17: the banned-name regex is broadened.
- **QA-I-02** `rg "LEDGER_PIPELINE_MODE" src/` returns hits **only** in `src/server/pipeline/ledger-mode.ts` and `src/env.ts`.
- **QA-I-03** `tests/ledger-mode.test.ts` gains table-driven cases: (a) `WOO_LEDGER_MODE` unset + `LEDGER_PIPELINE_MODE=live` ⇒ `getLedgerMode("woo") === "log"` (pollution fixed); (b) `QBO_LEDGER_MODE` unset + legacy `live` ⇒ `qbo` is `live` (fallback); (c) `CLOVER_LEDGER_MODE=live` + `QBO_LEDGER_MODE=log` ⇒ `canPostToQbo("clover") === false` (master wins); (d) garbage values ⇒ `log`. All existing assertions in that file still pass **unmodified**.
- **QA-I-04** `assertWooWriteHostAllowed("https://www.ccpatio.com", {WOOCOMMERCE_TARGET:"devsite"})` throws; `"https://dev.ccpatio.com"` does not; `WWW.CCPATIO.COM` (upper case) throws.
- **QA-I-05** Woo route test: order id below floor ⇒ 200 `below_devsite_floor`, **no** `incoming_webhooks` insert, **no** `inngest.send`. Floor unset with target `devsite` ⇒ 503.
- **QA-I-06** No getter reads env at module scope (grep for top-level `const .* = process.env` in the new pipeline files ⇒ 0).
- **QA-I-07** (D-6 signed off in rev 2; graded at the Phase 16 gate) saga test: ORDER_PIPELINE_MODE=live + WOO_LEDGER_MODE=log ⇒ final `saga_runs.status = 'COMPLETED'`, `current_step = 'completed_ledger_deferred'`; WOO_LEDGER_MODE=live ⇒ `IN_PROGRESS`/`awaiting_ledger_step_8`.
- **QA-I-08** `GHL_STAGE_ID_*` ∩ (`GHL_FACTORY_STAGE_IDS` ∪ `GHL_WON_STAGE_IDS`) ≠ ∅ ⇒ `assertStageConfigDisjoint()` throws (unit test).

---

## II. Phase 15 — Katana Lifecycle & Sync Hardening (Reverse Flow)

Execution order is strict: 15.0 → 15.1 → 15.2 → 15.3 → 15.4 → 15.5. Each step ends green on `npx vitest run <its tests>` before the next starts.

### Step 15.0 — Capture real Katana fixtures (read-only, mandatory)

**Why:** Katana payload/field names below are the architect's best knowledge and are marked **VERIFY**. AG may not code against guessed field names.

**Action:** Using `katanaFetch` GET only (read-only, G-1), save **redacted** JSON (strip customer names, emails, addresses, prices may stay) to:

| Fixture | Source |
|---|---|
| `tests/fixtures/katana/purchase-order-partially-received.json` | `GET /purchase_orders/{id}` for a PO currently partially received |
| `tests/fixtures/katana/purchase-order-received.json` | `GET /purchase_orders/{id}` for a fully received PO |
| `tests/fixtures/katana/sales-order-ghl.json` | `GET /sales_orders/{id}` for an SO whose `order_no` starts `GHL-` |
| `tests/fixtures/katana/manufacturing-order-done.json` | `GET /manufacturing_orders/{id}` with status DONE linked to an SO |
| `tests/fixtures/katana/manufacturing-orders-by-so.json` | the MO list call used in 15.4 for that SO |
| `tests/fixtures/katana/webhook-*.json` | Any real webhook bodies obtainable from Katana's webhook log UI for the 4 new events |

**VERIFY list** (AG records the observed answer for each in the handback):
- V-1: PO row field holding received quantity (`received_quantity`? or row split with `received_date`?).
- V-2: PO row id field name (`id`).
- V-3: SO `status` values (expected `NOT_SHIPPED`, `PENDING`, `PACKED`, `DELIVERED`) and `production_status` values (expected `NONE`, `NOT_STARTED`, `NOT_APPLICABLE`, `IN_PROGRESS`, `BLOCKED`, `DONE`).
- V-4: MO `status` values (expected `NOT_STARTED`, `BLOCKED`, `IN_PROGRESS`, `DONE`) and the field linking an MO to its SO (expected `sales_order_id`, possibly only `sales_order_row_id`).
- V-5: The query parameter that lists MOs for one SO (expected `GET /manufacturing_orders?sales_order_id={id}`).
- V-6: Webhook envelope (expected `{ resource_type, action, webhook_id, object: { id, status?, href } }`).
- V-7: Katana's documented way to archive a variant/product (see 15.2c).

**QA-15.0-01** Fixture files exist, contain no email/phone/street strings (unit test greps them), and every parser test in 15.2–15.4 loads from these fixtures rather than hand-written literals.

---

### Step 15.1 — Supabase migration & schema mirror

#### 15.1a `incoming_webhooks.source` gains `'katana'` (TypeScript only — C-1)

| File | Change |
|---|---|
| `src/server/db/schema.ts:1149` | `text("source", { enum: ["woocommerce", "ghl", "cad_convert", "katana"] })` |
| `src/server/webhooks/incoming-log.ts:6` | `source: "woocommerce" \| "ghl" \| "cad_convert" \| "katana";` |

No SQL. Do not touch `quarantined_orders.source` (stays `woocommerce`/`ghl`).

#### 15.1b Hand-written migration `src/server/db/migrations/0057_katana_reverse_flow.sql`

⚠ AMENDED BY §VI R-3, R-4, R-6, R-8: the SQL below gains `katana_status_observed_at` on both hub tables, `receipt_date` / `qbo_vendor_id` on `katana_po_bills`, and the status value `requires_manual_intervention` replaces `failed`. The exact additive delta is in §VI.M.

Follow the exact mechanics of commit `be880c7` (Phase 14: hand-written SQL + `_journal.json` entry + snapshot). Journal entry: **idx `59`, tag `"0057_katana_reverse_flow"`**, `when` greater than idx 58's. Snapshot file: **`meta/0059_snapshot.json`** (snapshot numbers follow idx). `--> statement-breakpoint` between statements. Exact SQL:

```sql
-- 0057_katana_reverse_flow.sql
-- Phase 15 (Katana reverse flow). HAND-WRITTEN. ADDITIVE ONLY: CREATE TABLE / ADD COLUMN (nullable)
-- / CREATE INDEX / ENABLE ROW LEVEL SECURITY. No existing object is dropped or altered.
-- Never applied with `drizzle-kit push`.
--
-- katana_po_bills: one row per distinct Katana PO receipt state. The QBO requestid is derived
-- from (katana_po_id, receipt_fingerprint), so a retry reuses it and a new partial receipt gets a
-- new one. A ledger failure is retried, never rolled back; rows are never deleted.
-- RLS enabled with NO policies (deny-all for the Data API). App uses POSTGRES_URL (owner).

CREATE TABLE "katana_po_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"katana_po_id" integer NOT NULL,
	"order_no" text NOT NULL,
	"receipt_fingerprint" text NOT NULL,
	"receipt_seq" integer NOT NULL,
	"action" text NOT NULL,
	"lines" jsonb NOT NULL,
	"delta_total_cents" integer NOT NULL,
	"qbo_request_id" text NOT NULL,
	"qbo_bill_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "katana_po_bills_status_check" CHECK ("katana_po_bills"."status" in ('pending', 'posted', 'dry_run', 'no_delta', 'failed')),
	CONSTRAINT "katana_po_bills_action_check" CHECK ("katana_po_bills"."action" in ('purchase_order.received', 'purchase_order.partially_received')),
	CONSTRAINT "katana_po_bills_delta_nonnegative" CHECK ("katana_po_bills"."delta_total_cents" >= 0),
	CONSTRAINT "katana_po_bills_seq_positive" CHECK ("katana_po_bills"."receipt_seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "katana_po_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "katana_po_bills_po_fingerprint_uidx" ON "katana_po_bills" USING btree ("katana_po_id","receipt_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "katana_po_bills_po_seq_uidx" ON "katana_po_bills" USING btree ("katana_po_id","receipt_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "katana_po_bills_request_id_uidx" ON "katana_po_bills" USING btree ("qbo_request_id");--> statement-breakpoint
CREATE INDEX "katana_po_bills_status_created_idx" ON "katana_po_bills" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_so_status" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_production_status" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_mo_done_ids" jsonb;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "factory_stage" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "katana_status_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "ghl_stage_pushed" text;--> statement-breakpoint
ALTER TABLE "order_intake" ADD COLUMN "ghl_stage_pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_so_status" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_production_status" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_mo_done_ids" jsonb;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "factory_stage" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_status_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "ghl_stage_pushed" text;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "ghl_stage_pushed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  REVOKE ALL ON TABLE "katana_po_bills" FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
```

Rationale for **text columns, not enum values**: adding values to `order_intake_status` would be `ALTER TYPE ... ADD VALUE` (G-2) and would conflate the human-triage lifecycle (`received/approved/pushed/failed/rejected`) with factory progress. `order_intake.status` is **never** written by Phase 15.

`factory_stage` allowed values (enforced in TS, not SQL): `in_production`, `build_complete`, `ready_to_ship`, `delivered`.

#### 15.1c Drizzle mirror in `src/server/db/schema.ts`

- New `katana_po_bills` `pgTable(...)`, `.enableRLS()`, column names/types/indexes **identical** to the SQL, with `check(...)` entries whose SQL text matches the migration character-for-character (same pattern Phase 14 used; see the `0056` comment block at `schema.ts:~1835`).
- Export `KATANA_PO_BILL_STATUSES = ["pending","posted","dry_run","no_delta","failed"] as const` and the `KatanaPoBillLine` type: `{ rowId: number; sku: string; description: string; receivedQtyCumulative: number; billedQtyBefore: number; billedQtyDelta: number; pricePerUnitCents: number; amountCents: number }`.
- Add the 7 new nullable columns to `order_intake` and `custom_build_jobs` (`katana_mo_done_ids: jsonb(...).$type<number[] | null>()`; timestamps `withTimezone: true`).
- Export `FACTORY_STAGES = ["in_production","build_complete","ready_to_ship","delivered"] as const` and `type FactoryStage`.

#### QA Audit Criteria — 15.1

- **QA-15.1-01** Migration contains none of: `DROP`, `ALTER COLUMN`, `ALTER TYPE`, `RENAME`, `TRUNCATE`, `DELETE` (static test reads the file).
- **QA-15.1-02** `_journal.json` last entry is idx 59 / tag `0057_katana_reverse_flow`; `meta/0059_snapshot.json` exists; `npx drizzle-kit check` exits 0.
- **QA-15.1-03** Test asserts `schema.ts` CHECK SQL strings equal the migration's CHECK strings (copy the Phase 14 technique from `tests/phase14-customer-deposit.test.ts`).
- **QA-15.1-04** Migration applied via `npm run db:migrate` on the test DB only; `qa:phase2-db` passes. No evidence of `db:push` anywhere in the transcript.
- **QA-15.1-05** `incoming_webhooks` / `quarantined_orders` DDL untouched (git diff of migrations shows only the new file + meta).

---

### Step 15.2 — Idempotency & error-handling fixes

#### 15.2a Partial PO receipts → delta billing (fixes C-3, C-4)

**New pure module `src/server/katana/po-receipt-ledger.ts`** (no I/O except through injected deps):

```
export type PoReceiptRow = { rowId: number; sku: string; description: string;
  receivedQtyCumulative: number; pricePerUnitCents: number };

export function readPoReceiptRows(po: Record<string, unknown>): PoReceiptRow[]
  // Built to the 15.0 fixtures (V-1). Must support BOTH shapes if V-1 shows ambiguity:
  //  (a) row.received_quantity present  -> cumulative = that number
  //  (b) Katana split-row model         -> cumulative = row.quantity when row.received_date is set, else 0
  // Integer cents only: pricePerUnitCents = Math.round(Number(price_per_unit) * 100).
  // Rows with cumulative 0 are kept (they matter for the fingerprint).
  // Throws (never defaults) if a row has no numeric id.

export function receiptFingerprint(poId: number, rows: PoReceiptRow[]): string
  // sha256 hex of `${poId}|` + rows sorted by rowId, each `${rowId}:${receivedQtyCumulative}` joined by ","
  // Deterministic. No time, no randomness.

export type PriorBill = { lines: KatanaPoBillLine[]; status: KatanaPoBillStatus };

export function computeReceiptDelta(rows: PoReceiptRow[], prior: PriorBill[]):
  | { kind: "delta"; lines: KatanaPoBillLine[]; deltaTotalCents: number }
  | { kind: "no_delta" }
  | { kind: "negative"; rowIds: number[] }
  // ⚠ AMENDED BY §VI R-4: status set is {pending, posted, dry_run, requires_manual_intervention}; adds kind "superseded";
  //   amountCents uses cumulative rounding.
  // billedQtyBefore(rowId) = sum of billedQtyDelta over prior bills whose status ∈ {posted, dry_run} (D-7)
  // delta = receivedQtyCumulative - billedQtyBefore; negative anywhere -> kind "negative" (human case: vendor credit)
  // lines include only rows with delta > 0; amountCents = Math.round(delta * pricePerUnitCents)
```

**Rewire `src/inngest/katana-po-received.ts`:** ⚠ AMENDED BY §VI R-1, R-4, R-5, R-6, R-7: the QBO steps (`post-qbo-vendor-bill`, `mark-posted`, `mark-failed`) move OUT of this function into the new `post-katana-po-bill` function (`src/inngest/katana-po-bill-post.ts`). This function ends after `record-receipt` (+ `mark-dry-run` in log mode) and, in live mode, emits `katana/po_bill.post_requested`. `record-receipt` takes a transaction-scoped advisory lock on `getDb()` and never touches `getMutexDb()`.

1. Delete the local `readPurchaseOrderReceipt` + `PurchaseOrderReceiptRead` (moved to 15.3's module). Keep `KATANA_PO_RECEIVED_EVENT`.
2. Keep `idempotency: IDEMPOTENCY_BY_EVENT_ID` and `concurrency: [{ limit: 1, key: "event.data.purchaseOrderId" }, KATANA_TENANT_CONCURRENCY]` (the per-PO limit is what makes `receipt_seq` race-free).
3. Steps (exact ids):
   - `fetch-katana-po-details` (`runKatanaStep`): GET `/purchase_orders/{id}`; resolve supplier (15.2b); return `{ orderNo, supplierName, rows: readPoReceiptRows(po), fingerprint }`.
   - `record-receipt` (`step.run`): in one DB transaction: `SELECT ... FROM katana_po_bills WHERE katana_po_id = $1 ORDER BY receipt_seq`; if a row with this fingerprint exists ⇒ return it (`duplicate: true`). Else compute delta; `receipt_seq = max+1`; `qbo_request_id = qboRequestId(\`katana:po:${poId}:${fingerprint}\`, "ap-bill")`; insert with status `pending` (delta), `no_delta`, or throw `NonRetriableError("PO {orderNo} receipt decreased on rows [...]: needs a vendor credit by hand")` for `negative`. Insert uses `ON CONFLICT (katana_po_id, receipt_fingerprint) DO NOTHING` then re-reads.
   - If row status is `no_delta` or already `posted`/`dry_run` ⇒ return early `{ ok: true, skipped: <status> }`.
   - Mode gate `getLedgerMode("qbo")` (§I.3). `log` ⇒ `step.run("mark-dry-run")` sets status `dry_run`; return dry-run summary (include `receiptSeq`, `deltaTotalCents`, `lineCount`).
   - `post-qbo-vendor-bill` (`step.run`): call `createQboVendorBillFromKatanaPo({ ..., requestId: row.qbo_request_id, docNumber, lines: row.lines })`.
   - `mark-posted` (`step.run`): status `posted`, `qbo_bill_id`.
   - On a thrown QBO error: let it propagate (Inngest retries; same requestid ⇒ QBO dedupes). Do **not** mark `failed` on retryable errors. Only after a 400 from QBO: `step.run("mark-failed")` sets `failed` + scrubbed `last_error`, then throw `NonRetriableError` (DLQ alerts). Ledger failure is retried, never rolled back.
4. `docNumber` = `orderNo` when `receipt_seq === 1`, else `` `${orderNo}-R${receipt_seq}` ``; truncate the **orderNo part** so the total is ≤ 21 chars (QBO DocNumber limit) and the `-R{n}` suffix is never cut.

**Change `src/server/integrations/qbo/client.ts`** (`createQboVendorBillFromKatanaPo`):
- `CreateQboVendorBillInput` gains `requestId: string` and `docNumber: string` (both required). Remove the internal `qboRequestId(\`katana:po:${input.katanaPoId}\`, "ap-bill")` derivation. Validate `requestId.length <= QBO_REQUEST_ID_MAX_LENGTH` (throw otherwise).
- Lines are built from `KatanaPoBillLine` (`billedQtyDelta`, not cumulative). `Description` must show the delta quantity.
- Replace the `|| "81"` fallback for `QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID` with a thrown error when unset. ~~Exception: if the operator confirms 81 is the real account, keep it~~ **Executive decision D-10 (rev 2): there is NO exception and NO default. `.env.example` documents the variable with an empty value. The saga parks in `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION` and Ops is alerted (§VI R-6).** `rg '"81"' src/server/integrations/qbo/` ⇒ 0.
- `billId` fallback `"unknown"` ⇒ throw `Error("QBO Bill create returned no Id")` instead.

**Change `src/app/api/webhooks/katana/route.ts`** PO branch (⚠ see also §VI R-10: the route must make zero Katana calls on every branch): Inngest event `id` becomes `inngestEventId("katana:po", poId, \`${action}:${auditKey}\`)` where `auditKey` is the per-delivery audit key from 15.3. Effect: every delivery reaches the saga; de-duplication now lives in `katana_po_bills` (fingerprint), which is correct for a receipt that arrives twice with identical bodies.

#### 15.2b Supplier lookup must not swallow (`katana-po-received.ts:100-113`)

Replace the `try { ... } catch { /* fallback */ }` with:
- `supplier_id` missing / ≤ 0 ⇒ `throw new NonRetriableError(\`Katana PO ${orderNo} has no supplier_id; cannot attribute A/P bill\`)`.
- `GET /suppliers/{id}`: no try/catch. `KatanaApiError` with status 404 ⇒ convert to `NonRetriableError` (data problem). 429/5xx/network ⇒ propagate (`runKatanaStep` already turns 429 into `RetryAfterError`).
- Supplier with empty `name` ⇒ `NonRetriableError`.
- The literal `"Katana Vendor"` must no longer exist in the file.

#### 15.2c `archiveKatanaVariant` must not swallow (`src/inngest/functions.ts:295-325`)

- Remove the inner `try { await archiveApiCall(...) } catch (e) { console.error(...) }`.
- Replace `archiveKatanaVariant` from `@/lib/katana/client` (uses `fetchKatana`, bypasses the 1 req/s bucket, throws status-less strings) with a call through `katanaFetch` from `@/lib/katana` so failures are `KatanaApiError` with `.status` (G-7).
- **V-7 gate:** `src/lib/katana/client.ts:157` admits its PATCH `/variants/{id}` `{ is_active: false }` is a placeholder. AG must confirm the real Katana archive mechanism from the official API reference (developer.katanamrp.com). If no supported endpoint is confirmed, the function must `throw new NonRetriableError("Katana variant archive is not supported by the API; archive by hand in Katana")`. A guessed endpoint is a defect.
- No mapping / no `katana_variant_id` ⇒ return `{ ok: true, globalSku, skipped: "no_katana_variant" }` (explicit, visible in the run output).
- 404 from Katana ⇒ return `{ ok: true, skipped: "already_absent" }`; 4xx other than 404/408/409/429 ⇒ `NonRetriableError`; everything else propagates.
- Keep `concurrency: KATANA_TENANT_CONCURRENCY` (asserted by `woo-static-guards.test.ts:183`). Type the handler (`async ({ event, step })`), remove `: any`.

#### QA Audit Criteria — 15.2

- **QA-15.2-01** `receiptFingerprint` is pure: same input ⇒ same output across 1000 calls; row order independent; changes when any `receivedQtyCumulative` changes.
- **QA-15.2-02** Scenario test (fixtures + pglite or real test DB): partial receipt #1 (qty 4 of 10) ⇒ bill 4; redelivery of the same body ⇒ **no** second row, **no** second QBO call; partial #2 (cumulative 7) ⇒ bill **3** with DocNumber `-R2`; final `received` (cumulative 10) ⇒ bill **3** with `-R3`. Sum of billed = 10. QBO mock receives 3 POSTs with 3 distinct requestids.
- **QA-15.2-03** Retry test: QBO mock throws 503 once then succeeds ⇒ both attempts carry the **same** `requestid`; exactly one `posted` row.
- **QA-15.2-04** `rg "Date.now|new Date\(|randomUUID" src/server/katana/po-receipt-ledger.ts` ⇒ 0.
- **QA-15.2-05** `rg "catch\s*\{" src/inngest/katana-po-received.ts src/inngest/functions.ts` ⇒ no hit inside the PO saga or the archive function; `rg "Katana Vendor"` ⇒ 0.
- **QA-15.2-06** Log-mode receipt ⇒ row status `dry_run`, zero QBO fetches (spy on `globalThis.fetch`); later live receipt on the same PO bills **only** the new delta (D-7).
- **QA-15.2-07** Negative delta ⇒ `NonRetriableError`, no QBO call, no row with negative cents.
- **QA-15.2-08** Archive: Katana 500 ⇒ the step throws (retry); Katana 400 ⇒ `NonRetriableError`; missing mapping ⇒ `skipped: "no_katana_variant"`. No `console.error` without rethrow in the function body.

---

### Step 15.3 — Webhook parsers & route wiring

**New pure module `src/server/katana/webhook-events.ts`.** Move here (single source of truth): the `asRecord` / `text` / `positiveInt` helpers' use for events, `readPurchaseOrderReceipt` + `PurchaseOrderReceiptRead` (deleted from **both** `variant-webhook.ts` and `katana-po-received.ts`, C-8). Add:

```
export type SalesOrderStatusRead =
  | { kind: "ignore" }
  | { kind: "invalid"; message: string }
  | { kind: "sales_order_status";
      action: "sales_order.updated" | "sales_order.packed" | "sales_order.delivered";
      salesOrderId: number;
      statusHint: string | null };          // object.status if present, upper-cased; advisory only

export function readSalesOrderStatus(payload: unknown): SalesOrderStatusRead

export type ManufacturingOrderDoneRead =
  | { kind: "ignore" }
  | { kind: "invalid"; message: string }
  | { kind: "manufacturing_order_done"; manufacturingOrderId: number };

export function readManufacturingOrderDone(payload: unknown): ManufacturingOrderDoneRead
```

Parser rules (match existing style in `variant-webhook.ts`):
- `action = (text(root.action) || text(root.event)).toLowerCase()`.
- Also accept the `resource_type` + bare-action form (`resource_type: "sales_order", action: "updated"`) exactly like `isSalesOrderDeleted` does.
- Id from `object.id` → `data.id` → nested `object.sales_order.id` / `object.manufacturing_order.id`. Missing id ⇒ `invalid` (route answers 400).
- `sales_order.deleted` is **not** handled here; `readHoldDeletion` keeps owning it and runs first.
- `statusHint` is never trusted for decisions (Katana sends minimal bodies; V-6). The saga always re-reads Katana.

**New Inngest event names** (export from `src/inngest/katana-order-status.ts`):
- `KATANA_SO_STATUS_EVENT = "katana/sales_order.status_changed"` — data `{ salesOrderId: number; action: string; source: "webhook" | "mo_done" }`.
- `KATANA_MO_DONE_EVENT = "katana/manufacturing_order.done"` — data `{ manufacturingOrderId: number }`.

**Route changes `src/app/api/webhooks/katana/route.ts`** (order of evaluation after signature + JSON parse; ⚠ AMENDED BY §VI R-10: the `variant.updated` branch stops calling Katana inline and enqueues `heal-katana-variant-sku` instead; route budget is ≤ 2 DB statements + 1 `inngest.send` per delivery):
1. **Audit row (new, first):** `insertIncomingWebhookOnce({ source: "katana", eventName: <action or "unknown">, idempotencyKey: auditKey, payload, status: "received" })` where `auditKey = \`katana:${action || "unknown"}:${objectId ?? "noid"}:${randomUUID()}\``. This is an **append-only delivery log**: Katana bodies are not unique per event (two partial receipts can have identical bodies), so the audit key is deliberately per-delivery and the sagas own de-duplication. Audit insert failure ⇒ `500 { error: "persistence_failed", ref }` (Katana retries 5xx). Never store the signature header.
2. `readHoldDeletion` (existing, unchanged).
3. `readVariantUpdate` (existing).
4. `readPurchaseOrderReceipt` (now imported from `webhook-events.ts`) → send per 15.2a.
5. **New:** `readSalesOrderStatus` → `invalid` ⇒ 400; `sales_order_status` ⇒ `inngest.send({ id: inngestEventId("katana:so", id, \`${action}:${auditKey}\`), name: KATANA_SO_STATUS_EVENT, data: { salesOrderId, action, source: "webhook" } })` ⇒ `200 { ok: true, queued: true }`.
6. **New:** `readManufacturingOrderDone` → same pattern with `KATANA_MO_DONE_EVENT`.
7. Fallthrough ⇒ existing `200 { ok: true, ignored: true }`.
8. After each terminal branch, `updateIncomingWebhookStatus(auditKey, "processed" | "failed", message)`. `inngest.send` failure ⇒ mark audit `failed` and return 500.
- `revalidatePath` calls: reverse-flow branches call **none** (no hub page renders these columns yet). Existing PO/hold/variant `revalidatePath` calls stay.
- Update the route's header comment to list the new events and the audit log.
- Keep `runtime = "nodejs"`, `dynamic = "force-dynamic"`, single `req.text()`.

#### QA Audit Criteria — 15.3

- **QA-15.3-01** `rg "export function readPurchaseOrderReceipt"` ⇒ exactly **1** hit (`src/server/katana/webhook-events.ts`).
- **QA-15.3-02** Parser tests from the 15.0 webhook fixtures + synthetic variants: dotted action, `event` key, `resource_type` form, missing id ⇒ invalid, unrelated action ⇒ ignore, `sales_order.deleted` ⇒ ignore (owned by hold-deletion).
- **QA-15.3-03** Route test (mock `inngest.send`, mock DB): every signed delivery creates exactly one `incoming_webhooks` row with `source = 'katana'`; bad signature ⇒ 401 and **no** row; SO/MO events enqueue with names `katana/sales_order.status_changed` / `katana/manufacturing_order.done`.
- **QA-15.3-04** Two identical PO-receipt bodies delivered twice ⇒ two audit rows, two Inngest sends with **different** ids, and (per QA-15.2-02) still exactly one bill.
- **QA-15.3-05** Audit insert throws ⇒ route returns 500 with a `ref`, never driver text.

---

### Step 15.4 — Order Status Saga `src/inngest/katana-order-status.ts`

#### 15.4a Pure domain module `src/server/katana/order-status.ts`

```
export type KatanaSoSnapshot = { id: number; orderNo: string; status: string | null; productionStatus: string | null };
export type KatanaMoSnapshot = { id: number; status: string | null; salesOrderId: number | null };

export function readSalesOrderSnapshot(raw: unknown): KatanaSoSnapshot        // to fixture V-3; throws on missing id/order_no
export function readManufacturingOrderSnapshot(raw: unknown): KatanaMoSnapshot // to fixture V-4

export type HubLane = "ghl_factory" | "path_a" | "woo" | "unknown";
export function laneForOrderNo(orderNo: string): HubLane
  // "GHL-" -> ghl_factory (order_intake); "PA-" -> path_a (custom_build_jobs); "WOO-" -> woo; else unknown.
  // Prefixes come from KATANA_ORDER_NO_PREFIX in src/server/sre/idempotency.ts — import, do not re-type the literals.

export function deriveFactoryStage(so: KatanaSoSnapshot, mos: KatanaMoSnapshot[]): FactoryStage | null
  // ⚠ AMENDED BY §VI R-12: signature gains `expectedMoIds: number[]`; the MO-derived build_complete path requires
  //   every expected MO id to be present in `mos` and DONE.
  // Precedence (first match wins):
  //  1. so.status === "DELIVERED"                                   -> "delivered"
  //  2. so.status === "PACKED"                                      -> "ready_to_ship"
  //  3. so.productionStatus === "DONE" || (mos.length > 0 && every mo.status === "DONE") -> "build_complete"
  //  4. so.productionStatus ∈ {"IN_PROGRESS","BLOCKED"} || some mo.status ∈ {"IN_PROGRESS","BLOCKED","DONE"} -> "in_production"
  //  5. otherwise null (no stage change)
  // Literal status strings must match fixtures (V-3/V-4); keep them in exported const arrays.

export const FACTORY_STAGE_RANK: Record<FactoryStage, number> =
  { in_production: 1, build_complete: 2, ready_to_ship: 3, delivered: 4 };
```

#### 15.4b GHL stage writer `src/server/ghl/opportunity-stage.ts` (new)

⚠ AMENDED BY §VI R-11: closed-set rules (ReadonlySet membership, pipeline closed-universe validation, opportunity `status` and `locationId` checks, stage-name echo guard, post-write verification, multi-lane aggregation) are mandatory additions to this module.

- `stageIdFor(stage: FactoryStage, env = process.env): string | null` from the `GHL_STAGE_ID_*` vars.
- `assertStageConfigDisjoint(env = process.env): void` (§I.1 echo-loop rule).
- `moveOpportunityStage(input: { opportunityId; targetStage: FactoryStage }, deps = { getGhl: ghlGet, putGhl: ghlPut }): Promise<{ moved: true; fromStageId: string | null } | { moved: false; reason: "stage_unconfigured" | "wrong_pipeline" | "already_at_or_past" | "foreign_stage" }>`
  1. `GET /opportunities/{id}` via `ghlGet`. `!ok` ⇒ **throw** `Error(res.error)` (GhlResult is a value, not an exception; dropping it would be a swallow, G-4).
  2. `pipelineId !== GHL_FACTORY_PIPELINE_ID` ⇒ `wrong_pipeline`.
  3. Current `pipelineStageId` maps to a known factory stage with rank ≥ target rank ⇒ `already_at_or_past` (D-8 monotonic). Current stage is not one of ours **and** not in `GHL_FACTORY_STAGE_IDS`/`GHL_WON_STAGE_IDS` (e.g. Lost, On Hold) ⇒ `foreign_stage` (never override a human decision).
  4. `PUT /opportunities/{id}` body exactly `{ pipelineId, pipelineStageId }` via `ghlPut`. `!ok` ⇒ throw. (GHL 401/403 surfaces as `"GoHighLevel returned 401."`; the saga converts messages matching `/returned 40[13]\b/` into `NonRetriableError`.)
- Zero Katana imports in this file (same rule as `opportunity-writeback.ts`).

#### 15.4c Inngest functions (both in `src/inngest/katana-order-status.ts`)

⚠ AMENDED BY §VI R-1, R-2, R-3, R-9, R-10, R-12: `katanaMoDone` becomes hub-first with **zero** Katana calls and drops `KATANA_TENANT_CONCURRENCY`; `syncKatanaOrderStatus` ends after `persist-hub-status` and emits `ghl/factory_stage.push_requested` (steps 5–9 move to `push-ghl-factory-stage` in `src/inngest/ghl-factory-stage-push.ts`); the hub lookup is by opportunity id derived from `order_no`; persistence is a conditional (compare-and-set) UPDATE; the MO listing reuses the throwing paginator; a reconciliation cron is added. Read §VI before implementing this step.

**Function 1 — `katanaMoDone`**
- `id: "katana-mo-done"`, `name: "Katana MO Done -> resolve sales order"`, `triggers: [{ event: KATANA_MO_DONE_EVENT }]`, `concurrency: KATANA_TENANT_CONCURRENCY`, `retries: 3`, `idempotency: IDEMPOTENCY_BY_EVENT_ID`. No `onFailure`.
- Steps: `fetch-katana-mo` (`runKatanaStep`, GET `/manufacturing_orders/{id}` → `readManufacturingOrderSnapshot`). `salesOrderId == null` ⇒ return `{ ok: true, skipped: "mo_not_linked_to_so" }` (make-to-stock MOs are normal). Else `step.sendEvent("emit-so-status", { name: KATANA_SO_STATUS_EVENT, data: { salesOrderId, action: "manufacturing_order.done", source: "mo_done" } })`.
- If V-4 shows the MO only carries `sales_order_row_id`, AG resolves the SO via the documented Katana endpoint found in 15.0 and records it in the handback; guessing is a defect.

**Function 2 — `syncKatanaOrderStatus`**
- `id: "sync-katana-order-status"`, `name: "Katana order status -> Hub -> GHL stage"`, `triggers: [{ event: KATANA_SO_STATUS_EVENT }]`.
- `concurrency: [{ limit: 1, key: "event.data.salesOrderId" }, KATANA_TENANT_CONCURRENCY]` (Inngest allows 2 entries; same shape as `publishApprovedProduct`).
- `debounce: { key: "event.data.salesOrderId", period: "20s", timeout: "2m" }` (verified present in `node_modules/inngest/types.d.ts:1665`). Bursts of SO+MO events collapse to one run that reads the latest Katana state. **Do not** add `idempotency` (it would drop legitimate later status changes).
- `retries: 3`. No `onFailure` (G-6).
- Steps (exact ids, in order):
  1. `fetch-katana-sales-order` — `runKatanaStep`: GET `/sales_orders/{salesOrderId}` → `readSalesOrderSnapshot`.
  2. `fetch-katana-mos` — `runKatanaStep`: list MOs for the SO (V-5), paginate with `limit=250` until a short page; cap 20 pages; map with `readManufacturingOrderSnapshot`.
  3. Pure (inside step 4): `lane = laneForOrderNo(so.orderNo)`. `woo` or `unknown` ⇒ return `{ ok: true, skipped: "lane_<lane>" }` **before** any DB write (staff-created Katana SOs are common and normal).
  4. `persist-hub-status` — `step.run`. Lookup:
     - `ghl_factory`: `order_intake` WHERE `katana_sales_order_id = so.id` OR `katana_order_no = so.orderNo`, LIMIT 2. 0 rows ⇒ `skipped: "hub_record_missing"` (log, no throw: SO may predate the hub). 2 rows ⇒ `NonRetriableError("ambiguous order_intake for {orderNo}")`.
     - `path_a`: `custom_build_jobs` WHERE `katana_sales_order_id = so.id` OR `katana_order_no = so.orderNo` (same rules).
     - Compute `stage = deriveFactoryStage(so, mos)`, `doneIds = mos.filter(DONE).map(id).sort()`.
     - UPDATE **only** `katana_so_status`, `katana_production_status`, `katana_mo_done_ids`, `factory_stage`, `katana_status_synced_at`, `updated_at`. **Never** write `order_intake.status`, `order_intake.version` (the triage OCC token), `mapped_lines`, `hold_relief`, `katana_mo_ids`. **Never** lower `factory_stage` rank (if stored rank > derived rank, keep stored; log `katana-status-regression` with both values).
     - Return `{ table, rowId, opportunityId, stage, previousStage, ghlStagePushed }`.
  5. Gate: `getKatanaReverseSyncMode()` from `src/server/pipeline/katana-reverse-mode.ts` (new, same shape as `ghl-factory-mode.ts`). `log` ⇒ `console.log(JSON.stringify({ tag: "katana-reverse-sync-dry-run", orderNo, lane, stage, opportunityIdPresent: Boolean(opportunityId) }))` (no PII) and return `{ ok: true, dryRun: true, stage }`.
  6. Skip conditions (return, no throw): `stage == null`; `opportunityId` empty; `ghlStagePushed` rank ≥ `stage` rank.
  7. `push-ghl-stage` — `step.run`: `assertStageConfigDisjoint()` then `moveOpportunityStage(...)`. 401/403 ⇒ `NonRetriableError`. Other throws propagate (retry).
  8. `persist-ghl-stage` — `step.run`: if `moved` ⇒ set `ghl_stage_pushed = stage`, `ghl_stage_pushed_at = now()`. If `already_at_or_past` ⇒ also set `ghl_stage_pushed = stage` (records that GHL is at least there). Other `moved:false` reasons ⇒ no write, structured log `katana-reverse-sync-ghl-skip` with the reason.
  9. `path_a` only, after step 8: `step.sendEvent("refresh-path-a-summary", { name: PATH_A_GHL_SYNC_REQUESTED_EVENT, data: { opportunityId } })` (event constant from `src/server/path-a/events.ts:15`; reuses the existing `path-a-ghl-sync` function and its own `PATH_A_GHL_SYNC_MODE` gate — do not call `syncOpportunitySummaryToGhl` directly). AG must confirm the exact `data` shape `pathAGhlSync` expects by reading `src/inngest/path-a-ghl-sync.ts` before wiring.

**Registration:** add `katanaMoDone` and `syncKatanaOrderStatus` to `inngestFunctions` in `src/inngest/functions.ts`; re-export from there like `syncKatanaPoReceived`.

**Static-guard additions in `tests/woo-static-guards.test.ts`** (Katana tenant block, `it.each` at line ~180): add `["katanaMoDone", katanaMoDone]`, `["syncKatanaOrderStatus", syncKatanaOrderStatus]`, `["syncKatanaPoReceived", syncKatanaPoReceived]`.

#### QA Audit Criteria — 15.4

- **QA-15.4-01** `deriveFactoryStage` truth table test covers all 5 precedence rows, empty MO list, mixed MO statuses, unknown status strings ⇒ `null`.
- **QA-15.4-02** Saga test (fake step, fake Katana, fake GHL, real or pglite DB): GHL lane SO `IN_PROGRESS` ⇒ `order_intake.factory_stage = 'in_production'`, `status` and `version` **unchanged** (assert before/after equality).
- **QA-15.4-03** `KATANA_REVERSE_SYNC_MODE` unset ⇒ hub columns updated **and** zero GHL PUTs (D-5).
- **QA-15.4-04** Live mode: target `build_complete`, GHL currently at `in_production` stage id ⇒ exactly one PUT with body `{ pipelineId, pipelineStageId: GHL_STAGE_ID_BUILD_COMPLETE }`. GHL already at `delivered` ⇒ zero PUTs, `already_at_or_past`. GHL in a foreign stage (Lost) ⇒ zero PUTs.
- **QA-15.4-05** Re-running the same event twice ⇒ second run makes zero GHL PUTs (idempotent by `ghl_stage_pushed`).
- **QA-15.4-06** `WOO-` and unknown-prefix SOs ⇒ zero DB writes, zero GHL calls.
- **QA-15.4-07** `ghlPut` returning `{ ok: false }` ⇒ the step **throws** (no swallow); `"GoHighLevel returned 401."` ⇒ `NonRetriableError`.
- **QA-15.4-08** `rg "@/lib/katana" src/server/ghl/opportunity-stage.ts` ⇒ 0. `rg "fetchKatana" src/inngest/katana-order-status.ts` ⇒ 0. No Katana POST/PUT/PATCH/DELETE anywhere in the Phase 15 diff except the archive path (grep `method: "(POST|PUT|PATCH|DELETE)"` in new files).
- **QA-15.4-09** Inngest registration test: no duplicate ids; both new functions carry `KATANA_TENANT_CONCURRENCY`; neither defines `onFailure`.

### Step 15.5 — Phase 15 gate

1. Append the new test files to the explicit list in `package.json` → `qa:phase0-unit` (that script enumerates files; a test not listed there **does not run in `qa:lifecycle`**). Add `tests/ledger-mode.test.ts`, `tests/woo-static-guards.test.ts`, `tests/phase15-katana-reverse-flow.test.ts`, `tests/phase15-po-receipt-ledger.test.ts` if absent.
2. Extend `scripts/qa/simulate-webhooks.ts` with signed Katana deliveries for `sales_order.updated` and `manufacturing_order.done` (assert 200 + `queued: true`) and two identical `purchase_order.partially_received` bodies (assert two 200s).
3. Run `npm run qa:lifecycle`; paste raw output. Run `node .cursor/skills/qca/scripts/qca.mjs` and transcribe its JSON verbatim. Exit code 2 (`DEFECT_REJECTED`) is never reported as certified.

---

## III. Phase 16 — WooCommerce Path B (MTO Guardrails & Hardening)

Prerequisite: Phase 15 certified and §I.3 ledger split merged (Phase 16 relies on `getLedgerMode("woo")`).

### Step 16.1 — Catalog safety

#### 16.1a Mapper `src/mappers/woocommerce.ts`

- `WooMapperResult` skip union becomes `{ skip: true; reason: "sync_to_woo_false" | "msrp_missing_or_zero" }`.
- Price rule: `const price = parseMoney(commerce.msrp ?? null)`. If `price == null || !Number.isFinite(price) || price <= 0` ⇒ return `{ skip: true, reason: "msrp_missing_or_zero" }`. **Delete** the raw-string fallback `(commerce.msrp?.trim() || "0.00")` entirely (it also let garbage strings like `"TBD"` through as a price).
- `regular_price = price.toFixed(2)`.
- `WooProductPayload` changes: `status?: "draft"` (only value the mapper can emit); `manage_stock?: boolean`; new `stock_status?: "instock"`. The mapper always emits `status: "draft"`; the REST layer strips it on update (16.1c).
- Remove `"publish"` from the `status` type. `rg '"publish"' src/mappers/woocommerce.ts src/lib/woocommerce-catalog.ts` ⇒ 0.

#### 16.1b Mode gate `src/server/pipeline/woo-catalog-mode.ts` (new) + `publishToWooCommerce`

- `getWooCatalogPublishMode(): "log" | "live"` (fail closed) and `canMutateWooCatalog()`.
- `src/server/mdm/publish-channels.ts` → `publishToWooCommerce(graph, opts: { onMissingPrice: "throw" | "record" } = { onMissingPrice: "throw" })`:
  1. Map; compute `payloadHash` (existing).
  2. `mapped.skip && reason === "sync_to_woo_false"` ⇒ existing behavior (success/"skipped").
  3. `mapped.skip && reason === "msrp_missing_or_zero"` ⇒ `upsertChannelSync({ status: "failed", lastError: "msrp_missing_or_zero", payloadHash })`; then `onMissingPrice === "throw"` ⇒ `throw new NonRetriableError(\`WooCommerce publish blocked for ${globalSku}: MSRP missing or $0.00\`)`; `"record"` ⇒ return `{ skipped: true, externalId: null, reason: "msrp_missing_or_zero" }`.
  4. `!canMutateWooCatalog()` ⇒ **no HTTP**; `upsertChannelSync({ status: "pending", lastError: null, payloadHash })`; `console.log(JSON.stringify({ tag: "woo-catalog-dry-run", globalSku, payloadHash: payloadHash.slice(0,16) }))`; return `{ skipped: true, externalId: existing?.external_id ?? null, dryRun: true }`.
  5. Live ⇒ existing upsert path.
- `publishApprovedProduct` (`functions.ts:389`) keeps calling `publishToWooCommerce(graph)` (default `"throw"`).
- Return type widens to `{ skipped: boolean; externalId: string | null; dryRun?: boolean; reason?: string }`. Update any caller types.

#### 16.1c REST layer `src/lib/woocommerce-catalog.ts`

- `wooFetch`: add `signal: AbortSignal.timeout(WOO_FETCH_TIMEOUT_MS)` with `export const WOO_FETCH_TIMEOUT_MS = 15_000` (matches the GHL client). Catch **only** to translate `error.name === "TimeoutError" || "AbortError"` into `throw new WooCommerceApiError(\`WooCommerce request timed out after ${WOO_FETCH_TIMEOUT_MS}ms\`, 0)`; any other error is rethrown unchanged. Message never contains the URL query or credentials.
- `wooFetch` calls `assertWooWriteHostAllowed(baseUrl)` for non-GET methods (§I.2).
- `upsertWooCommerceProduct(payload)`:
  - Existing product found by SKU ⇒ PUT body = payload **minus `status`** (C-6). Also minus `manage_stock`/`stock_status` when the payload did not set them (third-party items, 16.2).
  - Not found ⇒ POST with `status: "draft"` (assert the payload's status is `"draft"`; anything else ⇒ throw).
  - The SKU lookup must include drafts: query `/products?sku=<sku>&status=any&per_page=1` so a second backfill does not create a duplicate draft.
  - `id` missing on create ⇒ existing throw (keep).

#### QA Audit Criteria — 16.1

- **QA-16.1-01** Mapper table test: msrp `null`, `""`, `"0"`, `"0.00"`, `"$0"`, `"-5"`, `"TBD"` ⇒ `msrp_missing_or_zero`; `"1,299.00"` ⇒ `"1299.00"`.
- **QA-16.1-02** `publishToWooCommerce` with `WOO_CATALOG_PUBLISH_MODE` unset ⇒ `fetch` spy called **0** times; `channel_sync.status = 'pending'`.
- **QA-16.1-03** Live + new SKU ⇒ exactly one POST whose body has `status: "draft"`. Live + existing SKU ⇒ one PUT whose body has **no** `status` key.
- **QA-16.1-04** Hanging fetch (never resolves) ⇒ rejects with `WooCommerceApiError` status 0 within the timeout (fake timers).
- **QA-16.1-05** Live + `WOOCOMMERCE_URL=https://www.ccpatio.com` + target `devsite` ⇒ throws before any `fetch`.
- **QA-16.1-06** `product.approved` with $0 MSRP ⇒ `NonRetriableError`, `channel_sync` row `failed`/`msrp_missing_or_zero`; Katana and Clover legs unaffected.

### Step 16.2 — Inventory strategy (Option A, D-1)

- **MTO definition (single source of truth):** `isKatanaMtoItem({ productOrigin, itemType }) === (productOrigin === "manufactured" && itemType === "finished_good")`. Export from `src/mappers/woocommerce.ts`. Columns: `sku_mappings.product_origin` (`productOriginEnum`: `manufactured` | `third_party`, nullable) and `sku_mappings.item_type` (`itemTypeEnum`).
- `src/mappers/types.ts` → `HubFinishedGoodCommerce` gains `productOrigin: "manufactured" | "third_party" | null` and `itemType: "raw_material" | "sub_assembly" | "finished_good" | "service"`.
- `src/server/mdm/load-hub-product-graph.ts:100` → populate both from `root.product_origin` / `root.item_type`.
- Mapper: MTO ⇒ `manage_stock: false`, `stock_status: "instock"` (always purchasable; Katana MTO owns production). Not MTO (incl. `product_origin` null) ⇒ **omit** `manage_stock` and `stock_status` (do not alter existing Woo inventory settings for third-party goods). Note: today the mapper sends `manage_stock: false` for everything; that blanket behavior is removed.
- No Woo order-side stock logic is added. The Woo saga and route are unchanged by 16.2.
- Phase 17 hook (do not build): leave a single exported constant `WOO_MTO_STOCK_STATUS = "instock" as const` so Phase 17 has one place to change.

#### QA Audit Criteria — 16.2

- **QA-16.2-01** Mapper test: (`manufactured`,`finished_good`) ⇒ `manage_stock === false && stock_status === "instock"`; (`third_party`,`finished_good`) and (`null`,`finished_good`) ⇒ payload has **no** `manage_stock` and **no** `stock_status` key.
- **QA-16.2-02** Property-style test over all origin × item_type combinations: `manage_stock` is never `true` in any payload.
- **QA-16.2-03** `rg "manage_stock: true"` over `src/` ⇒ 0.

### Step 16.3 — Woo-only backfill `src/inngest/woo-catalog-backfill.ts`

**Events (exported from that file):**
- `WOO_CATALOG_BACKFILL_EVENT = "woo/catalog.backfill.requested"` — data `{ backfillId: string; requestedBy: string; skus?: string[]; limit?: number }`.
- `WOO_CATALOG_PUBLISH_EVENT = "woo/catalog.publish.requested"` — data `{ globalSku: string; backfillId: string }`.

**Function A — `wooCatalogBackfill`**: `id: "woo-catalog-backfill"`, `triggers: [{ event: WOO_CATALOG_BACKFILL_EVENT }]`, `concurrency: { limit: 1 }`, `idempotency: "event.data.backfillId"`, `retries: 1`.
- `select-candidates` (`step.run`): `sku_mappings` WHERE `sync_to_woo = true AND is_active = true AND item_type = 'finished_good'`, optional `global_sku IN (skus)`, ORDER BY `global_sku`, LIMIT `min(limit ?? 5000, 5000)`. Return SKUs only.
- Fan-out in chunks of 100: `step.sendEvent(\`fan-out-${chunkIndex}\`, events)` with each event `id = inngestEventId("woo:catalog", sku, backfillId)`.
- Return `{ backfillId, candidateCount, chunks }`.

**Function B — `wooCatalogPublishSku`**: `id: "woo-catalog-publish-sku"`, `triggers: [{ event: WOO_CATALOG_PUBLISH_EVENT }]`, `concurrency: [{ limit: 1, key: "event.data.globalSku" }, { limit: 3 }]`, `throttle: { limit: 2, period: "1s" }` (protects the DevSite host), `retries: 3`, `idempotency: IDEMPOTENCY_BY_EVENT_ID`.
- `load-hub-state` (`step.run`): `loadHubProductGraph(globalSku)`.
- `publish-woocommerce` (`step.run`): `publishToWooCommerce(graph, { onMissingPrice: "record" })`.
- Returns the publish result. **No** Katana, **no** Clover, **no** `stageKatanaCatalogGraph`, **no** `KATANA_TENANT_CONCURRENCY` (it makes no Katana calls).

Register both in `inngestFunctions`.

**Ops trigger `scripts/ops/trigger-woo-catalog-backfill.ts`** (pattern: `scripts/qa/auto-verify-live-fire.ts` imports `inngest` from `../../src/inngest/client`):
- Flags: `--confirm`, `--skus=A,B,C`, `--limit=N`.
- Always prints: `WOOCOMMERCE_URL` **host only**, `WOOCOMMERCE_TARGET`, `WOO_CATALOG_PUBLISH_MODE`, candidate count (runs the same SELECT read-only), first 20 SKUs, count with missing/zero MSRP (pre-flight via the same mapper).
- Refuses (exit 1) if `WOOCOMMERCE_TARGET !== "devsite"` (Phase 16 is DevSite-only) or host ∈ production hosts.
- Without `--confirm`: exit 0 after printing. With `--confirm`: `inngest.send({ id: \`woo-backfill:${backfillId}\`, name: WOO_CATALOG_BACKFILL_EVENT, data: {...} })`, `backfillId = new Date().toISOString().replace(/[:.]/g,"-")` (time is fine here: it names an operator action, it is not an idempotency key for a financial write).
- `package.json`: `"ops:woo-catalog-backfill": "npx dotenv -e .env.local -- tsx scripts/ops/trigger-woo-catalog-backfill.ts"` and `"ops:woo-catalog-backfill:confirm": "... --confirm"`.

#### QA Audit Criteria — 16.3

- **QA-16.3-01** Static test: `src/inngest/woo-catalog-backfill.ts` (and its transitive local imports) does not import `@/lib/katana`, `@/lib/clover-catalog`, `publishToKatana`, `publishToClover`, or anything under `integrations/qbo`.
- **QA-16.3-02** Unit: with a fake step, 250 candidates ⇒ 3 `sendEvent` calls (100/100/50), event ids deterministic per (sku, backfillId).
- **QA-16.3-03** Missing-MSRP SKU in backfill ⇒ function B succeeds with `reason: "msrp_missing_or_zero"`, **no** throw, **no** DLQ row.
- **QA-16.3-04** Script without `--confirm` sends nothing (mock `inngest.send` ⇒ 0 calls); with `WOOCOMMERCE_TARGET=production` exits 1.
- **QA-16.3-05** Registration test: both ids present, unique.

### Step 16.4 — Order triage firewall (`tests/woo-static-guards.test.ts`)

Goal: the Woo lane (Path B) can never write to or read the GHL factory lane's `order_intake` table or its writers.

Add a new `describe("Woo modules cannot reach the GHL factory lane")` that iterates the existing `WOO_MODULES` array **plus** `src/inngest/woo-catalog-backfill.ts`, `src/server/woocommerce/devsite-guard.ts`, and `scripts/ops/replay-woo-dry-runs.ts`:

1. Direct check (comments stripped with the existing `stripComments`): source must not match `/\border_intake\b/`, `/orderIntake/`, `/@\/server\/ghl\//`, `/push-factory-order/`, `/ORDER_APPROVED_EVENT/`.
2. Transitive check: reuse the existing BFS (`importSpecifiers` + `resolveLocal`) and fail if any reached file path matches `/\/server\/ghl\//` or `/push-factory-order/`.
3. Transitive schema-usage check: for every reached file that imports `@/server/db/schema`, assert its named imports do not include `order_intake` (parse `import { ... } from "@/server/db/schema"`).
4. Keep every existing assertion in the file intact (G-9).

Known-safe note for AG: `src/server/db/schema.ts` itself will be reached transitively and *defines* `order_intake`; rule 3 checks **named imports**, not the schema file's contents. Exclude `schema.ts` from rule 1.

#### QA Audit Criteria — 16.4

- **QA-16.4-01** Mutation test (manual, recorded in handback): temporarily adding `import { order_intake } from "@/server/db/schema"` to `src/server/woocommerce/ingress.ts` makes the new test fail; reverting makes it pass.
- **QA-16.4-02** The BFS reports `seen.size > WOO_MODULES.length` (walk actually walked, existing pattern).
- **QA-16.4-03** No existing `it(...)` in the file was removed or loosened (diff review).

### Step 16.5 — Dry-run replay utility `scripts/ops/replay-woo-dry-runs.ts`

**Purpose:** paid Woo orders received while `ORDER_PIPELINE_MODE` was `log` sit at `saga_runs.status = 'PENDING'`, `current_step = 'dry_run_logged'` (`woo-order.ts:300`). This script re-enqueues them once the pipeline is live (or re-dry-runs them on the DevSite).

**Structure:** pure planner + thin I/O shell, so it is unit-testable.

- `export function planWooReplay(input: { sagas: SagaRunRow[]; audits: AuditRow[]; quarantines: QuarantineRow[]; floor: number | null; max: number }): { replay: ReplayItem[]; skipped: Array<{ orderId: string; reason: string }> }`
  - Candidates: `saga_type = WOO_SAGA_TYPE` (`"path_b_woo"`), `status = 'PENDING'`, `current_step = 'dry_run_logged'`.
  - Payload source: the **newest** `incoming_webhooks` row with `source = 'woocommerce'`, `payload->>'id' = correlation_key`, `status IN ('received','processed')`. Its `payload` is the parsed order the route stored (`route.ts:216`), its `idempotency_key` is the delivery key.
  - Skip reasons (exact strings): `no_audit_payload`, `payload_invalid` (`parseWooOrderWebhook` fails), `quarantine_open` (any `quarantined_orders` row with `source='woocommerce'`, `external_id = orderId`, `status IN ('pending_review','post_payment_edit')`), `below_devsite_floor`, `not_paid` (`classifyWooOrder(order) !== "paid"`), `over_max`.
  - Order: oldest `saga_runs.paid_at` first.
- I/O shell:
  - Flags: `--confirm`, `--max=N` (default 10, hard cap 200), `--order=<id>` (single order).
  - Reads only. **Never** updates/deletes `saga_runs`, `incoming_webhooks`, or `quarantined_orders` (the saga owns state; G-3).
  - Prints: target host, `ORDER_PIPELINE_MODE` as seen locally **with a warning that the deployed value is what matters**, the plan table, skip summary.
  - `--confirm`: for each item, `inngest.send({ id: inngestEventId("woo:order", order.id, \`replay-${replayBatchId}\`), name: WOO_ORDER_EVENT, data: { ...order, [WOO_DELIVERY_KEY_FIELD]: deliveryKey } })` — exact same data shape as `route.ts:344-346`. 1 s spacing between sends. A new event id is required because function-level `idempotency: "event.id"` would drop a re-send of `woo:order:<id>:paid` inside 24 h; duplicates are still blocked by saga layers 3 (`saga_runs` unique + `COMPLETED` short-circuit) and 4 (Katana `order_no` lookup + `isOwnWooSalesOrder`).
  - Writes a JSON report to `data_migration/reports/woo-dry-run-replay-<replayBatchId>.json` (plan, skips, sent ids, send errors). A send error is recorded **and** makes the script exit 1 at the end (no swallow).
- `package.json`: `"ops:replay-woo-dry-runs"` and `"ops:replay-woo-dry-runs:confirm"` (dotenv `.env.local`, same pattern as other `ops:*`).

#### QA Audit Criteria — 16.5

- **QA-16.5-01** `tests/woo-replay-dry-runs.test.ts`: every skip reason has a dedicated case; a valid candidate yields a `ReplayItem` whose `data` deep-equals what the route would send.
- **QA-16.5-02** Static test: the script contains no `.update(`, `.delete(`, `DELETE FROM`, `UPDATE ` against `saga_runs`/`incoming_webhooks`/`quarantined_orders`.
- **QA-16.5-03** Without `--confirm`: zero `inngest.send` calls.
- **QA-16.5-04** Replay event ids never equal `wooEventId(order)` (`woo:order:<id>:paid`) and are unique per batch.
- **QA-16.5-05** Saga test: replaying an order whose saga is already `COMPLETED` returns `duplicate: true` with zero Katana calls (existing behavior, re-asserted).

### Step 16.6 — Phase 16 gate

Same as 15.5: add new tests to `qa:phase0-unit`, run `npm run qa:lifecycle`, paste raw output, run `qca.mjs`, transcribe JSON. Handback must include the I.5 operator checklist with each item marked done/not done by the operator (AG cannot self-attest operator actions).

---

## IV. Master Roadmap Note — Phase 17 (acknowledged, OUT OF SCOPE)

**Phase 17: Dynamic Lead-Time Sync via BOM dependencies.** When a Katana raw material that appears in a finished good's BOM stocks out (or its expected arrival moves), the hub recomputes that finished good's lead time and pushes it to WooCommerce (product meta and/or `stock_status: "onbackorder"` with a lead-time message).

Known anchors for the future design (do not build):
- Hub BOM graph: `product_bom` (`parent_sku` → `child_sku`), loaded today by `loadHubProductGraph`.
- Hub lead time: `logistics_profiles.lead_time_days` (CHECK ≥ 0, `schema.ts:1254`).
- Woo seam: `WOO_MTO_STOCK_STATUS` constant from 16.2; `WOO_CATALOG_PUBLISH_MODE` gate from 16.1.
- Likely Katana triggers: material stock / PO expected-arrival events (to be confirmed with fixtures, like 15.0).

**AG instruction:** Do not create files, tables, events, env vars, or functions for Phase 17. Any Phase 17 artifact in a Phase 15/16 diff is a scope defect.

---

## V. Cursor QA inspection protocol (how AG's work will be graded)

1. **Lock compliance:** `git diff --name-only <base_ref>..HEAD` ⊆ active `allowed_files`. Any extra path ⇒ reject.
2. **Guardrail sweep:** G-1…G-10 checked by grep + diff review. Specific greps: `drizzle-kit push`, `catch {`, `catch (` followed by no `throw` within the block, `WOOCOMMERCE_API_URL`, `"publish"` in Woo mapper/catalog, `LEDGER_PIPELINE_MODE` outside `ledger-mode.ts`/`env.ts`, `fetchKatana` in new files, `onFailure` in new functions.
3. **Criteria table:** every `QA-*` id above is marked PASS/FAIL with evidence (test name, grep output, or file:line). One FAIL ⇒ phase not certified.
4. **Proof of life:** raw, unedited `npm run qa:lifecycle` stdout ending in exit code 0, plus verbatim `qca.mjs` JSON. Summaries or excerpts are not accepted.
5. **VERIFY answers:** V-1…V-7 answered with the fixture path that proves each.
6. **Open questions AG must surface (not decide):** ~~D-6 sign-off status~~ (approved rev 2); ~~`QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID` default `81`~~ (D-10: no default, rev 2); D-12 vendor mapping; any VERIFY item (V-1 … V-11) where Katana's, Inngest's, or GHL's real behavior contradicted this blueprint.
7. **Section VI criteria:** every `QA-R*` id in §VI is graded exactly like the `QA-15.*` ids. One FAIL ⇒ phase not certified.

---

## VI. NetSuite-Grade Edge-Case Sweep (rev 2, 2026-10-29) — BINDING

**Method.** Cursor re-read the code paths the Phase 15 plan touches (Katana route, PO saga, `katanaFetch` / `runKatanaStep` / token bucket, `getMutexDb`, QBO client and token mutex, GHL client, GHL webhook route, factory push, Path A release, DLQ, saga store, Mission Control probes) and the Inngest 4.18.1 option surface in `node_modules/inngest/types.d.ts`. Every finding below cites the code that proves it. Where a finding changes an earlier step, that step carries an inline `⚠ AMENDED BY §VI R-n` marker.

### VI.0 Direct answers to the four sweep questions

| Question | Answer | Findings |
|---|---|---|
| **1. Concurrency.** `sales_order.updated` and `manufacturing_order.done` arrive milliseconds apart. Do handlers overwrite each other? Do we need `getMutexDb()`? | The original plan already funnels both into one per-SO event with `debounce` and a per-SO concurrency key, so the *common* case collapses to one run that re-reads Katana. Three real races remain: (a) the webhook can beat the factory push's own write of `katana_sales_order_id`, so the hub lookup misses and the update is lost; (b) Inngest's per-key concurrency limits executing steps, not a run that is waiting on retry backoff, so an older run's memoized snapshot can overwrite a newer run's write; (c) the PO receipt ledger excludes `pending` rows from "already billed", so two close receipts double-bill. **`getMutexDb()` must NOT be used.** It is a dedicated `max: 1` connection reserved for the QBO token mutex; borrowing it would block QBO token refresh and can self-deadlock when a QBO call inside the same flow needs a token. Correctness moves into Postgres: compare-and-set UPDATEs on the regular pool, and a transaction-scoped advisory lock (`pg_advisory_xact_lock`) on `getDb()` for the receipt ledger. | R-2, R-3, R-4, R-5 |
| **2. Rate limits.** Does the reverse flow route through the AsyncLocalStorage deferral? | Only if every Katana call is lexically inside `runKatanaStep`. Outside it, `katanaFetch` defaults to the `sleep` policy: up to 3 retries × 65 s *inside one HTTP request*, which outlives a serverless invocation and causes duplicate step execution. The plan had three leaks: the Katana webhook route's inline variant lookup, an MO listing that could silently fall back to an "all SOs" query, and QBO/GHL 429s that were never converted into `RetryAfterError`. A runtime guard (`assertKatanaDeferContext`) plus hub-first MO resolution closes them. | R-9, R-1 |
| **3. Webhook storms.** 50 webhooks at once: timeout or fast ack? | The planned reverse-flow branches are fast (one audit insert, one `inngest.send`, one status update). The risk is the **existing** `variant.updated` branch, which calls Katana inline and can block up to 30 s on the shared bucket plus 195 s of 429 sleeps. Under a storm that causes Katana delivery timeouts, retries, and possibly Katana auto-disabling the subscription (V-10). Fix: the route makes zero Katana calls; a reconciliation cron backs up lost webhooks. | R-10 |
| **4. GHL stage logic.** Does the pushback use closed-Set checks? | Partially. The plan checked disjointness from `GHL_FACTORY_STAGE_IDS` / `GHL_WON_STAGE_IDS`, but `isProduceFactoryOrderStage` also matches by stage **name** (`factory-stage.ts:26`), which the ID check misses. It also never checked the opportunity's `status` (Lost/Abandoned), location, or whether the target IDs really belong to the factory pipeline. It also pushed per hub row, not per opportunity. All of these are now closed-set rules. | R-11 |

### VI.1 Findings and binding requirements

#### R-1 · Non-Katana I/O holds the global Katana slot (CRITICAL)

**Evidence.** `KATANA_TENANT_CONCURRENCY` is `{ scope: "env", key: '"katana-tenant"', limit: 1 }` (`src/server/sre/katana-throttle.ts:22-26`). It is a function-level option, so it gates every step of that function. Today `sync-katana-po-received` carries it (`src/inngest/katana-po-received.ts:79-82`) and then POSTs to QBO in `post-qbo-vendor-bill` (`:171-173`). One QBO call can take up to `QBO_API_TIMEOUT_MS` 20 s plus a token refresh of 10 s and a 15 s lock wait (`src/server/integrations/qbo/token-refresh.ts:30-33`). The original §15.4c put the GHL GET + PUT (15 s timeout each, `src/server/ghl/private-api.ts:59`) inside `syncKatanaOrderStatus`, which also carries the slot. While any of those runs, **every** revenue saga that touches Katana waits: `process-woocommerce-order`, `push-approved-factory-order`, and `path-a-release-to-production`.

**Requirement (D-11).**
1. Split the PO saga. `sync-katana-po-received` keeps only Katana reads and `record-receipt` (+ `mark-dry-run` in log mode). In live mode, when the recorded row is `pending`, it emits `step.sendEvent("request-qbo-bill", { id: \`katana-po-bill:${billRowId}\`, name: "katana/po_bill.post_requested", data: { billRowId, katanaPoId } })`.
2. New function **`post-katana-po-bill`** in `src/inngest/katana-po-bill-post.ts`: trigger `katana/po_bill.post_requested`; `concurrency: [{ limit: 1, key: "event.data.katanaPoId" }, { limit: 2, key: '"qbo-realm"', scope: "env" }]` (QBO allows at most 10 concurrent requests per realm and other lanes share it); `idempotency: "event.data.billRowId"`; `retries: 5`; no `onFailure`; **no Katana import**. Steps are in R-6 and R-7.
3. Split the status saga. `sync-katana-order-status` ends after `persist-hub-status` and emits `step.sendEvent("request-ghl-stage", { name: "ghl/factory_stage.push_requested", data: { opportunityId } })` when the persisted stage rank exceeds the stored `ghl_stage_pushed` rank.
4. New function **`push-ghl-factory-stage`** in `src/inngest/ghl-factory-stage-push.ts`: trigger `ghl/factory_stage.push_requested`; `concurrency: [{ limit: 1, key: "event.data.opportunityId" }]`; `throttle: { limit: 20, period: "10s" }` (GHL's per-location burst limit is shared with every other GHL lane; V-11 confirms the published number); `retries: 4`; no `onFailure`; **no Katana import**. Steps are in R-11.

**QA.**
- **QA-R1-01** Static test: every file under `src/inngest/` that references `KATANA_TENANT_CONCURRENCY` and was added or modified in Phase 15 imports none of `@/server/integrations/qbo`, `@/server/ghl/private-api`, `@/server/ghl/opportunity-stage`, `@/lib/woocommerce-catalog`, `@/lib/clover-catalog`.
- **QA-R1-02** Static test: `katana-po-bill-post.ts` and `ghl-factory-stage-push.ts` do not import `@/lib/katana`, `@/lib/katana/client`, `./katana-step`, or `KATANA_TENANT_CONCURRENCY`.
- **QA-R1-03** Registration test: `post-katana-po-bill` concurrency has a `"qbo-realm"` env-scoped entry with limit ≤ 2; `push-ghl-factory-stage` has a `throttle`.

#### R-2 · The webhook can beat the hub's own write (CRITICAL)

**Evidence.** The factory push writes `order_intake.katana_sales_order_id` only **after** Katana's `POST /sales_orders` returns (`src/server/ghl/push-factory-order.ts:239-281`), and writes `katana_mo_ids` only after the MTO POSTs return (`:317-321`). Path A does the same for `custom_build_jobs` (`src/inngest/path-a-release.ts:669-675`, `:761-766`). Katana fires `sales_order.*` / `manufacturing_order.*` webhooks *because of* those POSTs, so the first reverse-flow run can arrive while the hub row still has `katana_sales_order_id = NULL`. The original lookup (`katana_sales_order_id = so.id OR katana_order_no = so.orderNo`) then returns 0 rows ⇒ `hub_record_missing` ⇒ the status is dropped until the next Katana event.

**Requirement.**
1. Resolve the hub row from the **deterministic order number**, not from columns the push writes later. `GHL-<opportunityId>` (`ghlFactoryOrderNo`, `src/server/ghl/hold-order.ts:6-8`) ⇒ `order_intake WHERE ghl_opportunity_id = <opportunityId>`. `PA-<opportunityId>` (`katanaOrderNo("path_a", …)`, `src/server/sre/idempotency.ts:52-77`) ⇒ `custom_build_jobs WHERE ghl_opportunity_id = <opportunityId>`. Both columns are UNIQUE (`schema.ts:512`, `:696`), so the lookup returns 0 or 1 row and the "2 rows ⇒ ambiguous" branch is removed. Parsing is an exact closed-prefix match: `^GHL-(.+)$` / `^PA-(.+)$`. `HOLD-`, `MIG-HOLD-`, `WOO-` and anything else ⇒ not reverse-synced.
2. **Duplicate-SO integrity alarm.** If the hub row's `katana_sales_order_id` is non-null and differs from `so.id`, two Katana SOs claim the same opportunity. Throw `NonRetriableError("Katana SO ${so.id} (${orderNo}) conflicts with hub SO ${row.katana_sales_order_id}: duplicate sales order in Katana")`. The global DLQ alerts. No hub write happens.
3. `hub_record_missing` (0 rows) stays a logged skip: legacy pre-hub SOs are normal.

**QA.**
- **QA-R2-01** Saga test: hub row with `katana_sales_order_id = NULL` and `ghl_opportunity_id = 'opp1'`; SO `GHL-opp1` arrives ⇒ the row's `factory_stage` is written.
- **QA-R2-02** Hub row with `katana_sales_order_id = 111`; SO id `222` with order no `GHL-opp1` ⇒ `NonRetriableError`, zero hub writes, zero GHL calls.
- **QA-R2-03** `laneForOrderNo` table test: `HOLD-123`, `MIG-HOLD-FABRIC-20260811`, `ghl-x` (lower case), `GHL-` (empty id), `WOO-9` ⇒ never `ghl_factory` / `path_a`.

#### R-3 · Stale snapshots can overwrite fresh state across retries (HIGH)

**Evidence.** A `step.run` result is memoized. Inngest concurrency limits count steps that are *executing*; a run that is sleeping, debouncing, or waiting on a retry backoff does not hold its key (verify as **V-11**; the blueprint must be correct even if Inngest is stricter). Sequence: run A memoizes snapshot S1 (`IN_PROGRESS`) and its `persist-hub-status` fails on a DB blip; run B starts, reads S2 (`PACKED`), writes `ready_to_ship`; A's retry then writes S1's `katana_so_status = IN_PROGRESS`. The original "never lower the rank" rule protected `factory_stage` only, and only as read-then-write.

**Requirement.**
1. `fetch-katana-sales-order` returns `observedAt` (ISO string captured **inside** the step, so it is memoized with the snapshot).
2. New nullable column `katana_status_observed_at timestamptz` on `order_intake` and `custom_build_jobs` (§VI.M).
3. `persist-hub-status` is ONE conditional UPDATE: `… WHERE id = $id AND (katana_status_observed_at IS NULL OR katana_status_observed_at < $observedAt)`. `factory_stage` is computed in SQL as the higher of stored and derived rank (`CASE` over the four literals), never by a prior SELECT. 0 rows updated ⇒ `{ skipped: "stale_snapshot" }` (log, no throw).
4. `persist-ghl-stage` (in `push-ghl-factory-stage`) is likewise conditional on the stored `ghl_stage_pushed` rank being lower.
5. Wall-clock time is allowed here: `observedAt` is an ordering token for a status mirror, not a financial idempotency key. The C-3 ban on time in QBO `requestid` is unchanged.

**QA.**
- **QA-R3-01** Persist an `observedAt = T2` snapshot, then an `observedAt = T1 < T2` snapshot ⇒ the second UPDATE changes 0 rows and every Katana status column keeps the T2 values.
- **QA-R3-02** `factory_stage` stored `delivered`, derived `in_production` (newer `observedAt`) ⇒ `katana_so_status` updates and `factory_stage` stays `delivered`; log tag `katana-status-regression` emitted.

#### R-4 · Receipt ledger double-bills and raises false alarms (CRITICAL, financial)

**Evidence.** §15.2a counted only `posted`/`dry_run` rows as already billed. A row stays `pending` from `record-receipt` until `mark-posted`. Per-PO concurrency does not cover a run waiting on retry backoff (R-3), so receipt #2 can be recorded while #1 is still `pending`. #2's delta then re-includes #1's quantity and the vendor is billed twice. Also, a run holding an **older** memoized snapshot that records after a newer one computes a negative delta and throws `NonRetriableError` ("needs a vendor credit"): a false alarm and a dead receipt.

**Requirement.**
1. **Accounted statuses.** `billedQtyBefore(rowId)` sums `billedQtyDelta` over prior rows whose status ∈ `{pending, posted, dry_run, requires_manual_intervention}`. A recorded receipt is owed by its own row until a human resolves it; a ledger failure is retried, never rolled back (CLAUDE.md §5).
2. **Serialize in Postgres.** `record-receipt` runs in one `getDb().transaction(...)` that first executes `SELECT pg_advisory_xact_lock(hashtextextended('katana_po_bills:' || $poId, 0))`. It is transaction-scoped, so it is safe on the Supavisor transaction pooler (same family as `token-refresh.ts`). The UNIQUE `(katana_po_id, receipt_seq)` index stays as the backstop.
3. **Superseded snapshots.** New result `{ kind: "superseded" }`: when, for every row, the snapshot's `receivedQtyCumulative` ≤ the highest cumulative already recorded for that row, and at least one row is strictly lower. No row is inserted; the run returns `{ ok: true, skipped: "superseded" }`.
4. **Negative only after a fresh read.** If the delta is negative and the snapshot is not superseded, the function runs a second `runKatanaStep("refetch-katana-po", …)` and recomputes from the fresh read. Only a negative delta confirmed by the fresh read parks the receipt (R-6 parking path: `requires_manual_intervention` + saga row + `NonRetriableError`).
5. **Cumulative rounding.** `amountCents(row) = round(receivedQtyCumulative × pricePerUnitCents) − Σ amountCents previously billed for that row`. The sum of all bills for a fully received PO equals `Σ round(qty × price)` to the cent, regardless of how many partial receipts it took.
6. **Price drift.** If a row's `pricePerUnitCents` differs from the price on that row's previous bill line, set `priceChanged: true` on the new line (extend `KatanaPoBillLine`) and log `katana-po-price-drift` with both prices. No automatic credit or re-bill of already-billed quantity.

**QA.**
- **QA-R4-01** Receipt #1 recorded `pending` (not posted); receipt #2 recorded ⇒ #2's delta excludes #1's quantity. Total billed across both = cumulative received.
- **QA-R4-02** Record snapshot cumulative 7, then a memoized older snapshot cumulative 4 ⇒ `superseded`, no new row, no throw.
- **QA-R4-03** Genuine decrease (fresh re-read also lower) ⇒ parked, exactly one `NonRetriableError`, zero QBO calls.
- **QA-R4-04** Fractional quantities (`ft`): 3 partial receipts of 3.333 / 3.333 / 3.334 at $1.07 ⇒ Σ bills = `round(10 × 107)` cents exactly.
- **QA-R4-05** Two `record-receipt` transactions for the same PO started concurrently (real test DB) ⇒ distinct `receipt_seq` values, no unique violation surfaces to the caller.

#### R-5 · `getMutexDb()` is reserved for the QBO token mutex (HIGH)

**Evidence.** `getMutexDb()` is a dedicated `max: 1` client (`src/server/db/client.ts:107-122`). `token-refresh.ts:11-13` states that touching it again inside the lock callback "would starve or deadlock the process".

**Requirement.** No Phase 15 module calls `getMutexDb()`. Status mirroring uses compare-and-set UPDATEs (R-3); the receipt ledger uses a transaction-scoped advisory lock on `getDb()` (R-4). No QBO or GHL call may run inside an open DB transaction.

**QA.**
- **QA-R5-01** `rg "getMutexDb" src/inngest src/server/katana src/server/ghl src/app/api/webhooks/katana` ⇒ 0.
- **QA-R5-02** Static test: no `qboFetch`, `createQboVendorBillFromKatanaPo`, `ghlGet`, `ghlPut` call appears lexically inside a `.transaction(` callback in Phase 15 files.

#### R-6 · Fail-closed QBO config and manual-intervention parking (CRITICAL, executive decision D-10)

**Evidence.** `createQboVendorBillFromKatanaPo` defaults the asset account to `"81"` (`src/server/integrations/qbo/client.ts:175`). Same defect class elsewhere in the file the lock covers: `pushToQBO` sends `DepositToAccountRef: { value: process.env.QBO_GATEWAY_CLEARING_ACCOUNT_ID }` with no check, so an unset variable posts `{ value: undefined }` (`:96-98`); vendor name falls back to `"Katana Supplier"` (`:136`); bill id falls back to `"unknown"` (`:210`).

**Requirement.**
1. `post-katana-po-bill` step 1 `load-bill-row`: row `posted` ⇒ return `{ duplicate: true }`; `requires_manual_intervention` ⇒ return `{ parked: true }` (no alert repeat); `dry_run`/`no_delta` ⇒ return; only `pending` continues.
2. Step 2 `assert-ledger-config` (pure, before any QBO I/O): `QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID` must match `/^\d+$/` after trim; `LEDGER_COMPANY_TIMEZONE` must be a valid IANA zone (R-8). On failure, in one `step.run("park-manual-intervention")`:
   - `katana_po_bills.status = 'requires_manual_intervention'`, `last_error` = the config message (no secrets);
   - `saga_runs` row (`saga_type = 'katana_po_bill'`, `correlation_key = \`${katanaPoId}:${receiptSeq}\``) set to `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION` via `sagaStore.fail(...)`;
   - then `throw new NonRetriableError(...)`. The global DLQ writes one `dlq_events` row and sends **one** Oh-Crap alert (G-6: no `onFailure`). The Mission Control QBO lamp turns red on its own, because it counts `saga_runs` in that status (`src/server/mission-control/health-probes.ts:100-103`).
3. `record-receipt` creates that `saga_runs` row with `sagaStore.insertOnce({ sagaType: "katana_po_bill", correlationKey, status: "IN_PROGRESS", currentStep: "recorded" })`. Terminal transitions: `COMPLETED` with `current_step` ∈ `{posted, dry_run, no_delta}`; or the parked status above.
4. In `qbo/client.ts`: remove `|| "81"` (throw a typed `QboConfigError` instead); `pushToQBO` throws `QboConfigError` when `QBO_GATEWAY_CLEARING_ACCOUNT_ID` is not `/^\d+$/`; remove the `"Katana Supplier"` fallback (empty name ⇒ throw); `"unknown"` bill id ⇒ throw. `post-katana-po-bill` maps `QboConfigError` to the parking path.
5. In **log** mode none of this throws: the dry-run summary carries `qboConfigReady: boolean` so the operator sees the gap before flipping to live.
6. `katana_po_bills` CHECK: `failed` is replaced by `requires_manual_intervention` (§VI.M). The table is new, so this is not a destructive change.

**QA.**
- **QA-R6-01** Live mode, `QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID` unset ⇒ zero `fetch` calls to QBO; bill row `requires_manual_intervention`; saga row `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`; `NonRetriableError`; function defines no `onFailure`.
- **QA-R6-02** Same with value `"abc"` and `" "` ⇒ identical outcome.
- **QA-R6-03** `rg '"81"|Katana Supplier|"unknown"' src/server/integrations/qbo/client.ts` ⇒ 0.
- **QA-R6-04** Log mode with the variable unset ⇒ no throw, `qboConfigReady: false` in the run output.
- **QA-R6-05** `pushToQBO` with `QBO_GATEWAY_CLEARING_ACCOUNT_ID` unset ⇒ throws before any `fetch`; the existing `fail-closed ledger containment` assertions in `tests/ledger-mode.test.ts` still pass unmodified.

#### R-7 · QBO error semantics and ambiguous POSTs (HIGH, financial)

**Evidence.** `qboFetchWithRefresh` throws `QboApiError(message, status)` for any non-2xx (`token-refresh.ts:441-446`), `QboApiTimeoutError` on timeout, and `QboAuthError` after a failed refresh retry. A timeout on a POST is **ambiguous**: the bill may exist. QBO deduplicates a repeated `requestid`, but its retention window is not documented as unlimited.

**Requirement (in `post-katana-po-bill`).**
1. Step `resolve-vendor`: QBO vendor lookup must include inactive vendors (`… WHERE DisplayName = '…' AND Active IN (true, false)`). Inactive match ⇒ parking path (D-12). Persist the resolved id into `katana_po_bills.qbo_vendor_id`.
2. Step `reconcile-existing-bill` (always, before POST): `SELECT Id, TotalAmt, VendorRef FROM Bill WHERE DocNumber = '<docNumber>'`. A match with the same vendor and `TotalAmt` equal to `deltaTotalCents / 100` ⇒ adopt its `Id`, mark posted, skip the POST. A match with a different amount or vendor ⇒ parking path ("bill already exists in QBO with different content").
3. Step `post-qbo-vendor-bill`: same deterministic `requestid` on every attempt.
4. Error mapping: `QboApiError` 400/422 (including duplicate-name 6240) ⇒ parking path; 429 ⇒ `RetryAfterError(msg, "60s")`; 5xx / `QboApiTimeoutError` / network ⇒ rethrow (Inngest retries, same `requestid`); `QboAuthError` ⇒ `NonRetriableError` (token-refresh already alerts `qbo_auth_failed`; that alert predates G-6 and is accepted).

**QA.**
- **QA-R7-01** QBO mock times out on POST attempt 1 (bill created server-side), attempt 2's reconcile query finds it ⇒ exactly one bill, row `posted` with the found `Id`, zero second POST.
- **QA-R7-02** Reconcile finds a same-DocNumber bill with a different total ⇒ parked, zero POST.
- **QA-R7-03** QBO 429 ⇒ `RetryAfterError`; QBO 400 ⇒ parked; QBO 503 ⇒ rethrown with the same `requestid` on the next attempt.

#### R-8 · Accounting period, currency, and DocNumber (MEDIUM, financial)

**Evidence.** `TxnDate` is `new Date()` at fetch time (`katana-po-received.ts:138`). A receipt on the 31st that posts on the 1st (backlog, retries, a lane flip) lands A/P in the wrong period. Katana POs can carry a non-home currency, and the bill builder assumes USD.

**Requirement.**
1. **V-8:** identify the Katana receipt-date field (row `received_date` or equivalent) from the 15.0 fixtures. `katana_po_bills.receipt_date date` = the calendar date, in `LEDGER_COMPANY_TIMEZONE`, of the latest receipt date among the delta rows. If Katana gives no date, use the row's `created_at` in that zone. **Never** the post time. `TxnDate = receipt_date`.
2. `LEDGER_COMPANY_TIMEZONE` (new env, IANA name, no default): required for live posting (R-6 parking path when missing); documented in `.env.example`; added to `src/env.ts` as optional.
3. **V-9:** identify the PO currency field. Currency ≠ `USD` ⇒ parking path ("multi-currency A/P requires a human").
4. DocNumber rule from §15.2a stands (≤ 21 chars, `-R{n}` suffix never cut).

**QA.**
- **QA-R8-01** Receipt dated `2026-10-31T23:30:00-07:00` with `LEDGER_COMPANY_TIMEZONE=America/Phoenix`, posted on 2026-11-01 ⇒ `TxnDate = 2026-10-31`.
- **QA-R8-02** PO currency `EUR` ⇒ parked, zero POST.

#### R-9 · Rate-limit context leaks (HIGH)

**Evidence.** `katanaFetch` reads `katanaRateLimitStore.getStore() ?? "sleep"` (`src/lib/katana.ts:436`); under `sleep` it retries 3 times, waiting up to 65 s each, inside the same request (`:72`, `:454-460`). Only `runKatanaStep` sets `defer` (`src/inngest/katana-step.ts:20`). The legacy MO lister falls back to `/manufacturing_orders?is_linked_to_sales_order=true` on 400/422 (`katana.ts:2253-2256`), which returns MOs for **every** SO; "all MOs DONE" computed on that list is meaningless. The strict lister `listKatanaManufacturingOrderNodesForSalesOrder` (`:2487-2507`) throws when the listing is not exhausted. GHL returns 429 as `"GoHighLevel returned 429."` (`private-api.ts:85-88`), which the plan treated as a generic retry.

**Requirement.**
1. Export `assertKatanaDeferContext(label: string): void` from `src/inngest/katana-step.ts`. It throws `Error(\`${label} must run inside runKatanaStep\`)` when `katanaRateLimitStore.getStore() !== "defer"`. Every Phase 15 Katana reader (SO fetch, MO list, PO fetch, PO refetch, supplier fetch, variant heal) calls it as its first line.
2. The reverse flow lists MOs **only** through `listKatanaManufacturingOrderNodesForSalesOrder` and additionally filters `node.sales_order_id === so.id` client-side. The legacy `listManufacturingOrdersForSalesOrder` and the `is_linked_to_sales_order` query are banned in Phase 15 files. The original "cap 20 pages" wording is void: non-exhaustion throws.
3. `katanaMoDone` is **hub-first**: `order_intake WHERE katana_mo_ids @> to_jsonb(ARRAY[$moId])` and `custom_build_jobs` likewise (plus `custom_build_job_items.katana_mo_id = $moId`). Hit with `katana_sales_order_id` set ⇒ emit `KATANA_SO_STATUS_EVENT` with that id. Hit without it ⇒ `skipped: "so_not_persisted_yet"` (the reconcile cron catches up). Miss ⇒ `skipped: "mo_not_in_hub"` (non-hub MOs are never reverse-synced). **Zero Katana calls**, so `katanaMoDone` does **not** carry `KATANA_TENANT_CONCURRENCY`. `idempotency: "event.data.manufacturingOrderId"`.
4. GHL 429 (`/returned 429\b/`) ⇒ `RetryAfterError(msg, "30s")`. QBO 429 per R-7.

**QA.**
- **QA-R9-01** Calling any Phase 15 Katana reader outside `runKatanaStep` throws before `fetch` is called.
- **QA-R9-02** `rg "is_linked_to_sales_order|listManufacturingOrdersForSalesOrder" src/inngest src/server/katana` ⇒ 0.
- **QA-R9-03** MO list containing a node with a different `sales_order_id` ⇒ that node is ignored by `deriveFactoryStage`.
- **QA-R9-04** `katanaMoDone` test with a spy on `globalThis.fetch` ⇒ zero calls for hit, miss, and not-persisted cases.

#### R-10 · Webhook storm at the route, and lost webhooks (HIGH)

**Evidence.** The `variant.updated` branch calls `loadKatanaVariantSku` inline (`src/app/api/webhooks/katana/route.ts:124-126` → `src/server/katana/variant-webhook.ts:242-245`). That request goes through the shared bucket, which waits up to 30 s for a token (`katana-throttle.ts:31`), and then the `sleep` 429 policy (R-9). Fifty concurrent deliveries therefore queue behind a 1 req/s bucket for up to 30 s each, past Katana's delivery timeout (V-10). Katana retries, which amplifies the storm, and a sustained failure rate may get the subscription disabled. Katana's signature has no timestamp, so replays are possible.

**Requirement.**
1. **The route makes zero Katana calls on every branch.** `variant.updated` without a SKU in the body enqueues `katana/variant.heal.requested` `{ variantId }` (event id `inngestEventId("katana:variant", variantId, auditKey)`) and returns `200 { ok: true, queued: true }`. New function **`heal-katana-variant-sku`** in `src/inngest/katana-variant-heal.ts`: `concurrency: [{ limit: 1, key: "event.data.variantId" }, KATANA_TENANT_CONCURRENCY]`, `retries: 3`; step `fetch-katana-variant` (`runKatanaStep` + R-9 guard), then `heal-sku` calling the existing `healKatanaVariantSku` + `logPimAudit` + the same `revalidatePath` calls the route makes today. When the body already carries the SKU, the route keeps healing inline (DB only).
2. **Route budget per delivery:** signature check, ≤ 2 DB statements (audit insert, audit status update), ≤ 1 `inngest.send`. Hold release keeps its existing DB work.
3. **Replay safety (accepted risk, made explicit).** Every handler is state-transfer: it re-reads Katana and writes idempotently. Replaying a body N times yields the same hub state and zero extra QBO/GHL writes.
4. **Reconciliation cron (D-13).** In `src/inngest/katana-order-status.ts`: `katana-order-status-reconcile`, `triggers: [{ cron: "15 * * * *" }]`, `concurrency: { limit: 1 }`, no Katana calls (so no tenant key). Selects ≤ 25 rows across `order_intake` / `custom_build_jobs` where `katana_sales_order_id IS NOT NULL AND (factory_stage IS NULL OR factory_stage <> 'delivered') AND (katana_status_synced_at IS NULL OR katana_status_synced_at < now() - interval '6 hours')`, oldest first. Emits `KATANA_SO_STATUS_EVENT` with id `katana:so:${soId}:reconcile:${yyyymmddhh}`. Worst case is about 50 Katana GETs per hour.
5. **Operator pre-flight (added to §I.5):** confirm `POSTGRES_URL` on the hub deployment is the Supavisor **transaction** pooler (6543) or direct. On the session pooler (5432), a storm across many serverless instances exhausts "max clients" (see the warning in `db/client.ts:93-95`).

**QA.**
- **QA-R10-01** Static test: `route.ts` imports neither `loadKatanaVariantSku` nor anything that resolves to `katanaFetch`.
- **QA-R10-02** `scripts/qa/simulate-webhooks.ts` fires 50 concurrent signed deliveries (mixed SO / MO / PO / variant) at the local route ⇒ 50 × 2xx, p95 latency < 1000 ms, 50 audit rows, 50 `inngest.send` calls. Raw timing output pasted in the handback.
- **QA-R10-03** The same signed `sales_order.updated` body replayed 5 times ⇒ identical hub row afterwards, zero additional GHL PUTs.
- **QA-R10-04** Reconcile cron unit test: 30 eligible rows ⇒ 25 events, deterministic ids, zero `fetch` calls.

#### R-11 · GHL stage push must be closed-set end to end (HIGH)

**Evidence.** `isProduceFactoryOrderStage` matches by ID **or by stage name** `"Produce Factory Order"` (`src/server/ghl/factory-stage.ts:21-29`). The GHL webhook route inserts a new `order_intake` row for any opportunity that enters that stage and has no row yet (`src/app/api/webhooks/ghl/route.ts:107-155`). A Path A opportunity has a `custom_build_jobs` row but usually no `order_intake` row, so an echo there creates a fresh triage intake that staff could push to Katana as a duplicate SO. Stage-id sets are read as `string[]` with `.includes` (`factory-stage.ts:3-19`). The plan never checked opportunity `status`, `locationId`, or that the target IDs belong to the factory pipeline. An opportunity can also have rows in both lanes.

**Requirement (`src/server/ghl/opportunity-stage.ts` + `push-ghl-factory-stage`).**
1. **Closed sets.** Build `ReadonlySet<string>` once per invocation from trimmed env values; membership only via `.has()` on exact IDs. Case-sensitive. No substring or name matching for decisions.
2. **Config validation (`validate-ghl-stage-config` step, live mode only).** `GET /opportunities/pipelines?locationId=<GHL_LOCATION_ID>`. All configured `GHL_STAGE_ID_*` must (a) belong to `GHL_FACTORY_PIPELINE_ID`'s stage list, (b) be pairwise distinct, (c) not be in `GHL_FACTORY_STAGE_IDS ∪ GHL_WON_STAGE_IDS`, and (d) not be named `PRODUCE_FACTORY_ORDER_STAGE` (trimmed, case-insensitive). Any violation ⇒ `NonRetriableError("GHL stage config invalid: …")` (DLQ alert), zero PUTs.
3. **Opportunity gates (in `moveOpportunityStage`).** `locationId` must equal `GHL_LOCATION_ID`, else `wrong_location`. `status` ∈ `{open, won}` (trimmed, lower-cased), else `foreign_status` (Lost/Abandoned are human decisions). `pipelineId` must equal `GHL_FACTORY_PIPELINE_ID`, else `wrong_pipeline`. Current stage: in our 4 ⇒ its rank; in `GHL_FACTORY_STAGE_IDS ∪ GHL_WON_STAGE_IDS` ⇒ rank 0 (movable); otherwise `foreign_stage`. If both env sets are empty, every non-ours stage is foreign: zero moves, fail closed, one log line per run.
4. **PUT body** is exactly `{ pipelineId, pipelineStageId }`. Never `status`, `monetaryValue`, or `name`.
5. **Post-write verification.** GET again after the PUT. Stage ≠ target, or status no longer `open`/`won` ⇒ log `ghl-stage-race-detected` with both values (a human moved it in the window). No retry loop, no throw. GHL has no conditional write, so this is detection only.
6. **Multi-lane aggregation.** The push target for an opportunity is the **minimum** `factory_stage` rank across its `order_intake` and `custom_build_jobs` rows that have a non-null `factory_stage`. An opportunity is only as far along as its least advanced order.
7. **Mode gate.** `KATANA_REVERSE_SYNC_MODE` ≠ `live` ⇒ dry-run log and return before any GHL call, including the GETs.
8. **Path A summary refresh** (original §15.4c step 9) moves into this function, after `persist-ghl-stage`.

**QA.**
- **QA-R11-01** Config test matrix: target id outside the factory pipeline; two targets equal; target in won set; target stage named `produce factory order ` ⇒ each throws `NonRetriableError`, zero PUTs.
- **QA-R11-02** Opportunity `status = "lost"` with a factory-pipeline stage ⇒ `foreign_status`, zero PUTs.
- **QA-R11-03** Opportunity in another location ⇒ `wrong_location`, zero PUTs.
- **QA-R11-04** PUT body deep-equals `{ pipelineId, pipelineStageId }`.
- **QA-R11-05** Opportunity with `order_intake.factory_stage = delivered` and `custom_build_jobs.factory_stage = in_production` ⇒ target `in_production`.
- **QA-R11-06** Post-write GET shows a different stage ⇒ `ghl-stage-race-detected` logged, function returns ok, no retry.
- **QA-R11-07** `rg "\.includes\(" src/server/ghl/opportunity-stage.ts` ⇒ 0.

#### R-12 · Partial MO set reads as "build complete" (MEDIUM)

**Evidence.** §15.4a precedence row 3 said `mos.length > 0 && every mo DONE ⇒ build_complete`. Mid-push (R-2), only some MOs exist; if those few are DONE (fast sub-tasks), the stage jumps early and GHL is told the build is complete.

**Requirement.** `deriveFactoryStage(so, mos, expectedMoIds)`. The MO-derived `build_complete` path requires `expectedMoIds.length > 0` and every expected id present in `mos` with status DONE. `expectedMoIds` = the hub row's `katana_mo_ids` (`custom_build_job_items.katana_mo_id` for Path A). `so.productionStatus === "DONE"` stays authoritative on its own.

**QA.**
- **QA-R12-01** Expected `[1,2,3]`, listing `[1 DONE, 2 DONE]` ⇒ not `build_complete`.
- **QA-R12-02** Expected `[]` and all listed MOs DONE ⇒ not `build_complete` unless `so.productionStatus === "DONE"`.

#### R-13 · DLQ alerts for the new functions need resolution context (LOW)

**Evidence.** `resolveDlqContext` maps function ids to a resolution link and a source (`src/inngest/dlq-context.ts:82-123`). New ids fall through to a generic alert with no link.

**Requirement.** Add entries for `sync-katana-po-received`, `post-katana-po-bill`, `sync-katana-order-status`, `push-ghl-factory-stage`, `katana-mo-done`, `heal-katana-variant-sku`, `katana-order-status-reconcile`. Each `resolutionPath` must be an existing app route (for example `/mission-control` for QBO, `/admin/order-triage` for GHL factory, `/admin/path-a?opp=…` for Path A). No new UI (DLQ UI is forbidden, G-8).

**QA.**
- **QA-R13-01** Unit test: each new id resolves to a non-generic context, and each `resolutionPath` maps to an existing directory under `src/app/`.

#### R-14 · Echo loops (verified safe, now pinned by tests)

**Evidence.** The reverse flow is read-only against Katana (G-1), so it cannot cause Katana webhooks. Our GHL PUT does fire GHL's webhook; the GHL route ignores non-factory stages and logs with an idempotent key (`route.ts:107-121`).

**Requirement / QA.**
- **QA-R14-01** Feed the GHL route the exact payload GHL would send after our PUT to `GHL_STAGE_ID_BUILD_COMPLETE` ⇒ `200 { ignored: true }`, zero `order_intake` inserts.

#### R-15 · Blueprint self-inconsistency: ledger-flag call sites (LOW)

**Evidence.** §I.3 rewires `src/inngest/woo-order.ts:94` and `src/server/woocommerce/ledger-leg.ts:35`, but those files were only in the Phase 16 lock, while QA-I-02 demanded zero `LEDGER_PIPELINE_MODE` readers outside `ledger-mode.ts`/`env.ts`.

**Requirement.** Phase 15 adds the lane API and rewires the QBO, Clover, and Katana call sites; the deprecated wrappers stay. Phase 16 rewires the two Woo call sites. QA-I-02 and QA-I-07 are graded at the Phase 16 gate.

#### R-16 · Dirty working tree will fail QCA before AG writes a line (BLOCKER, process)

**Evidence.** `qca.mjs` diffs against `base_ref` with blast-radius tolerance 0 and rejects any changed path outside `allowed_files`. The tree currently carries uncommitted Phase 14 leftovers: `playwright.config.ts`, `src/app/admin/dictionary/SkuTable.tsx`, `tests/e2e/auth.spec.ts`, `tests/e2e/factory-bom-lifecycle.spec.ts`, `scripts/ops/inject-legacy-wip.ts`, `data_migration/1022Update/`, `data_migration/reports/legacy-wip-inject.json`.

**Requirement (operator, before AG starts).** Commit (or stash) those files under Phase 14, then set `base_ref` in `.cursor/phase.lock` to the new commit. AG must STOP if `git status --short` shows anything outside the Phase 15 lock other than `.cursor/phase.lock` and `.cursor/session-stamp.json`. `expected_blast_radius` (44) is an estimate; the operator sets the exact number at handback (fixture count is unknown until 15.0).

#### R-17 · Broaden the env-name ban (LOW)

**Requirement.** QA-I-01 becomes `rg "WOOCOMMERCE_API_URL|WOOCOMMERCE_BASE_URL|WOOCOMMERCE_STORE_URL|WOO_API_URL|WOO_URL\b|WC_STORE_URL" src/ scripts/ tests/ .env.example` ⇒ 0. The only Woo base-URL variable is `WOOCOMMERCE_URL`.

### VI.2 New VERIFY items (add to the 15.0 handback)

- **V-8** Katana PO receipt date field (row level) and its format/timezone.
- **V-9** Katana PO currency field and values.
- **V-10** Katana webhook delivery timeout, retry schedule, and whether Katana disables a subscription after repeated failures (Katana docs or support).
- **V-11** From the official Inngest docs: (a) whether a run waiting on retry backoff or debounce holds a concurrency key; (b) GHL's published per-location rate limit. The design in R-1, R-3, R-4 is correct either way; AG records the answer.

### VI.M Migration delta for `0057_katana_reverse_flow.sql` (supersedes the matching lines in §15.1b)

Inside `CREATE TABLE "katana_po_bills"`, add after `"last_error" text,`:

```sql
	"receipt_date" date,
	"qbo_vendor_id" text,
```

Replace the status CHECK with:

```sql
	CONSTRAINT "katana_po_bills_status_check" CHECK ("katana_po_bills"."status" in ('pending', 'posted', 'dry_run', 'no_delta', 'requires_manual_intervention')),
```

Append after the existing `custom_build_jobs` ADD COLUMN lines:

```sql
ALTER TABLE "order_intake" ADD COLUMN "katana_status_observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "custom_build_jobs" ADD COLUMN "katana_status_observed_at" timestamp with time zone;--> statement-breakpoint
```

Mirror in `schema.ts`: `KATANA_PO_BILL_STATUSES = ["pending","posted","dry_run","no_delta","requires_manual_intervention"] as const`; `KatanaPoBillLine` gains `priceChanged?: boolean`; QA-15.1-03 (CHECK text parity) covers the new CHECK. Everything stays additive (G-2). No index on `katana_mo_ids` is required (small tables); if AG adds a GIN index, it must be `CREATE INDEX` only.

### VI.3 Updated Inngest function inventory (supersedes Appendix B for Phase 15 rows)

| Function id | File | Trigger | Concurrency | Other | External I/O |
|---|---|---|---|---|---|
| `sync-katana-po-received` (modified) | `katana-po-received.ts` | `katana/purchase_order.received` | `[{1, event.data.purchaseOrderId}, KATANA_TENANT_CONCURRENCY]` | idempotency `event.id` | Katana GET, Postgres |
| `post-katana-po-bill` (new) | `katana-po-bill-post.ts` | `katana/po_bill.post_requested` | `[{1, event.data.katanaPoId}, {2, "qbo-realm", env}]` | idempotency `event.data.billRowId`, retries 5 | QBO, Postgres |
| `katana-mo-done` (new) | `katana-order-status.ts` | `katana/manufacturing_order.done` | none (no Katana I/O) | idempotency `event.data.manufacturingOrderId`, retries 3 | Postgres |
| `sync-katana-order-status` (new) | `katana-order-status.ts` | `katana/sales_order.status_changed` | `[{1, event.data.salesOrderId}, KATANA_TENANT_CONCURRENCY]` | debounce 20s / timeout 2m, retries 3, no idempotency | Katana GET, Postgres |
| `katana-order-status-reconcile` (new) | `katana-order-status.ts` | cron `15 * * * *` | `{limit: 1}` | ≤ 25 events per tick | Postgres |
| `push-ghl-factory-stage` (new) | `ghl-factory-stage-push.ts` | `ghl/factory_stage.push_requested` | `[{1, event.data.opportunityId}]` | throttle 20/10s, retries 4 | GHL, Postgres |
| `heal-katana-variant-sku` (new) | `katana-variant-heal.ts` | `katana/variant.heal.requested` | `[{1, event.data.variantId}, KATANA_TENANT_CONCURRENCY]` | retries 3 | Katana GET, Postgres |

All registered in `inngestFunctions` (`src/inngest/functions.ts`). None defines `onFailure` (G-6). The Katana-tenant `it.each` in `tests/woo-static-guards.test.ts` lists exactly the three rows above that carry `KATANA_TENANT_CONCURRENCY`, and QA-R1-02 asserts the other new functions do not.

### VI.4 Test placement

`tests/phase15-reverse-flow-resilience.test.ts` (new, in the lock and in `target_test`) holds every `QA-R*` case that is not naturally a parser or ledger unit test. Add it to `qa:phase0-unit` in `package.json` with the other Phase 15 files (§15.5).

---

## Appendix A — Complete new-file manifest

| Phase | Path | Kind |
|---|---|---|
| 15 | `src/server/db/migrations/0057_katana_reverse_flow.sql` | SQL (additive) |
| 15 | `src/server/db/migrations/meta/0059_snapshot.json` | Drizzle meta |
| 15 | `src/server/katana/webhook-events.ts` | pure parsers |
| 15 | `src/server/katana/po-receipt-ledger.ts` | pure delta billing |
| 15 | `src/server/katana/order-status.ts` | pure status derivation |
| 15 | `src/server/ghl/opportunity-stage.ts` | GHL stage writer |
| 15 | `src/server/pipeline/katana-reverse-mode.ts` | mode gate |
| 15 | `src/inngest/katana-order-status.ts` | `katanaMoDone`, `syncKatanaOrderStatus` |
| 15 | `tests/phase15-katana-reverse-flow.test.ts` | tests |
| 15 | `tests/phase15-po-receipt-ledger.test.ts` | tests |
| 15 | `tests/fixtures/katana/*.json` | redacted fixtures |
| 15 | `src/inngest/katana-po-bill-post.ts` | `post-katana-po-bill` (rev 2, §VI R-1) |
| 15 | `src/inngest/ghl-factory-stage-push.ts` | `push-ghl-factory-stage` (rev 2, §VI R-1/R-11) |
| 15 | `src/inngest/katana-variant-heal.ts` | `heal-katana-variant-sku` (rev 2, §VI R-10) |
| 15 | `tests/phase15-reverse-flow-resilience.test.ts` | `QA-R*` tests (rev 2) |
| 16 | `src/server/pipeline/woo-catalog-mode.ts` | mode gate |
| 16 | `src/server/woocommerce/devsite-guard.ts` | DevSite guard |
| 16 | `src/inngest/woo-catalog-backfill.ts` | `wooCatalogBackfill`, `wooCatalogPublishSku` |
| 16 | `scripts/ops/trigger-woo-catalog-backfill.ts` | ops script |
| 16 | `scripts/ops/replay-woo-dry-runs.ts` | ops script |
| 16 | `tests/phase16-woo-catalog-safety.test.ts` | tests |
| 16 | `tests/woo-replay-dry-runs.test.ts` | tests |

## Appendix B — New Inngest function and event inventory

| Function id | Trigger event | Concurrency | Other options | Katana I/O |
|---|---|---|---|---|
| `katana-mo-done` | `katana/manufacturing_order.done` | `KATANA_TENANT_CONCURRENCY` | `idempotency: event.id`, retries 3 | GET only |
| `sync-katana-order-status` | `katana/sales_order.status_changed` | `[{limit:1,key:event.data.salesOrderId}, KATANA_TENANT_CONCURRENCY]` | `debounce 20s / timeout 2m`, retries 3, **no** idempotency | GET only |
| `sync-katana-po-received` (modified) | `katana/purchase_order.received` | unchanged | unchanged | GET only |
| `woo-catalog-backfill` | `woo/catalog.backfill.requested` | `{limit:1}` | `idempotency: event.data.backfillId`, retries 1 | none |
| `woo-catalog-publish-sku` | `woo/catalog.publish.requested` | `[{limit:1,key:event.data.globalSku},{limit:3}]` | `throttle 2/1s`, `idempotency: event.id`, retries 3 | none |

## Appendix C — Things AG must NOT do (quick list)

- Do not add `ALTER TYPE` / CHECK on `incoming_webhooks` (C-1).
- Do not introduce `WOOCOMMERCE_API_URL` (C-2).
- Do not put time or randomness into any QBO `requestid` (C-3).
- Do not write `order_intake.status` or `order_intake.version` from the reverse flow.
- Do not move a GHL opportunity backwards, across pipelines, or out of a foreign stage (D-8).
- Do not send `status` on Woo product updates (C-6).
- Do not set `manage_stock: true` anywhere.
- Do not flip `ORDER_PIPELINE_MODE` or `CATALOG_PUBLISH_MODE` to `live` for DevSite testing.
- Do not mutate `saga_runs` from the replay script.
- Do not build anything for Phase 17.
- Do not edit `.cursor/phase.lock` to widen your own `allowed_files`; ask the operator.
- (rev 2) Do not call QBO or GHL from any function that carries `KATANA_TENANT_CONCURRENCY` (D-11).
- (rev 2) Do not use `getMutexDb()` outside the QBO token mutex (§VI R-5).
- (rev 2) Do not default any QBO account id, vendor name, or bill id (D-10).
- (rev 2) Do not call Katana from the webhook route (§VI R-10).
- (rev 2) Do not look up hub rows by `katana_sales_order_id` / `katana_order_no` in the reverse flow; use the opportunity id from the order number (§VI R-2).
- (rev 2) Do not use `.includes()` or name matching for GHL stage decisions (§VI R-11).
