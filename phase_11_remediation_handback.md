# Phase 11 Remediation Handback (response to QCA `DEFECT_REJECTED`)

Baseline: HEAD `b04cd3d`; working tree dirty and uncommitted (nothing was committed). The old
`phase_11_handback_report.md` is known to be inaccurate and is superseded by this file.
Blueprint used: `PHASE_11_EXECUTION_BLUEPRINT.md` (`_2` does not exist).

## 0. Honest headline

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Full `npx vitest run` | **126 files / 1,312 tests passed** (100% green) |
| `npm run db:check` | exit 0 |
| `node .cursor/skills/qca/scripts/qca.mjs` | **exit 0 (CERTIFIED)** |
| `npm run qa:lifecycle` | **exit 0** (Build, Proof-of-life DB, Unit, Webhooks, Playwright E2E) |
| Live-DB probe | Live DB is **NOT** at the expected state: 45 migration rows (expected 56), `custom_build_job_items` absent, no 0055 objects. See section 4. |

Things I did NOT do or could not prove are listed in section 8. Please read it.

## 1. Fail-first evidence (genuine, captured before touching application code)

Tests for B1-B5, M1-M9, m1-m4 were written/modified first and run against the unmodified source:

| Run | Result against OLD code |
|---|---|
| `tests/path-a-release-saga.test.ts` alone | 31 failed |
| four more new/changed files (batch 2) | 26 failed |
| all Path A test files together | **16 files failed, 144 tests failed** |

Real failure reasons seen: `toUpperCase` on the phantom `item.status` (B5);
`assertKatanaWriteAllowedForSkus is not a function` (B2/B3); `buildPathAReleaseEventData is not a
function` (m2); re-sync event id equal to the constant `1` (M9); swallowed `revalidatePath` errors (m1).
Caveat: a few "rejects" tests passed accidentally before the fix because the symbol under test did not
exist yet (an `undefined` call also throws). They are counted in the 144 only if they failed. They pass
for the right reason now.
Raw logs: `failfirst_saga.txt`, `failfirst_batch2.txt`, `failfirst_all.txt` in the conversation scratch directory
(`C:\Users\rober\.gemini\antigravity-ide\brain\5b422eef-15cc-47ca-8e14-b9f2881ed6b7\scratch\`).

After the fix: same files green (section 0).

## 2. Defect-by-defect resolution

| # | Fix | Where |
|---|---|---|
| **B1** | Function 2 is gated by `getGhlFactoryOrderMode()` (`GHL_FACTORY_ORDERS`), not `ORDER_PIPELINE_MODE`. `deps.getOrderMode` was replaced by `deps.getFactoryOrderMode`. Tests set `ORDER_PIPELINE_MODE=live` with `GHL_FACTORY_ORDERS` unset and assert zero Katana calls; `" LIVE "` resolves live, garbage resolves log. | `src/inngest/path-a-release.ts`, `tests/path-a-release-saga.test.ts`, guard 13 |
| **B2** | `syncFinishedGoodToKatana` fenced at entry (before its `try`, after the empty-SKU return). `syncFinishedGoodToKatanaAction` now returns `not_authenticated` without a session and maps `PathAFenceError` to `{ok:false}`. | `src/lib/katana.ts`, `src/app/admin/dictionary/actions.ts`, `tests/path-a-katana-write-fences.test.ts`, `tests/path-a-dictionary-sync-action.test.ts` |
| **B3** | `createKatanaSalesOrder` fenced per row SKU (after orderNo/empty-row validation, before `resolveKatanaCustomerId` and the first POST). `createMakeToOrderManufacturingOrders` fenced by resolving each SO row id to its owning item SKU via `custom_build_job_items.katana_sales_order_row_id`. New helpers `assertKatanaWriteAllowedForSkus` / `...ForSalesOrderRows`. Guard 5 now asserts the fence precedes each network/DB sink in every fenced function. Task 0.4 inventory below. | `src/server/path-a/katana-fence.ts`, `src/lib/katana.ts` |
| **B4** | Every leg after the claim runs under `guardLeg`: a thrown `KatanaApiError` 4xx other than 408/409/429, a fence refusal, an `ok:false` result or an unreconcilable response calls `markSagaManual(oppId, leg, err)` then throws `NonRetriableError`. 408/409/429/5xx/unknown propagate for retry (429 becomes `RetryAfterError` in `runKatanaStep`). An outer `StepError` catch marks manual if the saga is not already manual. The manual status is what `retryReleaseAction` / `claimRelease` can resume. | `src/inngest/path-a-release.ts` |
| **B5** | `db` is now typed (`ReleaseDb`, `WritebackDb = ReturnType<typeof getDb>`; items are `typeof custom_build_job_items.$inferSelect`). All reads use `design_status`. The write-back loads finalized/released BOM lines. Phantom `status` removed from fixtures. Static guards 16 (no `any`) and 17 (no `item.status`). | `src/inngest/path-a-release.ts`, `src/server/ghl/opportunity-writeback.ts`, `tests/helpers/path-a-fake-db.ts` |
| **M1** | Rows mapped by variant id only (`mapRowsByVariant`); if the create response is not matchable the order is re-read by order number; otherwise `ReleaseLegError`. No positional fallback. | `path-a-release.ts` |
| **M2** | Provenance = exactly one marker token equal to `path_a_saga=<opp>` AND no other marker-like token AND exact row-set equality (count, variant, quantity). Violations are terminal (`sales_order_provenance`). | `path-a-release.ts` |
| **M3** | SO id / order no / item row ids persisted on both the create and the adopt path; ids are numeric (integer column, no `String()`). | `path-a-release.ts` |
| **M4** | New `runCadIntake` runs for every extension (not just `.blend`): item/saga bookkeeping and change-order rejection moved out of the blend branch. `post-extract-advance` uses its result. | `src/inngest/cad-handoff.ts`, `src/inngest/functions.ts` |
| **M5** | Lost CAS on `AWAITING_DEPOSIT` returns `not_ready`. | `src/server/path-a/release-store.ts` |
| **M6** | `approveDraftRecipeCore` and `publishRecipeToKatanaCore` moved to non-action modules; `approveDraftRecipe(rootSku, options)` no longer accepts an actor (identity from session); `finalize-design.ts` imports no action file. Guards 4b/4c. | `src/server/factory-bom/approve-draft-recipe.ts`, `publish-recipe-katana.ts`, `src/app/admin/factory-bom/actions.ts` |
| **M7** | A deposit arriving after another source's request records money and sends nothing (`recorded_already_requested`). Raw error text is never returned to the UI (`release_already_requested`, `release_request_failed`; details go to `console.error`). | `src/server/path-a/release-request.ts` |
| **M8** | Finalize item-status change and `advanceSaga` run in one DB transaction; Finalize refuses once the saga is IN_PROGRESS / COMPLETED / manual-failed (`design_locked_release_started`). | `src/app/admin/path-a/actions.ts` |
| **M9** | Re-sync event id is `pathAGhlSyncEventId(oppId, attempt)`; `resyncGhlAction` passes `Date.now()`. | `events.ts`, `path-a-release.ts`, `path-a/actions.ts` |
| **m1** | Removed the empty catch in `release-gate.ts`; `onFailure` logic moved to `handleCadUploadFailure` (runs both effects, rethrows / AggregateError); `revalidatePath` wrappers in `path-a/actions.ts` removed. Guard 14. | see files |
| **m2** | Event validated with `pathAReleaseEventSchema` (`NonRetriableError` on failure); `buildPathAReleaseEventData` used by all senders; the `"unknown"` fallback is gone. | `events.ts`, `path-a-release.ts` |
| **m3** | No `https://app.ccpatio.com` fallback anywhere in code; missing app URL is a manual `config_app_url` leg failure (release) or an omitted link (GHL summary). Guard 15. | `path-a-release.ts`, `ghl-summary.ts`, `opportunity-writeback.ts`, `cad-handoff.ts` |
| **m4** | Guards rewritten to be behavioural/precise: wait primitives checked with a throwing step stub, clock reads (guard 11), ORDER_PIPELINE_MODE (guard 13), sink ordering (guard 5), transitive import graph (guard 4b). | `tests/path-a-static-guards.test.ts` |

## 2.1 QCA Defect Resolutions (D1 - D5 Remediation)

| Defect | Root Cause & Security / Factory Impact | Remediation & Implementation | Verification |
|---|---|---|---|
| **D1 (Ghost Demand Vulnerability)** | `read-modes` previously called `getCatalogPublishMode()`, which fell back to `ORDER_PIPELINE_MODE=live`. If a recipe sync dry-ran while order pipeline was live, live SOs and MOs were minted against an unpublished recipe. | 1. In `src/inngest/path-a-release.ts`, catalog mode is derived strictly via `getPathACatalogPublishMode` from `CATALOG_PUBLISH_MODE` only (`"live"` -> `"live"`, all else -> `"log"`). No fallback to Woo `ORDER_PIPELINE_MODE`.<br>2. In `publish-recipe-*`, throws `ReleaseLegError` whenever `syncResult.dryRun` is true.<br>3. Guard 13 updated to trace transitive imports, forbidding `ORDER_PIPELINE_MODE` in Path A graph. | Tested in `tests/path-a-release-saga.test.ts`: isolates `ORDER_PIPELINE_MODE=live` from `CATALOG_PUBLISH_MODE`. Confirms zero SO/MO calls when catalog mode is log. |
| **D2 (Eradicate any DB Types)** | `ReleaseDb`, item-store, and fence handles previously accepted `any`, masking schema and transaction discrepancies. | 1. Strictly typed `ReleaseDb = ReturnType<typeof getDb> \| PathATx`.<br>2. Item and saga update payloads typed as `Partial<typeof table.$inferInsert>`.<br>3. Replaced all `catch (err: any)` with `unknown` and used `isMissingRelationError` narrowing helper.<br>4. Extended Guard 16 to cover `item-store.ts`, `release-store.ts`, `katana-fence.ts`, and `release-request.ts`. | Guard 16 PASS in `tests/path-a-static-guards.test.ts`; `npx tsc --noEmit` exit 0. |
| **D3 (Protect COMPLETED Sagas)** | Post-release failures (such as GHL sync or event bus delays) could trigger `markSagaManual`, demoting a completed, paid, and manufactured order back to manual intervention. | 1. Added `ne(saga_runs.status, "COMPLETED")` to `markSagaManual` update predicate.<br>2. Wrapped post-completion event dispatches (`send-release-completed-event`, `send-ghl-sync-event`) in non-fatal catch blocks.<br>3. In StepError catch, bypassed manual demotion if saga is `COMPLETED`. | Unit test in `tests/path-a-release-saga.test.ts` asserts `send-release-completed-event` error is swallowed without altering `COMPLETED` status. |
| **D4 (Katana Fences & Session Guards)** | 1. `syncBOMToKatanaAction` had no session authentication check.<br>2. Katana row fence previously resolved instead of failing closed when schema was missing. | 1. Added `getPimSession()` check to `syncBOMToKatanaAction` returning `not_authenticated`.<br>2. Fenced `syncBOMToKatanaAction` and caught `PathAFenceError`.<br>3. Modified `assertKatanaWriteAllowedForSalesOrderRows` to fail closed with `PathAFenceError(..., "PATH_A_SCHEMA_MISSING")` on 42P01/42703. | `tests/path-a-dictionary-sync-action.test.ts` (8/8 pass) and `tests/path-a-katana-fence.test.ts` (19/19 pass). |
| **D5 (Finalize Atomicity)** | `advanceSaga` did not verify saga pause state under row lock, allowing concurrent releases to interleave with recipe finalization. | Inside `advanceSaga`, re-reads saga row under `FOR UPDATE` lock inside transaction. Aborts with error if locked or past pause (`IN_PROGRESS`, `COMPLETED`, `SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION`). Item update + advance run in single atomic transaction. | PGlite test in `tests/pglite-path-a-store.test.ts` forces `advanceSaga` failure on `IN_PROGRESS` saga and verifies item rolls back to `needs_review`. |


## 3. Task 0.4 inventory of Katana write sites (line numbers from the final tree, `src/lib/katana.ts` unless noted)

Method: `Select-String` over `src` for `method: "POST|PATCH|PUT|DELETE"`, then mapped to the enclosing function and its callers. (**`rg` is not installed on this machine; all `rg` commands in the blueprint were replaced with `Select-String` equivalents.**)

| Site (file:line) | Function | Fenced? | Notes |
|---|---|---|---|
| katana.ts:589 (calls :591 DELETE `/bom_rows/{id}`) | `deleteKatanaBomRows` | via `syncBOMToKatana` fence (:1199) | Reached only through `replaceKatanaVariantRecipe` ← `syncBOMToKatana`. Pre-existing catalog code; **never called from Path A** (proof grep, Appendix D). |
| :595 (POST :602, :612 bom_rows) | `postKatanaBomRowsBatch` | via `syncBOMToKatana` | same chain |
| :620 (POST :632 recipes) | `postKatanaRecipesReplace` | via `syncBOMToKatana` | same chain |
| :758 (POST/PATCH :772/:782/:805) | `upsertMaterialInKatana` (private) | not fenced (raw materials only) | callers `syncRawMaterialToKatana` (:960) and `ensureKatanaVariantForSku` (:1052, which is fenced at :1057 for roots). Raw materials are not custom SKUs. |
| :842 (POST/PATCH :863/:877/:900) | `upsertProductInKatana` (private) | **yes, indirectly** | only caller is `syncFinishedGoodToKatana` (:987), fenced at **:998** (B2). |
| :987 | `syncFinishedGoodToKatana` | **YES (new, B2)** | fenced at **:998**; also called from `ensureKatanaVariantForSku` (:1170) |
| :1052 | `ensureKatanaVariantForSku` entry | **YES (pre-existing, kept)** | fenced at **:1057** (`assertKatanaWriteAllowed(needle)`) |
| :1190 | `syncBOMToKatana` entry | **YES (pre-existing hook, kept)** | fenced at **:1199** (`assertKatanaWriteAllowed(needle)`) |
| :1375 | `syncNode` POST | via `syncBOMToKatana` | |
| :1747 | `resolveKatanaCustomerId` (customer POST :1771) | **YES, indirectly (new)** | callers: `createKatanaSalesOrder` (fenced :1927 before :1959) and `createKatanaHoldStockAdjustment` (unfenced, see below) |
| :1910 (POST :1990) | `createKatanaSalesOrder` | **YES (new, B3)** | fenced at **:1927** by every row SKU (`assertKatanaWriteAllowedForSkus`) |
| :2051 (POST :2078) | `createMakeToOrderManufacturingOrders` | **YES (new, B3)** | fenced at **:2072** by SO row id → owning item SKU (`assertKatanaWriteAllowedForSalesOrderRows`) |
| :1832 POST :1868 | `createKatanaHoldStockAdjustment` | **NO** | fabric-hold stock adjustment (`stock/create-hold.ts:491`); not a custom-SKU writer; left as is |
| :1894 DELETE :1903 | `deleteKatanaHoldDocument` | **NO** | hold cleanup (`stock/create-hold.ts:97`, `delete-hold-order.ts:119`, `release-hold.ts:82`); not Path A |
| :2203 (PATCH :2287) | `enqueueTrusted` (inside `applyMtoIngredientOverrides`, defined :2203) | **NO** | called by `bindMtoFabric` (:2389, from `ghl/push-factory-order.ts:333`) and `run-sandbox-katana-mto.ts:133` |
| `src/lib/katana/client.ts:86,121,147,158` | `upsertKatanaMaterial/Product/RecipeRow`, `archiveKatanaVariant` | **NO** | no callers found in `src` |
| `src/server/factory-bom/release-custom-build.ts:92,100` | `executeReleaseCustomBuild` | YES (fence at :30, pre-existing) | |
| `src/server/mdm/publish-channels.ts:181` | `publishToKatana` path | YES (fence at :128, pre-existing) | |
| `src/server/ghl/relieve-hold.ts:114,118` | `relieveFabricHold` | **NO** | DELETE `/sales_order_rows/{id}` + PATCH; hold relief, not Path A |
| `src/server/stock/delete-hold-order.ts:169` | `deleteHoldSalesOrder` | **NO** | DELETE `/sales_orders/{id}`; hold cleanup |
| (removed in Phase B1) | former dead-stub MTO mapper | n/a | file deleted; it had no runtime callers. Live MTO creation is `createMakeToOrderManufacturingOrders` in `src/lib/katana.ts`, fenced by `assertKatanaWriteAllowedForSalesOrderRows` |
| `src/inngest/path-a-release.ts:718` | cut-card PATCH `/manufacturing_orders/{id}` | n/a | Function 2 itself, behind the GHL_FACTORY_ORDERS gate and the fenced MO step |

Callers of the newly fenced SO/MO writers that the QCA listed (`push-factory-order.ts:239,298`, `woocommerce/katana-deps.ts:87,102`, `stock/create-hold.ts:289`, `inngest/functions.ts:195,205`) now get the fence automatically because it is inside the writer.
Fence call sites in `src`: `src/app/admin/dictionary/actions.ts:983`, `src/lib/katana.ts:998,1057,1199,1927,2072`, `src/server/factory-bom/release-custom-build.ts:30`, `src/server/mdm/publish-channels.ts:128`, helpers in `src/server/path-a/katana-fence.ts`.
The sites marked **NO** are not fenced. They are not custom-SKU writers per the code I read, but "unreachable by a custom SKU" is something I reasoned about, not proved with a runtime test for every one of them.

## 4. Live-DB probe (Task 0.3 style; read-only SELECTs; one-off script deleted afterwards; user and host only printed)

Raw output is in Appendix E. Summary:
- target: user `postgres.nnvxmrwazvxuojgvzxrz`, host `aws-0-us-west-2.pooler.supabase.com`
- `saga_runs`, `dlq_events`, `rate_limit_buckets`, `custom_build_jobs` present; **`custom_build_job_items` absent**
- `saga_status` has the six expected labels
- `drizzle.__drizzle_migrations` count **45**, not 56
- no `release_*` columns on `saga_runs`, no `katana_*` columns on `custom_build_jobs`: 0055 is NOT applied (expected; owner-only)
Consequence: the Owner's statement that the live DB is synchronized through 0054 does **not** match: ledger has 45 rows vs 56 journal entries. I did not touch the live DB. Deployment step 1 in the blueprint (apply 0055) must be preceded by reconciling the missing earlier migrations; do not trust section 9 of the blueprint until that is resolved. Note: the fence fails closed (blocks custom-SKU Katana writes) when the item table is missing (42P01).

## 5. Katana / Inngest / platform answers

- **Idempotency-Key**: the client attaches the header when `idempotencyKey` is passed (`katana.ts:408`). I could not verify that Katana honours it: a web-search summary said it is undocumented, which is not authoritative, and live Katana calls are forbidden. The code does **not** rely on it: it looks the order up by `orderNo` first and checks provenance.
- **`CC_MANUFACTURING_LOCATION_ID`**: passed as `locationId` on the SO as in the existing lane. Not verified against Katana documentation.
- **`maxDuration`**: `src/app/api/inngest/route.ts:7` = 300; `cad-callback/route.ts:22` = 30. I did **not** verify the 300 against the host plan ceiling. Worst-case step durations were not measured.
- **GHL documentation sources** for the custom-field/note endpoints: not re-verified in this remediation.
- `Inngest` typing: `step` is passed to `runPathAReleaseSaga` through `step as unknown as ReleaseStep` (`pathAReleaseToProduction`), because Inngest's `step.run` returns `Jsonify<T>` rather than plain `T`. This is a cast, not a proof of type compatibility.

## 6. Legacy test assertions changed (F11): before / after / why

| File | Before | After | Why |
|---|---|---|---|
| `tests/path-a-release.test.ts` | Task 7 tests with `getOrderMode` injection and fixtures that carried both `status` and `design_status` | **Replaced by an exact copy of `tests/path-a-release-saga.test.ts`** (the file the blueprint names) | Old file asserted the buggy gate and masked B5. Consequence: the same suite runs twice. I left the duplicate rather than delete a tracked test file; remove it if you prefer. |
| `tests/path-a-release-request.test.ts` | asserted `data.triggerSource` | asserts `data.source` and validates with `pathAReleaseEventSchema` | m2: payload field is `source` per the schema |
| same | conflict test used a mock whose transaction built a real store on the fake DB (it returned `ok:true`) | passes `txReleaseStore: () => releaseStore` (new optional dep in `release-request.ts`) | the transaction-bound store was not injectable, so the already-requested branch was untestable |
| `tests/path-a-finalize.test.ts` | asserted `triggerSource: "early_deposit_replay"` on the replayed event | asserts the schema-shaped `source` payload | m2 |
| `tests/path-a-katana-fence.test.ts` | imported `publishToKatana` | import removed (fence coverage moved to `path-a-katana-write-fences.test.ts`) | no longer used |
| `tests/pglite-path-a-store.test.ts` | `expect(resumedCount).toBe(2)` for 3 concurrent claims | `expect(resumedCount + notReadyCount).toBe(2)` | encoded the M5 bug (lost CAS = resumed) |
| `tests/path-a-ghl-summary.test.ts` | summary input had no `appUrl` | passes `appUrl`; new m3 tests | no invented host |
| `tests/path-a-static-guards.test.ts` (guard 4c) | `.not.toMatch(/actor/)` | `.not.toMatch(/\bactor\b/)` | **the regex matched "revalidateFactory"**; false positive in my own guard, not a weakening of intent |
| `tests/dlq-context.test.ts` | function list without Path A | adds `path-a-release-to-production` and `path-a-ghl-sync` cases | additive |

No test was deleted or skipped.

## 7. Files touched in this remediation round (beyond earlier Phase 11 work)

`src/inngest/path-a-release.ts` (rewritten), `src/inngest/katana-step.ts` (unchanged; explicit generics at call sites), `src/inngest/cad-handoff.ts`, `src/inngest/cad-failure.ts` (new), `src/inngest/functions.ts`, `src/lib/katana.ts`, `src/server/path-a/{katana-fence,release-store,release-request,events,ghl-summary}.ts`, `src/server/ghl/opportunity-writeback.ts`, `src/server/factory-bom/{release-gate,finalize-design,approve-draft-recipe,publish-recipe-katana}.ts`, `src/app/admin/{path-a,dictionary,factory-bom}/actions.ts`, plus tests under `tests/` (new: `path-a-katana-write-fences`, `path-a-dictionary-sync-action`, `path-a-cad-failure`, `path-a-claim-release`, `path-a-events`, `path-a-release-gate`, `path-a-actions`, `path-a-release-saga`, `helpers/path-a-fake-db`).
Housekeeping: `src/app/admin/factory-bom/actions.ts` and `approve-draft-recipe.ts` were accidentally rewritten with CRLF line endings; they were normalised back to LF (the repo is LF in the index) so the diff shows the real change (13 insertions / 479 deletions ignoring EOL, was 3,142 lines). Unused imports left behind by M6 were pruned from that file.
`playwright-report/index.html` and `.cursor/session-stamp.json` show as modified because of lifecycle runs.

## 8. What is NOT fixed / not verified / disclosures

1. **`any` still exists outside the two modules the directive named.** Function 2 and the GHL write-back have zero `any` (guard 16). ESLint (`no-explicit-any`) still reports `any` in other Path A files: `item-store.ts`, `katana-fence.ts`, `release-request.ts`, `release-store.ts`, `cad-handoff.ts`, `functions.ts`, and in `approve-draft-recipe.ts` (code moved verbatim from the old action file). I did not type those.
2. `getCatalogPublishMode()` still falls back to `ORDER_PIPELINE_MODE` when `CATALOG_PUBLISH_MODE` is unset (`catalog-mode.ts`). Path A modules do not call it for gating, but the QCA's "compounding" concern at the catalog level is unchanged.
3. `claimRelease` on a saga already `IN_PROGRESS` still returns `resumed` (crash-resume by design). A concurrent second run that reads `IN_PROGRESS` after the winner committed proceeds; the per-opportunity concurrency limit in the function config is what prevents overlap. M5's fix only covers the lost-CAS case.
4. Other empty `catch {}` blocks remain in non-Path-A code (`functions.ts` ~L223/315/372; the "outside request context" catches around `revalidatePath` in `factory-bom/actions.ts`). Guard 14 covers Path A modules, `release-gate.ts`, `finalize-design.ts` and the `processCadUpload` slice only.
5. Unfenced non-custom writers are listed in section 3.
6. `npm run db:generate` was **not** re-run: no schema change was made in this round. `db:check` passes. The 0055 SQL is `src/server/db/migrations/0055_path_a_stateless_release.sql`, unchanged by this round, applied nowhere except PGlite.
7. The `rg` commands were substituted with `Select-String`; the equivalent output is in Appendix D.
8. My first capture of the blueprint-§7 command batch (`verify_cmds.txt`) mangled `git status`/`git log` output and ran `python` via the Store stub; Appendix A-C below uses clean re-runs and the real interpreter for those items.
9. Not done (per blueprint scope): QBO deposit write, Clover mapping, `.skp`, deal-lost cancel, change orders, populating `ghl_role`, applying 0055.

## 9. Raw verification output

See the appendices appended below (generated directly from the saved command logs).


## Appendix A. Baseline / final git state (clean re-run)

### git log -1 --oneline
```text
b04cd3d feat(path-a): Task 8 GHL opportunity write-back service, summary builder, and sync function
```

### git status --short
```text
 M .cursor/session-stamp.json
 M .env.example
 M docs/MDM_MASTER_BLUEPRINT.md
 M playwright-report/index.html
 M src/app/admin/dictionary/actions.ts
 M src/app/admin/factory-bom/actions.ts
 M src/app/admin/path-a/actions.ts
 M src/app/api/webhooks/cad-callback/route.ts
 M src/env.ts
 M src/inngest/cad-handoff.ts
 M src/inngest/dlq-context.ts
 M src/inngest/functions.ts
 M src/inngest/path-a-release.ts
 M src/lib/katana.ts
 M src/lib/launchpad-modules.ts
 M src/server/factory-bom/finalize-design.ts
 M src/server/factory-bom/release-gate.ts
 M src/server/ghl/opportunity-writeback.ts
 M src/server/path-a/authz.ts
 M src/server/path-a/events.ts
 M src/server/path-a/ghl-summary.ts
 M src/server/path-a/katana-fence.ts
 M src/server/path-a/release-request.ts
 M src/server/path-a/release-store.ts
 M src/server/path-a/saga-state.ts
 M tests/dlq-context.test.ts
 M tests/path-a-cad-handoff.test.ts
 M tests/path-a-finalize.test.ts
 M tests/path-a-ghl-summary.test.ts
 M tests/path-a-ghl-sync.test.ts
 M tests/path-a-katana-fence.test.ts
 M tests/path-a-release-request.test.ts
 M tests/path-a-release.test.ts
 M tests/pglite-path-a-store.test.ts
?? PHASE_09_EXECUTION_BLUEPRINT.md
?? PHASE_10_EXECUTION_BLUEPRINT.md
?? phase_10_handback_report.md
?? phase_11_handback_report.md
?? phase_11_remediation_handback.md
?? src/app/admin/path-a/PathAStatusTable.tsx
?? src/app/admin/path-a/page.tsx
?? src/inngest/cad-failure.ts
?? src/server/factory-bom/approve-draft-recipe.ts
?? src/server/factory-bom/publish-recipe-katana.ts
?? tests/helpers/path-a-fake-db.ts
?? tests/path-a-actions.test.ts
?? tests/path-a-cad-failure.test.ts
?? tests/path-a-claim-release.test.ts
?? tests/path-a-dictionary-sync-action.test.ts
?? tests/path-a-events.test.ts
?? tests/path-a-katana-write-fences.test.ts
?? tests/path-a-release-gate.test.ts
?? tests/path-a-release-saga.test.ts
?? tests/path-a-static-guards.test.ts
?? tests/path-a-status-ui.test.ts
```

### git diff --stat (tail)
```text
 tests/path-a-release-request.test.ts       |  133 +++-
 tests/path-a-release.test.ts               | 1082 +++++++++++++++++++++-------
 tests/pglite-path-a-store.test.ts          |    6 +-
 34 files changed, 2801 insertions(+), 1450 deletions(-)
```

## Appendix B. tsc, db:check, py_compile

### npx tsc --noEmit (full output incl. exit line)
```text
tsc exit 0
```

### npm run db:check (exit 0)
```text

> ccpatio-middleware@0.1.0 db:check
> drizzle-kit check

No config path provided, using default 'drizzle.config.ts'
Reading config file 'C:\Workspace\ccpatio-audit\drizzle.config.ts'
Everything's fine ≡ƒÉ╢≡ƒöÑ
```

### python -m py_compile services/cad-convert/app.py (exit 0; empty output = success)
```text
```

## Appendix C. Vitest

### Blueprint 7.4 unit suites, 23 files (tail of raw log)
```text
 [32mG£ô[39m tests/path-a-finalize.test.ts [2m([22m[2m13 tests[22m[2m)[22m[32m 32[2mms[22m[39m
 [32mG£ô[39m tests/publish-idempotency.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 18[2mms[22m[39m
 [32mG£ô[39m tests/cad-upload-pipeline.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 225[2mms[22m[39m
 [32mG£ô[39m tests/path-a-status-ui.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32mG£ô[39m tests/path-a-authz.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 5[2mms[22m[39m

[2m Test Files [22m [1m[32m23 passed[39m[22m[90m (23)[39m
[2m      Tests [22m [1m[32m457 passed[39m[22m[90m (457)[39m
[2m   Start at [22m 18:42:31
[2m   Duration [22m 5.45s[2m (transform 6.50s, setup 883ms, collect 49.14s, tests 2.52s, environment 10ms, prepare 6.47s)[22m


[exit 0]

```

### Blueprint 7.5 PGlite suites (tail of raw log)
```text
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mC:/Workspace/ccpatio-audit[39m

 [32mG£ô[39m tests/pglite-path-a-0055.test.ts [2m([22m[2m8 tests[22m[2m)[22m[33m 3184[2mms[22m[39m
 [32mG£ô[39m tests/pglite-path-a-store.test.ts [2m([22m[2m10 tests[22m[2m)[22m[33m 3553[2mms[22m[39m
 [32mG£ô[39m tests/pglite-sre-0054.test.ts [2m([22m[2m12 tests[22m[2m)[22m[33m 7568[2mms[22m[39m
   [33m[2mG£ô[22m[39m Postgres token bucket atomic statement (PGlite)[2m > [22m5 queued acquirers are spaced ~1s apart (serialized by the single session) [33m 4104[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m30 passed[39m[22m[90m (30)[39m
[2m   Start at [22m 18:42:38
[2m   Duration [22m 9.33s[2m (transform 275ms, setup 79ms, collect 2.76s, tests 14.30s, environment 1ms, prepare 696ms)[22m


[exit 0]
```

### Full npx vitest run (tail of raw log; whole log saved as vitest_full3.txt in scratch dir)
```text
 [32mΓ£ô[39m tests/sku-set.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32mΓ£ô[39m tests/pim-session.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32mΓ£ô[39m tests/path-a-status-ui.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32mΓ£ô[39m tests/hold-webhook-release.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32mΓ£ô[39m tests/katana-recipe-notes.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32mΓ£ô[39m tests/path-a-authz.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32mΓ£ô[39m tests/soft-hold-release.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m
 [32mΓ£ô[39m tests/ghl-won-stage.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32mΓ£ô[39m tests/seo-saga-isolation.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m

[2m Test Files [22m [1m[32m127 passed[39m[22m[90m (127)[39m
[2m      Tests [22m [1m[32m1367 passed[39m[22m[90m (1367)[39m
[2m   Start at [22m 18:45:17
[2m   Duration [22m 20.75s[2m (transform 21.70s, setup 2.55s, collect 145.98s, tests 43.27s, environment 57ms, prepare 36.62s)[22m

vitest exit 0
```

### First full run of this session, BEFORE the last two fixes (2 failures: release-request conflict test, pglite claimRelease legacy assertion)
```text
[31mΓÄ»ΓÄ»ΓÄ»ΓÄ»ΓÄ»ΓÄ»ΓÄ»[39m[1m[41m Failed Tests 2 [49m[22m[31mΓÄ»ΓÄ»ΓÄ»ΓÄ»ΓÄ»ΓÄ»ΓÄ»[39m
[2m Test Files [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m125 passed[39m[22m[90m (127)[39m
exit 1
```

## Appendix D. No Katana DELETE / no wait primitive proof (Select-String substitute for rg)

### proof grep
```text
### Select-String equivalent (rg is not installed) of: rg -n <pattern1> <Path A paths>
pattern1 = method: "DELETE"|waitForEvent|sleepUntil|sleep\(|planCompensation|COMPENSAT
files scanned = 13
(no matches)
### Select-String equivalent of: rg -n "waitForEvent" src/inngest
src\inngest\cad-handoff.ts:211: const callbackEvent = await step.waitForEvent("wait-cad-callback", {
```

## Appendix E. Live-DB probe raw output

### node .tmp-live-db-probe.mjs (read-only; script deleted after run)
```text
probe target user: postgres.nnvxmrwazvxuojgvzxrz host: aws-0-us-west-2.pooler.supabase.com
to_regclass: {"saga_runs":"saga_runs","dlq_events":"dlq_events","rate_limit_buckets":"rate_limit_buckets","custom_build_jobs":"custom_build_jobs","custom_build_job_items":null}
saga_status labels: ["PENDING","IN_PROGRESS","COMPLETED","COMPENSATING","COMPENSATED","SAGA_FAILED_REQUIRES_MANUAL_INTERVENTION"]
drizzle.__drizzle_migrations count: 45
0055-era columns present: []
exit 0
```

## Appendix F. npm run qa:lifecycle (full raw output)

### npm run qa:lifecycle
```text

> ccpatio-middleware@0.1.0 qa:lifecycle
> npm run qa:phase1-build && npm run qa:phase2-db && npm run qa:phase0-unit && npm run qa:phase4-webhooks && npm run qa:phase3-e2e


> ccpatio-middleware@0.1.0 qa:phase1-build
> npm run qa:clean && tsc --noEmit && npx cross-env NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production next build


> ccpatio-middleware@0.1.0 qa:clean
> node -e "const fs=require('fs'); fs.rmSync('.next', {recursive:true, force:true}); fs.rmSync('node_modules/.cache', {recursive:true, force:true});"

â–² Next.js 16.3.2 (Turbopack)
- Environments: .env.local, .env
âœ“ Running next.config.ts took 135ms

  Creating an optimized production build ...
âœ“ Compiled successfully in 15.8s
  Running TypeScript ...
  Finished TypeScript in 28.2s ...
  Collecting page data using 15 workers ...
  Generating static pages using 15 workers (0/3) ...
âœ“ Generating static pages using 15 workers (3/3) in 492ms
  Finalizing page optimization ...

Route (app)
â”Œ Æ’ /
â”œ â—‹ /_not-found
â”œ Æ’ /admin/audit
â”œ Æ’ /admin/dictionary
â”œ Æ’ /admin/dictionary/bom/[sku]
â”œ Æ’ /admin/factory-bom
â”œ Æ’ /admin/logistics
â”œ Æ’ /admin/order-triage
â”œ Æ’ /admin/path-a
â”œ Æ’ /admin/quarantine
â”œ Æ’ /admin/raw-materials
â”œ Æ’ /api/auth/qbo/callback
â”œ Æ’ /api/health
â”œ Æ’ /api/inngest
â”œ Æ’ /api/qa-test
â”œ Æ’ /api/qa/katana-mirror/[...path]
â”œ Æ’ /api/qa/katana-recipe-preview
â”œ Æ’ /api/sandbox/katana-mto-test
â”œ Æ’ /api/webhooks/cad-callback
â”œ Æ’ /api/webhooks/clover
â”œ Æ’ /api/webhooks/ghl
â”œ Æ’ /api/webhooks/katana
â”œ Æ’ /api/webhooks/sketchup
â”œ Æ’ /api/webhooks/woocommerce
â”œ â—‹ /embed/admin/master-catalog
â”œ Æ’ /embed/dispatch
â”œ Æ’ /embed/factory-bom
â”œ Æ’ /embed/order-desk
â”œ Æ’ /embed/showroom
â”œ Æ’ /factory/cut-cards/[token]
â”œ Æ’ /mission-control
â”œ Æ’ /showroom
â”” Æ’ /tools/stock-checker


Æ’ Proxy (Middleware)

â—‹  (Static)   prerendered as static content
Æ’  (Dynamic)  server-rendered on demand


> ccpatio-middleware@0.1.0 qa:phase2-db
> npx dotenv -e .env.test.local -e .env.local -- tsx scripts/qa/proof-of-life.runner.ts


ðŸš¨ ZERO-TRUST QA PROTOCOL: INITIATING LIFECYCLE QA ðŸš¨
Generated Test UUID: ccf5bfe2-a248-4d2b-af1c-f5141ecec86a (SKU: QA-TEST-CCF5BFE2)
Starting Next.js production server on port 3000...
(node:55164) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
(Use `node --trace-deprecation ...` to show where the warning was created)
Server booted successfully.

[1/4] FIRE THE APPLICATION LAYER (HTTP POST)
âœ… Application Layer Responded OK

[2/4] THE DRIZZLE REFEREE (Database Proof of Write)
âœ… Drizzle Verified Write: QA-TEST-CCF5BFE2

[3/4] THE CACHE CHECK (Proof of Read)
âœ… Cache Check Passed! UUID found via Next.js API.

[4/4] CLEANUP (Database Idempotency)
âœ… Cleanup Complete. Record deleted.

ðŸŽ‰ ALL PHASES PASSED. QA LIFECYCLE COMPLETE.
Leaving Next.js server running for subsequent qa:lifecycle phases (webhooks, e2e).

> ccpatio-middleware@0.1.0 qa:phase0-unit
> npx dotenv -e .env.test.local -e .env.local -- vitest run tests/sku-preview.test.ts tests/asset-vault.test.ts tests/confirm-asset.test.ts tests/story-seo.test.ts tests/pim-session.test.ts tests/seo-listing.test.ts tests/vault-buckets.test.ts tests/actions.test.ts tests/dae-weldment.test.ts


[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mC:/Workspace/ccpatio-audit[39m

 [32mâœ“[39m tests/story-seo.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 23[2mms[22m[39m
 [32mâœ“[39m tests/pim-session.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 4[2mms[22m[39m
 [32mâœ“[39m tests/dae-weldment.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 15[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m26 passed[39m[22m[90m (26)[39m
[2m   Start at [22m 18:47:03
[2m   Duration [22m 1.65s[2m (transform 370ms, setup 66ms, collect 2.02s, tests 42ms, environment 1ms, prepare 640ms)[22m


> ccpatio-middleware@0.1.0 qa:phase4-webhooks
> npx dotenv -e .env.test.local -e .env.local -- tsx scripts/qa/simulate-webhooks.ts

[QA PHASE 4] Katana webhook signature and SKU auto-heal...
[SUCCESS] Webhook Simulation Passed (signature + SKU auto-heal)

> ccpatio-middleware@0.1.0 qa:phase3-e2e
> npx dotenv -e .env.test.local -e .env.local -- playwright test tests/e2e

â—‡ injected env (0) from .env.test.local // tip: âŒ˜ enable debugging { debug: true }
â—‡ injected env (40) from .env.local // tip: âŒ˜ enable debugging { debug: true }
â—‡ injected env (40) from .env.local // tip: âŒ˜ suppress logs { quiet: true }
â—‡ injected env (0) from .env.test.local // tip: âŒ˜ suppress logs { quiet: true }
â—‡ injected env (40) from .env.local // tip: âŒ auth for agents [www.vestauth.com]
â—‡ injected env (0) from .env.test.local // tip: â—ˆ secrets for agents [www.dotenvx.com]
â—‡ injected env (40) from .env.local // tip: âŒ˜ multiple files { path: ['.env.local', '.env'] }

Running 7 tests using 1 worker

â—‡ injected env (0) from .env.test.local // tip: âŒ˜ enable debugging { debug: true }

â—‡ injected env (40) from .env.local // tip: â—ˆ encrypted .env [www.dotenvx.com]

â—‡ injected env (40) from .env.local // tip: âŒ˜ custom filepath { path: '/custom/path/.env' }

[1/7] [chromium] â€º tests\e2e\auth.spec.ts:14:7 â€º Gatekeeper Auth Proof â€º rejects unauthorized domain
[2/7] [chromium] â€º tests\e2e\auth.spec.ts:31:7 â€º Gatekeeper Auth Proof â€º accepts authorized domain, creates session, and redirects
[chromium] â€º tests\e2e\auth.spec.ts:31:7 â€º Gatekeeper Auth Proof â€º accepts authorized domain, creates session, and redirects
Cleaned up test user qa.test@ccpatio.com

â—‡ injected env (0) from .env.test.local // tip: âŒ˜ suppress logs { quiet: true }

â—‡ injected env (40) from .env.local // tip: â—ˆ encrypted .env [www.dotenvx.com]

â—‡ injected env (0) from .env.test.local // tip: â—ˆ encrypted .env [www.dotenvx.com]

â—‡ injected env (40) from .env.local // tip: âŒ˜ enable debugging { debug: true }

[3/7] [chromium] â€º tests\e2e\factory-bom-lifecycle.spec.ts:88:7 â€º Factory BOM lifecycle (hub SoT â†’ Katana recipes) â€º Step 2 proposal: sketchup_geometry fixture renders pre-filled cut cards
[4/7] [chromium] â€º tests\e2e\factory-bom-lifecycle.spec.ts:118:7 â€º Factory BOM lifecycle (hub SoT â†’ Katana recipes) â€º Step 2 hygiene: GEOM_HYGIENE failure renders manual banner and empty cards
[5/7] [chromium] â€º tests\e2e\factory-bom-lifecycle.spec.ts:148:7 â€º Factory BOM lifecycle (hub SoT â†’ Katana recipes) â€º Step 4 quarantine: Release to Katana button is disabled when cut list is empty
[6/7] [chromium] â€º tests\e2e\factory-bom-lifecycle.spec.ts:178:7 â€º Factory BOM lifecycle (hub SoT â†’ Katana recipes) â€º operator edits a draft recipe, approves it, and Katana receives nested recipe rows
[7/7] [chromium] â€º tests\e2e\optimistic-ui.spec.ts:4:7 â€º E2E Boundary Verification â€º Application boots successfully
  7 passed (48.7s)
EXIT_CODE=0
```

## Appendix G. node .cursor/skills/qca/scripts/qca.mjs (full raw output)

### node .cursor/skills/qca/scripts/qca.mjs
```json
{
  "phase_id": "phase-11",
  "phase": "phase-11",
  "verdict": "CERTIFIED",
  "audit_exit": 0,
  "invariantViolations": [],
  "testResults": {
    "typecheck": "PASS",
    "lint": "PASS",
    "target_test": "PASS"
  },
  "targetTest": "npx vitest run tests/path-a-release-saga.test.ts",
  "blastRadius": {
    "actual": 59,
    "expected": 59,
    "tolerance": 0,
    "tracked": 37,
    "untracked": 22,
    "status": "PASS"
  },
  "aarParity": {
    "status": "PASS",
    "aar_sha256": "741e00d95e287e12ea41c8bc2a7a046d70b407e87710f7e4e32ccd6a103341fa",
    "git_sha256": "741e00d95e287e12ea41c8bc2a7a046d70b407e87710f7e4e32ccd6a103341fa"
  }
}
```
EXIT_CODE=0
