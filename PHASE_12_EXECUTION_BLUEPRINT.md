# EXECUTION BLUEPRINT: PHASE 12 — HUMAN-CENTRIC INTAKE (GHL EMBED `/embed/factory-bom`)
Source of truth: Operator decisions of 2026-10-14 (Section 0.1), the Architect's discovery audit of the same date, `CLAUDE.md` "Binding source of truth" amendment (2026-10-12), `docs/MDM_MASTER_BLUEPRINT.md` (factory lane §2.4), and the Phase 11 Path A contract (`custom_build_jobs` 1:1 with a GHL opportunity, `custom_build_job_items` 1:N pieces).
Workflow: Agile Triad. The Architect wrote this blueprint, the Builder implements it, QC verifies against the suites below plus a semantic review of `git diff`. `.cursor/phase.lock` and `qca.mjs` are ACTIVE (`triad-kernel.mdc`). Do not recreate, edit by hand, or work around them (Task 0 explains the lock).
Scope in one line: make the CAD / Factory BOM intake usable by drafters, designers, sales reps and admin assistants who have never heard of a "slug", by (P0) fixing three defects that make today's intake impossible to finish, and (P1) replacing the entry flow with a 3-screen wizard that captures the 3D model AND the factory-order PDF, prefills everything the system already knows, and generates codes behind the scenes.

---

## 0. WHAT THIS PHASE IS AND IS NOT

### 0.1 Operator decisions (binding, do not re-litigate)
| # | Decision | Where it lands |
|---|---|---|
| OD1 | **Collisions.** If a catalog piece collides on collection + product type + dimensions, append a variation discriminator (`-V2`, `-V3`, …). Offer **"Update existing 3D model"** versus **"This is different"**. | Task 7, Task 10 |
| OD2 | **Preview (hybrid toggle).** Default is a lightweight metadata card. For `.glb` only, show a sleek toggle that lazy-loads a WebGL viewer built on React Three Fiber. For `.blend` and `.skp` (and, by assumption A4, `.dae`) hide the toggle entirely and show metadata only. | Task 5, Task 10 |
| OD3 | **Finishes (Frame, Powdercoat, Fabric) are REQUIRED at intake for Client Projects.** Custom orders are uploaded after the purchase is final. A "TBD / Pending" option exists only as a workaround for rare incomplete handoffs. | Task 7, Task 10, Task 11 |
| OD4 | **PDF packet lane is not parked.** The wizard must explicitly accept and securely store the `.pdf` factory order alongside the 3D model. A later middleware step will use AI to parse it into cut files and build sheets. | Task 8, Task 10 |
| OD5 | **Attribution** uses the `ghlUserEmail` URL parameter for the audit trail. | Task 4, Task 7 |
| OD6 | **Phase 12: Human-Centric Intake.** P0 (hotfixes D1/D2/D3) and P1 (wizard, PDF capture, 3D toggle, background endpoints) ship under one blueprint, in one phase lock, as separate commits. | Section 2 |
| OD7 | **GHL data.** The mock opportunity response exposes `name`, `monetaryValue` and `contactName`. | Task 6 |
| OD8 | **Design system:** the existing "Soft UI with floating cards and animated gold beams". | Task 10, Appendix C |
| OD9 | Strip every developer term ("Airlock", "Mint", "Slug", "Quarantine", and the rest of Appendix B) from the embed UI. | Task 4, Task 11, Appendix B |
| OD10 | Server Actions and Route Handlers must be correctly scoped to `/embed` for authentication. | Task 9 |

### 0.2 Explicitly NOT in this phase (do not start)
- Any Katana, WooCommerce, Clover, QBO or Resend call. Intake makes **zero** calls to any of them. GHL is **read-only** here.
- AI parsing of the PDF. Phase 12 captures and stores the PDF only. The parsing middleware is a later phase (the stored-object contract in Task 8 is what it will consume). Do not send the PDF to any model or third party.
- The server-side readiness refactor of Steps 2–4 (running `evaluateAirlock` on the server). Steps 2–4 get copy, naming, lazy loading and the finishes/packet gates only.
- Other embeds (`order-desk`, `dispatch`, `showroom`, `admin/master-catalog`). Their lexicon is Phase 13.
- Pipeline-stage chips and "recent opportunities" in the picker (only `name`, `monetaryValue`, `contactName` and the id are confirmed).
- Admin (`/admin/**`) page copy.
- New tables or columns. **This phase needs NO migration.** If you believe you need one, STOP and ask QC.
- Verifying `ghlUserEmail` against GHL users (it is labeled unverified; see Task 4).

### 0.3 Assumptions QC must confirm in the handback (A1–A11)
| # | Assumption | Basis |
|---|---|---|
| A1 | Frame = `MET-*`, Powdercoat = `PWD-*`, Fabric = `FAB-*` SKUs in `sku_mappings`, names from `raw_materials_catalog`. | The locked prefix map in `MATERIAL_RULES` (`src/server/woocommerce/ingress.schema.ts`) and `HUB_RAW_MATERIAL_PREFIXES` (`src/lib/raw-material-sku.ts`). |
| A2 | The factory-order PDF is **required** for a Client Project unless that project already has a packet on file. On the catalog path a PDF is optional and stored as `shop_drawing`. | OD4 calls the PDF "critical". Required-ness is inferred. |
| A3 | `PACKET_MAX_BYTES` = 25 MiB (same as `KIND_POLICY` and `CAD_MAX_BYTES`). | Consistency. One constant, easy to raise. |
| A4 | `.dae` shows metadata only (no 3D toggle). `.skp` alone is NOT valid geometry (thumbnail only). `.skp` plus `.glb` is fine. | OD2 lists only `.glb` for the toggle. The existing pipeline treats `.skp` as thumbnail-only. |
| A5 | A missing or invalid `ghlUserEmail` does not block intake. It records `ghl-embed@ccpatio.com` and flags the record unattributed. | Avoids locking out reps whose menu link lacks the parameter. |
| A6 | Opportunity statuses `open` and `won` are accepted. `lost` and `abandoned` are rejected. | Same rule as `fetchHoldOpportunity`. |
| A7 | The mock response includes the opportunity `id`. | The id is the 1:1 binding key. **If the mock has no id, STOP.** |
| A8 | "Update existing 3D model" is safe only if a re-upload writes draft tables (`product_bom_draft`, `item_operations_draft`) and never live `product_bom`. | Builder verifies in `processCadUpload`. If unproven, block the option for any SKU with a live BOM. |
| A9 | The Builder picks three.js / R3F / drei versions after `npm view` peer checks against React 19.2.8. QC approves the dependency addition. | `package.json` has no three.js today. |
| A10 | TBD finishes are allowed with a mandatory note. A TBD finish blocks "Mark design complete" until resolved. | OD3. |
| A11 | The Operator supplies the mock response at `tests/fixtures/ghl-opportunity-search.mock.json`. | OD7. |

---

## 1. HARD GUARDRAILS (violating any = rejected)

### 1.1 Platform and data safety
- **Schema is ADDITIVE ONLY, and this phase adds nothing.** Never run `drizzle-kit push`. Never drop or alter columns. Never wipe hub data. Do not run `npm run db:migrate` or any write or seed script against the live hub DB.
- **Live DB state:** the Phase 11 remediation handback records the live DB without `custom_build_job_items` and the 0055 objects. Shipping this phase to an environment without migrations 0052–0055 breaks intake. Task 0 requires a read-only presence check and a precondition note to the Operator. The Builder never applies migrations to the live DB.
- **Katana is a single live tenant with no sandbox.** No intake module may import `src/lib/katana.ts`, `src/server/integrations/**`, `src/inngest/path-a-release.ts`, or any Katana, Woo, QBO or Clover client (a transitive-import static guard enforces this, Task 12). Intake neither creates nor releases anything in Katana. Release stays Path A's job after the deposit.
- Never delete a paid order. Never touch `saga_runs` from intake (read only, via `releaseStore.getSaga`).
- Still forbidden by roadmap: V8 outbox, Redis CCR leases, `effect_claims`, Trigger.dev, DLQ UI, `/api/admin/redrive`, JSONB BOM trees, visual field mappers, auto-Approve of catalog products from CAD. Catalog intake creates an **unapproved** piece with `sync_to_woo=false`, `sync_to_clover=false`, `is_web_visible` false.
- Money in anything new is integer cents. `monetaryValue` arrives from GHL as a dollar number. Convert once at the boundary (`Math.round(value * 100)`), transport and store cents, format only at render.
- Never log or return secrets: `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_EMBED_SECRET`, `embedKey`, Authorization headers, DB URLs, Supabase keys, and **signed storage URLs and their tokens**.

### 1.2 SRE guardrails (mandatory, reviewed line by line)
1. **Idempotency.**
   - `createIntakeAction` is idempotent on a client-generated `intakeKey` (UUID v4, one per wizard session, stable across retries until success or an explicit reset).
   - The same key and the same payload return the same SKU with `replayed: true`.
   - The same key with a different payload fingerprint returns `VALIDATION` and writes nothing.
   - Concurrent identical submissions (double click, flaky retry) produce exactly one SKU, one job per opportunity and one item row (Task 7 defines the lock-free mechanism: conflict-safe inserts, no advisory locks).
   - Every upload-plan and confirm step is idempotent (Task 8).
   - Retrying a failed step never duplicates a `cad_uploads` row for the same `(sku, sha256)`.
2. **Type safety.**
   - No `any`, `as any`, `@ts-ignore`, `@ts-expect-error` or `catch (e: any)` in any new or modified file under the intake graph (Guard G1).
   - `catch (error: unknown)` always.
   - All action and route inputs parse through strict zod (`.strict()`) schemas.
   - All outputs are the discriminated union `ActionResult<T>` (Appendix A).
   - Error codes are a closed union, with an exhaustive `satisfies Record<IntakeErrorCode, ...>` message map.
   - Database handles use the existing `ReleaseDb` / `PathATx` types, not `any`.
3. **No raw errors leaked.**
   - No caught error's `.message`, `.stack`, upstream GHL text, SQL text, constraint names or storage error strings ever reaches a client. This covers Server Action returns, Route Handler bodies, thrown errors from actions, and React error boundaries.
   - Every failure goes through `toIntakeFailure(error)`, which returns `{ code, message (from the catalog), ref }` and logs ONE structured line server-side (`tag: "embed-intake-error"`, `ref`, `code`, `where`, actor email, `errorName`, redacted message).
   - The user sees "Reference `K7M2QX`" so Ops can find the log line.
   - Existing admin actions called from the embed (`requestCadUpload`, `confirmCadUpload`, `getLatestCadUpload`) return raw `error` strings. The embed wrapper maps them through an allow-list and never forwards their text.
4. **Fail closed.** If GHL cannot confirm the opportunity at create time, the create fails with `UPSTREAM_BUSY` and writes nothing. If the actor cannot be determined, the action fails with `NOT_SIGNED_IN`. If a finishes SKU is not an active material with the right prefix, the create fails with `FINISHES_REQUIRED`.
5. **Atomicity.** Creating a piece is ONE database transaction (job upsert, SKU, catalog rows, item row). A failure leaves zero partial rows. File uploads happen after the commit and are resumable (Task 8).
6. **Server is authoritative.** The client never supplies `clientSlug`, contact name, project value, SKU, `custom_build`, or job id. The server re-fetches the opportunity from GHL by id, re-derives every code, re-validates every dictionary label, and re-sniffs every uploaded file.
7. **No new `/api` surface.** All intake endpoints live under `/embed` (Task 9). A static guard fails the build if an intake route appears under `src/app/api/`.

### 1.3 UX mandates
- **Jargon strip.** The terms in Appendix B (starting with "Airlock", "Mint", "Slug", "Quarantine") must not appear in any user-visible string in the embed: JSX text, `aria-label`, `title`, `placeholder`, `alt`, toast and banner copy, and every error message returned by embed actions or routes. A static test AND a runtime Playwright text sweep enforce this (Task 11, Task 12). Internal identifiers under `src/server/**` (for example `airlock.schema.ts`) stay as they are. File and component names under `src/app/embed/**` are renamed.
- **Design system.** "Soft UI with floating cards and animated gold beams" (Appendix C). No dark `.pim-glass` surfaces. No ad-hoc palettes.
- **No developer prompts:** no `alert()`, no `window.location.reload()`, no raw SKUs as primary labels, no raw status enums.
- **Touch targets** are at least 44 px (`min-h-11`). The embed is used on tablets in the showroom.

### 1.4 Framework rules
- **Next.js here is 16.3.2 with breaking changes.** Before touching route handlers, Server Actions, `next/dynamic`, cookies or headers, read these in `node_modules/next/dist/docs/01-app/`: `03-api-reference/03-file-conventions/route.md`, `03-api-reference/03-file-conventions/proxy.md`, `03-api-reference/01-directives/use-server.md`, `03-api-reference/04-functions/cookies.md`, `03-api-reference/04-functions/headers.md`, `02-guides/server-actions.md`, `02-guides/forms.md`, `02-guides/lazy-loading.md`. List anything you could not verify in the handback.
- Server Actions are dispatched sequentially by the client (documented). **Reads (search, lookups) therefore use Route Handlers; mutations use Server Actions.**
- `ssr: false` with `next/dynamic` is only legal inside a Client Component. The 3D viewer's dynamic import lives in `ModelCard.tsx` (`"use client"`).
- `next.config.ts` has no `cacheComponents`, so `use cache` is unavailable. Do not enable it. Do not raise `serverActions.bodySizeLimit`. All files go by signed-URL upload, never through a Server Action body.
- Do not edit `src/proxy.ts`. A static guard checks it is absent from the diff.

---

## 2. EXECUTION ORDER (do not reorder; one commit per task group)

```
Task 0  Preconditions, lock packet, baseline                      (no code)
Task 1  P0-A  D1  intake call passes the wrong argument           ┐
Task 2  P0-B  D2  new pieces invisible to the wizard              │ COMMIT C1 "P0 hotfix" — shippable alone
Task 3  P0-C  D3  custom job without a project                    ┘
Task 4  Foundations: copy, errors, actor, schemas, guards (tests first)         COMMIT C2
Task 5  Pure libraries: naming, GLB summary, file classification                COMMIT C2
Task 6  GHL + taxonomy + finishes read paths                                    COMMIT C3
Task 7  createIntake (transactional, idempotent)                                COMMIT C3
Task 8  PDF packet capture + CAD plan/confirm wrappers                          COMMIT C3
Task 9  Route Handlers and Server Actions scoped to /embed                      COMMIT C3
Task 10 Wizard UI + 3D toggle + design system                                   COMMIT C4
Task 11 Existing steps: copy, lazy loading, finishes/packet gates, finalize     COMMIT C4
Task 12 Tests, e2e, bundle budget                                               COMMIT C5
Task 13 Docs, env, dependency record                                            COMMIT C5
Task 14 Final verification and handback
```
**Fail-first protocol (every task).** Write the tests for the task first and run them against the unmodified source. Record the failing output. Only then write the implementation. Some "rejects" tests pass accidentally when the symbol does not exist yet (an `undefined` call also throws). Assert on the specific error code or message, not just "throws". Paste raw before and after runs into the handback.

---

## TASK 0 — Preconditions, lock packet, baseline (no application code)
1. **Run `git status`, `git log -1 --oneline`, `npx tsc --noEmit`** and record all three. Per `phase_11_remediation_handback.md`, Phase 11 is dirty and uncommitted in the working tree. `write-lock.mjs` refuses a dirty worktree unless `allow_dirty_base` is set, and Phase 12's blast radius must not include Phase 11's 59 files. **Do not start until the Operator confirms Phase 11 is certified and committed.** If it is not, stop and say so.
2. **Governance lock.**
   - `.cursor/phase.lock` currently says `phase-11` (mode `certify`, no `allowed_files`), so on Track 2 every `Write`, `StrReplace` and `Delete` is denied.
   - The lock is written only by `node .cursor/skills/phase-lock/scripts/write-lock.mjs`. The Builder does not hand-edit it.
   - Ask the Operator to run the script with the packet below. `allowed_files` is longer than 8, so `override_blast_cap: true` is required. That is an explicit Operator decision.
   - The packet is data for the Operator to review. `base_ref` is the Phase 11 commit.
```json
{
  "phase_id": "phase-12",
  "intent": "Human-Centric Intake: P0 hotfixes D1-D3; 3-screen wizard, factory-order PDF capture, GLB preview toggle, embed-scoped endpoints",
  "mode": "edit",
  "base_ref": "<phase-11 commit sha>",
  "override_blast_cap": true,
  "expected_blast_radius": 80,
  "target_test": "npx vitest run tests/intake-create-client.test.ts",
  "allowed_files": [
    "src/app/embed/factory-bom/",
    "src/app/admin/factory-bom/",
    "src/app/admin/path-a/actions.ts",
    "src/app/embed/admin/master-catalog/actions.ts",
    "src/app/globals.css",
    "src/components/ui/",
    "src/lib/intake/",
    "src/server/factory-bom/",
    "src/server/ghl/",
    "src/server/master-catalog/",
    "src/server/path-a/item-store.ts",
    "tests/",
    "scripts/qa/check-embed-bundle.ts",
    "package.json",
    "package-lock.json",
    ".env.example",
    "phase_12_handback_report.md"
  ]
}
```
   `expected_blast_radius` is the Architect's estimate (about 50 new files plus about 30 modified or deleted). The Builder recomputes it from the Appendix D inventory and tells the Operator if it differs by more than 10%. Adjust the lockfile entry to the repo's real lockfile name.
3. **Live DB presence check (read-only).** Print only user and host from `POSTGRES_URL` (never the password; use the Step A technique from `PHASE_10_EXECUTION_BLUEPRINT.md` Task 4). Then, only if the Operator confirms the target is the live DB and approves a read-only catalog query, run a `SELECT to_regclass('public.custom_build_job_items')`. Report present or absent. Absent means: tell the Operator that migrations 0052–0055 must be applied through the sanctioned path before P1 is exercised there. Do NOT apply them yourself.
4. **Dependency baseline.** Record `npm ls three @react-three/fiber @react-three/drei react` (expected: absent for three.js). Record `.next/diagnostics/route-bundle-stats.json` after a fresh `npm run build`, specifically `/embed/factory-bom` `firstLoadUncompressedJsBytes`. The Architect observed **809,662** on the existing (possibly stale) build; use YOUR fresh number as the budget baseline for Task 12.
5. **Read the operator mock.** Open `tests/fixtures/ghl-opportunity-search.mock.json` (A11). Confirm it carries `id`, `name`, `monetaryValue`, `contactName`. Do not invent other fields. If `id` is absent: STOP.
6. **Read the Next docs** listed in 1.4 and note anything that contradicts this blueprint.

---

## TASK 1 — P0-A (D1): the intake action passes the wrong argument
**Problem.** `beginAirlockIntake` (`src/app/admin/factory-bom/actions.ts`, around line 1267) calls `mintCustomJob(input, { forceRecreate: true })`. The second parameter of `mintCustomJob` is `dbTx?: any`. `db` therefore becomes `{ forceRecreate: true }`, `db.query` is undefined, and the first query throws `Cannot read properties of undefined (reading 'sku_mappings')`. The catch block returns that raw string to the user. `tests/custom-build-job.test.ts` calls `mintCustomJob` without the second argument, so it never caught this.

**Fix.**
- Delete the second argument at the call site. `forceRecreate` has no implementation and no meaning anywhere in the repo (grep confirms only this call).
- Type the `dbTx` parameter of `mintCustomJob` and `promoteToCatalog` as `ReleaseDb` (from `src/server/path-a/release-store.ts`), not `any`. The compiler then rejects this class of mistake.
- Replace `return { ok: false, error: error.message }` in `beginAirlockIntake` with the mapped failure (`code`, friendly `error` string, `ref`) and a `console.error` structured line. P0 may use a minimal local mapper. Task 4 introduces the shared `toIntakeFailure` and replaces it.
- Mark `mintCustomJob` and `promoteToCatalog` `@deprecated` (JSDoc). They stay exported because `tests/custom-build-job.test.ts` uses them. A guard forbids importing them from `src/app/embed/**` after P1.

**Acceptance (fail-first).** `tests/intake-p0-regressions.test.ts` case D1: with a faked session and a PGlite or table-aware fake DB, `beginAirlockIntake({ mode: "custom_build", clientSlug, itemSlug, ghlOpportunityId })` returns `ok: true` with a `JOB-…` SKU. Against the unmodified code it returns `ok: false` with the TypeError text. Also assert a thrown internal error returns the friendly message and does NOT contain the original error text.

## TASK 2 — P0-B (D2): a freshly created piece is invisible to the wizard
**Problem.**
- `embed/factory-bom/page.tsx` loads `listFactoryProducts()`, which only returns rows where `source_file LIKE 'vividworks_phase%'`.
- `mintCustomJob` leaves `source_file` and `original_name` at their `""` defaults. `promoteToCatalog` sets `original_name` but not `source_file`.
- `AirlockWizard` does `products.find(p => p.sku === initialSku)`, finds nothing, `originalName` is `""`, `step1AllowsContinue` returns false, and Step 4 reports `MISSING_ROOT_META`. Every new piece dead-ends at Step 1.
- The admin page already works around this with `resolveLinkedFinishedGood`. The embed page does not.

**Fix.**
- NEW `src/server/factory-bom/intake/load-subject.ts` exporting `loadIntakeSubject(sku)`. It reads one SKU row (no `vividworks_phase` filter) and returns a `FactoryProductRow`-compatible record plus (P1) job, opportunity, finishes, packet and quantity fields. P0 uses only the base fields.
- `page.tsx`: if `initialSku` is not present in the `products` array, append the row from `loadIntakeSubject`. P1 deletes `listFactoryProducts` from this page entirely (Task 11).
- `mintCustomJob` sets `original_name` to the display name and `source_file` to `'factory-bom-intake'`. `promoteToCatalog` sets `source_file` to `'factory-bom-intake'`. Neither value changes any existing query result: `source_file` is read only by the `vividworks_phase%` filter and by `master-catalog-new-product` rows, and the new literal matches neither. Verify with a grep and say so in the handback.

**Acceptance (fail-first).** `loadIntakeSubject` returns a row (name non-empty) for a JOB-* SKU and a FIN-* SKU that are not `vividworks_phase*`. A page-level test (render function with mocked loaders) shows `selected` is found and `step1AllowsContinue` returns true once the CAD upload is `draft_ready`. `MISSING_ROOT_META` is no longer produced for a newly created piece.

## TASK 3 — P0-C (D3): a custom job can be created without a client project
**Problem.** `mintCustomJob` without `ghlOpportunityId` inserts a brand-new orphan job header. The SKU classifies as `custom_without_opportunity`. `finalizeDesignAction` then rejects it ("Only custom_job_bound SKUs can be finalized") and the Katana fence refuses it. A rep can create a job that can never ship. Also, `ghlOpportunityId` arrives from a URL parameter that is usually absent for factory-bom menu links.

**Fix.**
- Server: `beginAirlockIntake` with `mode: "custom_build"` and no `ghlOpportunityId` returns `{ ok: false, code: "PROJECT_REQUIRED", error: "Choose the client project first.", ref }` and writes nothing. (P1's `createIntakeAction` enforces the same rule structurally; the opportunity is part of its schema.)
- `mintCustomJob`: when `ghlOpportunityId` is absent, throw a typed error instead of inserting an orphan header (the P0 path is guarded above, but the function must not be able to create orphans for any caller).
- `FunnelFork.tsx` (P0 only; deleted in P1): when `opportunityId` is undefined, disable the client-piece choice and show: "Open this from a client project in GoHighLevel to add a piece for a client." Use no banned terms in strings you touch. Legacy labels you do not touch may remain until C4.

**Acceptance (fail-first).** `beginAirlockIntake({ mode: "custom_build", ... })` without an opportunity returns `PROJECT_REQUIRED` and `custom_build_jobs` / `sku_mappings` row counts are unchanged. `mintCustomJob` without an opportunity throws the typed error.

**COMMIT C1 gate.** Before moving on: `npx tsc --noEmit`, the new regression file, `tests/custom-build-job.test.ts` (DB suite, run per the DB-test rules in Task 14 only against a test DB), and `tests/pglite-path-a-store.test.ts` must pass. C1 is a shippable hotfix on its own. Tell the Operator it can be deployed independently.

---

## TASK 4 — Foundations (tests first)
Create the shared pieces every later task depends on.

1. **`src/lib/intake/copy.ts`.** Single source for all embed copy: step and screen titles, button labels, field labels, helper text, the full error-message catalog keyed by `IntakeErrorCode`, and the `BANNED_TERMS` regex list (Appendix B). Client-safe, no server imports. This file is inside the banned-terms scan, so the catalog itself cannot contain a banned word.
2. **`src/lib/intake/types.ts`.** zod 4 schemas (all `.strict()`): `IntakeClientInput`, `IntakeCatalogInput`, `UploadPlanRequest`, `PacketConfirmInput`, route query schemas; the `IntakeErrorCode` union; `ActionResult<T>` (Appendix A). Infer TS types from the schemas. Never hand-write a second copy of a shape.
3. **`src/server/factory-bom/intake/errors.ts`.**
   - `toIntakeFailure(error: unknown, where: string, extra?)` returns `{ ok: false, code, message, ref }`.
   - Known typed domain errors map to their code. A `PathAFenceError` maps to `PROJECT_LOCKED`. A Postgres `23505` on an intake key maps to replay handling (not an error). Everything else is `INTERNAL`.
   - `redact(text)` strips `Bearer …`, `postgres://…`, `https://…token=…`, JWT-shaped strings and anything matching the configured secret env values.
   - `ref` is 6–8 chars of base32 from `crypto.randomUUID()`.
   - Logs one `console.error` JSON line. It never logs the signed URL or any `token` query value.
4. **`src/server/factory-bom/intake/actor.ts`.** `resolveIntakeActor({ reportedEmail })`:
   - Calls `getPimSession()`. No session means `NOT_SIGNED_IN`.
   - A real operator session (not the embed principal) uses their own email and ignores any reported email. Source is `operator`, `verified: true`.
   - The embed principal (`isEmbedPrincipal`) with a syntactically valid `reportedEmail` (zod `.email()`, lowercased, at most 254 chars) uses it. Source is `embed-reported`, `verified: false`.
   - The embed principal without a valid `reportedEmail` uses `GHL_EMBED_PRINCIPAL_EMAIL`. Source is `embed-unattributed`, `verified: false`.
   - `ghlUserEmail` is an unsigned URL merge field. It is a **label for the audit trail, never an authorization input.** The code and the handback must state this plainly. It must never grant override or elevated rights (`hasOverrideAuthority` still denies the embed principal).
   - Persistence rules (Task 7 applies them): `custom_build_jobs.created_by`, `sku_mappings.updated_by`, a `pim_audit_log` row through `logPimAudit` for each of `intake.create`, `intake.model_attached`, `intake.packet_attached`, `intake.packet_viewed`, and `cad_uploads.uploaded_by` plus the CAD event's `operatorEmail`. Audit rows record `verified=false` and `via=ghl-embed` in `newValue` when applicable.
5. **Guards first** (written now, red until the work lands): `tests/embed-copy-guard.test.ts` (Task 12 spec) and `tests/intake-static-guards.test.ts` G1–G8 (Task 12 spec).
6. **`src/components/ui/GoldBeam.tsx`.** Shared version of the existing duplicated `GoldBeam` (see Appendix C). Do NOT edit `DispatchPortal.tsx` or `LiveStockView.tsx`.

**Acceptance.** `tests/intake-errors.test.ts`: feed errors whose message contains `postgres://u:p@h/db`, `Bearer abc.def.ghi`, a signed URL with `?token=…`, a Postgres constraint name, and a GHL error body. Assert none of that text appears in the returned object, and that the log line contains the `ref` and not the secrets. `tests/intake-actor.test.ts`: the four actor outcomes, plus "reported email never overrides a real operator" and "no session fails".

## TASK 5 — Pure libraries (no I/O, client-safe)
1. **`src/lib/intake/naming.ts`** (deterministic, table-driven tests):
   - `deriveClientCode(contactName, opportunityName)`:
     - NFKD-normalize and strip diacritics.
     - Take the last token of the contact name after dropping suffix tokens (`JR`, `SR`, `II`, `III`, `IV`, `LLC`, `INC`, `LTD`, `TRUST`, `FAMILY`).
     - If there is only one token use it. If the contact name is empty fall back to the opportunity name.
     - Uppercase, strip non `A-Z0-9`, cap at 16 characters. Empty result is `VALIDATION`.
   - `deriveItemCode(pieceName)`:
     - Normalize, drop stopwords (`THE`, `A`, `AN`, `WITH`, `FOR`, `OF`), tokenize on non-alphanumerics, join with `-`.
     - Cut at a **token boundary** at 24 characters (hard-cut only if the first token alone exceeds 24).
     - Result must match `/^[A-Z0-9][A-Z0-9-]{2,23}$/`. Anything shorter than 3 is `VALIDATION`.
     - Example: "Malibu 3-Seat Sectional" yields `MALIBU-3-SEAT-SECTIONAL`.
   - `buildClientSku(clientCode, itemCode, variant?)` yields `JOB-{CLIENT}-{ITEM}` and `-V{n}` when `n >= 2`. The final SKU must match `^[A-Z0-9][A-Z0-9-]{2,64}$`.
   - `nextVariantIndex(existingSkus, baseSku)`: parse only `-V(\d{1,2})$` (and, for client SKUs, tolerate legacy `-(\d{2})$` suffixes as "taken"); exact-match comparison, **not** `LIKE 'base%'`. This fixes the collision bugs in `mintCustomJob` / `promoteToCatalog` (prefix `LIKE` makes `CHAIR` collide with `CHAIRMAN`, and `MALIBU-SECTIONAL-84` is misread as suffix 84).
   - `suggestFromFilename(filename)` returns `{ pieceName?, length?, depth?, collectionAlias? }` (strip extension, split on `_`/`-`, reuse the digit heuristic of `healDimensions`: two or three-digit tokens). It is a suggestion only; the user always confirms.
   - `roundInchesForCode(value)`: the catalog code uses whole inches. Fractional input (up to 1 decimal) rounds to the nearest integer **for the code only**; the catalog stores the exact value (note: `previewSku` strips non-digits, so `96.5` would otherwise become `965`).
2. **`src/lib/intake/files.ts`.** Constants (`PACKET_MAX_BYTES`, `CAD_MAX_BYTES` import or mirror with a test that they agree), extension allow-lists, and `classifyDropped(files)`, which returns `{ geometry?, packet?, images[], rejected[] }` with reasons: no geometry file, `.skp` only, more than one geometry file, more than one PDF (the user must pick), over size, unsupported type.
3. **`src/lib/intake/glb-summary.ts`.** `readGlbSummary(file: File)`:
   - Read the 12-byte header (magic `glTF`, version 2) and the first JSON chunk (cap 5 MiB; larger returns `unknown`) using `file.slice`. It never loads the whole file and never imports three.js.
   - Return `{ valid, meshCount, nodeCount, materialCount, boundsMeters?: [x,y,z], boundsInches?: [x,y,z], unitsLookOdd }`.
   - Compute bounds from POSITION accessor `min`/`max`, **applying node transforms** (`matrix` or TRS) down the scene hierarchy (cap at 50,000 nodes and depth 64). Root scale factors such as 0.0254 are common and must not produce wrong sizes.
   - `unitsLookOdd` when the largest extent is under 0.05 m or over 20 m. Warn, never auto-correct.
   - Zero meshes means `valid: false` with reason `NO_GEOMETRY`.
   - Also `sha256Hex(file)` via `crypto.subtle.digest` (25 MiB cap), used for dedupe and for the idempotent upload plan.
4. `.dae` gets a cheap XML sanity check (`<geometry` present). `.blend` and `.skp` get no client-side inspection (metadata card shows name and size, plus "We'll read this after upload").

**Acceptance.** `tests/intake-naming.test.ts` (table of at least 40 cases including diacritics, suffixes, over-length, collisions, legacy `-02`, `CHAIR` vs `CHAIRMAN`), `tests/intake-glb-summary.test.ts` (build tiny GLBs in memory: valid, zero-mesh, root scale 0.0254, truncated header, oversized JSON chunk, wrong magic), `tests/intake-files.test.ts`.

---

## TASK 6 — GHL, taxonomy and finishes read paths
All server-only, dependency-injected for tests (`getGhl?: typeof ghlGet`), none of them a Server Action.

1. **`src/server/ghl/parse.ts`.** Extract the shared helpers (`text`, `records`, `personName`) from `search-hold-targets.ts`. **Do not change `search-hold-targets.ts` or its exports** (the showroom uses it). The duplicate helpers are intentionally left in place to keep this phase's blast radius small; note it in the handback.
2. **`src/server/ghl/search-opportunities.ts`.** `searchOpportunities(query)`:
   - Query length 2–80 after trim (else empty result, no call).
   - ONE `GET /opportunities/search?location_id=…&q=…&limit=20` call for `status=open` and ONE for `status=won` in parallel. That is at most 2 calls. It must NOT replicate the contact fan-out (`searchHoldTargets` makes up to 8).
   - Map each record to `OpportunityHit = { id, name, contactName, valueCents }` using ONLY `id`, `name`, `contactName` and `monetaryValue` (A7). `contactName` falls back to the nested `contact.name` if the top-level field is missing. `valueCents` is `null` when `monetaryValue` is absent or not finite.
   - Merge and de-duplicate by id, cap 20, sort by name.
   - Never forward GHL error text. Any GHL failure becomes a typed `UpstreamBusyError`.
3. **`src/server/ghl/fetch-intake-opportunity.ts`.** `fetchIntakeOpportunity(id)` re-fetches `GET /opportunities/{id}` and returns `{ id, name, contactName, valueCents, status }`. It rejects a different returned id, a different `locationId`, and statuses other than `open`/`won` (A6). It does NOT require a `contactId` (the confirmed fields do not include one). GHL failure: `UpstreamBusyError`; not found: `PROJECT_NOT_FOUND`; lost or abandoned: `PROJECT_CLOSED`.
4. **`src/server/factory-bom/intake/taxonomy.ts`.** `loadIntakeTaxonomy()` returns active `nomenclature_collections` and `nomenclature_categories` as `{ code, label, aliases }[]`. It reuses the query shape of `getDictionaries()` but lives in a non-"use server" module and omits SKU tokens (third-party only).
5. **`src/server/factory-bom/intake/finishes.ts`.** `searchFinishes(kind: "frame" | "powder" | "fabric", query, limit = 50)`:
   - Select active `sku_mappings` rows whose `global_sku` starts with `MET-` / `PWD-` / `FAB-` (A1), left-joined to `raw_materials_catalog` for the display name. Name-ordered, filtered by `q` on name and SKU, `LIMIT` enforced.
   - `validateFinishSelection(selection)` re-checks every chosen SKU server-side (active, right prefix). `TBD` is representable (`{ kind: "tbd", note }`, note 5–200 chars).
   - Fabric lists can be long, so the picker is a typeahead behind the route handler (Task 9), not a prop.
6. **`src/server/factory-bom/intake/project-status.ts`.** `loadProjectStatus(oppId)` returns `{ jobExists, clientCode?, pieces: [{ name, quantity }], packet?: { filename, uploadedAt }, locked: boolean }`. `locked` is true when `releaseStore.getSaga(oppId)` is `IN_PROGRESS`, `COMPLETED`, or manual-failed with a release request (the same rule `runCadIntake` uses). This is what lets the UI say "This project already has a factory order on file" and "already sent to production" **before** the user fills the form.

**Acceptance.** `tests/intake-ghl.test.ts` using the mock fixture: field mapping (`name`, `monetaryValue`, `contactName`), cents conversion (`48200` yields `4820000`, `null` and `"abc"` yield `null`), ≤2 upstream calls per search, GHL 500/timeout/bad JSON each yield `UpstreamBusyError` with no GHL text in the message, lost or abandoned rejected, foreign location rejected. `tests/intake-taxonomy.test.ts`, `tests/intake-finishes.test.ts` (prefix filter, inactive hidden, `LIMIT` enforced, TBD without note rejected, wrong-prefix SKU rejected).

---

## TASK 7 — `createIntake`: one transaction, idempotent, server-authoritative
**New** `src/server/factory-bom/intake/create-intake.ts` (pure server module; the Server Action is a thin wrapper in Task 9).

### 7.1 Client Project path (`mode: "client_project"`)
Input (zod, strict): `intakeKey (uuid)`, `opportunityId`, `pieceName`, `quantity (int 1–99)`, `finishes { frame, powder, fabric }` (each an SKU choice or TBD with note), `files` descriptors (`cad { filename, byteSize, sha256? }`, `packet? { filename, byteSize, sha256? }`), `reportedUserEmail?`. **No** client code, no contact name, no value, no SKU, no job id.

Order of operations (everything before step 6 is read-only and fails closed):
1. Resolve the actor (Task 4). No actor fails with `NOT_SIGNED_IN`.
2. Parse input. Validate files by descriptor: extension, size, geometry present (`.skp` only is `FILE_REQUIRED`), at most one PDF.
3. `fetchIntakeOpportunity(opportunityId)`. A failure here returns `UPSTREAM_BUSY` / `PROJECT_NOT_FOUND` / `PROJECT_CLOSED` and **writes nothing**.
4. `loadProjectStatus`. If `locked`, return `PROJECT_LOCKED`. If the job has no packet on file and the input has no packet descriptor, return `FILE_REQUIRED` (A2).
5. `validateFinishSelection`. A failure returns `FINISHES_REQUIRED` with `fieldErrors`.
6. **Transaction:**
   a. `INSERT custom_build_jobs … ON CONFLICT (ghl_opportunity_id) DO NOTHING RETURNING`; if nothing returned, `SELECT` the existing job. The job's `client_slug` is derived **once** (`deriveClientCode` from the freshly fetched contact name) and **never recomputed** for later pieces: later pieces read `job.client_slug`. `display_name` = opportunity name, `created_by` = actor email.
   b. Compute the item code (`deriveItemCode`) and the base SKU `JOB-{client_slug}-{item}`.
   c. **Replay check:** look up `sku_mappings` with `global_sku LIKE 'JOB-%'` whose `attributes->'intake'->>'key'` equals `intakeKey`. If found: compare the stored payload fingerprint; same fingerprint returns the stored result with `replayed: true`; different fingerprint returns `VALIDATION`. (No new index. The `JOB-%` prefix narrows the scan. Do not add a GIN index; that is a schema change. If the scan proves slow on the test DB, report it and do not "fix" it with a migration.)
   d. **Duplicate piece:** if the same normalized item code already exists under this job and the request has no `duplicateDecision`, return `DUPLICATE_PIECE` with `{ existing: { sku, pieceName }, suggestedVariantSku }`. With `duplicateDecision: "replace_model"` the flow targets the existing SKU (no new SKU row; `locked` projects are already excluded). With `"add_another"` the flow appends `-V{n}`.
   e. `INSERT sku_mappings … ON CONFLICT (global_sku) DO NOTHING RETURNING`. If nothing returned (a concurrent twin won), re-read; if that row carries the same `intakeKey` it is a replay, otherwise bump the variant index and retry (bounded to 5 attempts, then `CONFLICT_RETRY`). Do not rely on catching an aborted-transaction error. Row content: `product_origin: null`, `category: "Custom"`, `item_type: "finished_good"`, `original_name: pieceName`, `source_file: "factory-bom-intake"`, `sync_to_woo: false`, `sync_to_clover: false`, `updated_by: actor.email`, `attributes: { custom_build: true, job_id, finishes: {...}, intake: { key, fingerprint, actor: { email, source, verified }, finishesPending, createdAt } }`.
   f. `ensureItem({ jobId, globalSku, quantity })` through `createItemStore(() => tx)`. `ensureItem` gains an optional `quantity` parameter (default 1; `onConflictDoNothing` so it never overwrites). The later Inngest `runCadIntake` call stays harmless.
7. After commit: `logPimAudit` (`intake.create`). Audit failure is logged and never fails the request (existing helper semantics).
8. Return `{ ok: true, data: { sku, jobId, itemId, replayed } }`. The wizard then drives the uploads (Task 8).

### 7.2 Standard Catalog path (`mode: "catalog"`)
Input: `intakeKey`, `productName`, `collectionCode`, `collectionLabel`, `categoryCode`, `categoryLabel`, `length`, `depth` (each a positive number up to 999, one decimal allowed), optional `collisionDecision`, `files` (geometry required; PDF optional; images optional), `reportedUserEmail?`.
1. Dictionary validation uses the existing zero-trust `previewSku` (code must be active; submitted label must equal the primary label or an alias). Pass whole-inch rounded L and D (`roundInchesForCode`).
2. **Collision handling (OD1).**
   - `previewSku` reports `isCollision`. With no `collisionDecision`, return `DUPLICATE_PRODUCT` with `{ existing: { sku, productName }, suggestedVariantSku }`.
   - `"update_model"`: no new SKU. Allowed only for a catalog SKU (`FIN-%`, `custom_build` false) and only if A8 holds (the Builder verifies in `processCadUpload`; if unproven, return `DUPLICATE_PRODUCT` with `updateBlockedReason` for any SKU where `product_bom` has live rows). Writes nothing in the transaction; the wizard continues with a normal CAD upload against the existing SKU.
   - `"different"`: SKU becomes `{base}-V{n}` with the smallest free `n >= 2` (exact-match check). The new row records `attributes.intake.variantOf = baseSku`.
3. **Transaction:** the same three writes as the master catalog's `createNewProduct` (`sku_mappings`, `finished_goods_catalog`, `ecommerce_listings`). Do NOT duplicate that code. **Extract** `createNewProductCore(tx, payload, actor)` into `src/server/master-catalog/create-product-core.ts` and make `createNewProduct` a thin wrapper over it. `tests/sku-preview.test.ts`, `tests/actions.test.ts` and `tests/dictionary-system.test.ts` (DB suites) must stay green. Row content adds `source_file: "factory-bom-intake"`, `sync_to_woo: false`, `sync_to_clover: false`, `attributes.custom_build: false`, and the `intake` block as above.
4. Idempotency: same `intakeKey` mechanism, scanning `global_sku LIKE 'FIN-%'`.

### 7.3 `V-suffix` compatibility sweep (required)
Prove with a test table that a SKU ending `-V2` is handled by every code path that parses SKUs: `matchHubSku` (token `96X38-V2`), `subAssemblySku` (`SA-…-V2-FRAME`), `normalizeVaultSku`, `AirlockRecipeLineSchema` SKU regex, `classifyCustomSku`, `listFactoryProducts`' `legacySubAsm`, and the `origin_check` constraint (`FIN-%`). Grep for any other `-\d{2}$`-style SKU parser and list the result in the handback. Any parser that breaks is a defect to fix, not a reason to change the suffix.

**Acceptance.** `tests/intake-create-client.test.ts` and `tests/intake-create-catalog.test.ts` on PGlite with an injected fake GHL fetcher (fixture). Cases:
- happy path writes exactly the expected rows;
- replay with the same key and payload returns the same SKU with `replayed: true` and adds zero rows;
- same key with a different payload returns `VALIDATION` and adds zero rows;
- `Promise.all` of 5 identical calls produces 1 SKU, 1 job, 1 item;
- second piece on the same opportunity reuses `client_slug`, even when the contact name in the new GHL response differs;
- duplicate piece asks, then `add_another` yields `-V2` and again `-V3`;
- `PROJECT_REQUIRED`, `PROJECT_CLOSED`, `PROJECT_LOCKED` (saga `IN_PROGRESS`), `FINISHES_REQUIRED` (missing finish, wrong-prefix SKU, TBD without a note);
- TBD with a note succeeds and sets `finishesPending`;
- GHL down returns `UPSTREAM_BUSY` and every table count is unchanged (atomic);
- catalog: label/alias validation, collision then `different` yields `-V2`/`-V3`, `update_model` writes nothing new, three tables written, sync flags false, fractional dimensions round for the code only while the catalog stores the exact text.
- PGlite is one session and cannot prove cross-connection races. The real-Postgres concurrency proof is the Task 14 `RUN_DB_TESTS` run against a TEST database. State that limit in the handback.

---

## TASK 8 — Secure PDF packet capture, CAD wrappers, catalog documents
### 8.1 Storage contract for the factory-order PDF (OD4)
Reuse, do not reinvent, the asset-vault primitives (`sniffFormat`, `sha256Hex`, `sanitizeAssetFilename`, `extensionOf`, `createAssetSignedUpload`, `getVaultStorage`, `createAssetSignedDownload`).

- **Bucket:** the private `product-documents` bucket (`PRODUCT_DOCUMENTS_BUCKET`). Never a public URL; `getPublicUrl` must not be called for packets (guard G7).
- **Object key (server-generated, the browser never chooses it):** `factory-packets/{jobId}/{epochMs}-{random16hex}.pdf`.
- **Upload flow:**
  1. `requestPacketUploadAction({ intakeKey, sku, filename, byteSize })`: re-validates the actor, the SKU's job, extension `.pdf` (final segment only, so `x.pdf.exe` is rejected), size at most `PACKET_MAX_BYTES`. Returns a signed upload URL (`upsert: false`).
  2. Browser `PUT` using `XMLHttpRequest` (upload progress; `fetch` cannot report it).
  3. `confirmPacketUploadAction({ sku, storagePath, originalFilename })`: re-reads the object through the storage adapter, **checks the key matches** `^factory-packets/{jobId}/…\.pdf$` for THAT job, checks size, **sniffs `%PDF-` magic bytes**, hashes (sha256). On a non-PDF or an oversize object it **removes the object** and returns `PDF_INVALID` / `FILE_TOO_LARGE`.
  4. In one transaction: set `custom_build_jobs.packet_storage_path` to the confirmed key (this is "latest"), and record on the piece `sku_mappings.attributes.intake.packet = { path, sha256, bytes, filename, uploadedAt, actor }`. History is kept as append-only objects plus audit rows (no overwrite, `upsert: false`).
- **Idempotent confirm:** confirming the same path twice is a no-op returning the same result. Confirming a different object with an already-recorded sha256 for this job returns `deduped: true` and removes the redundant object.
- **Catalog PDF:** optional, stored as vault kind `shop_drawing` through `planAssetUpload` + `confirmAssetCore` (existing engine), keyed by SKU. These core functions are called directly under embed authentication, not through `requireOperator`.
- **Retrieval:** `getPacketDownloadLinkAction({ sku })` returns a 300-second signed URL created server-side with a download disposition, after the actor check, and writes an `intake.packet_viewed` audit row. The URL is never logged and never persisted.
- **No server-side PDF parsing and no rendering of PDFs in the embed.** The UI shows filename, size, a short sha256 fingerprint and a "View factory order" link that opens the signed URL in a new tab. This phase also **removes** `uploadFactoryPacketAction` (it read PDF bytes with `file.text()` and wrote a fake `s3://` path) and its callers.
- **Stored-object contract for the future AI middleware** (record it in the handback and in `docs/`, do not build the consumer): bucket `product-documents`, key `factory-packets/{jobId}/…pdf`, content type `application/pdf`, `sha256`, `bytes`, `filename`, the owning job and the piece SKU in `attributes.intake.packet`.

### 8.2 CAD model upload
- Wrap the existing `requestCadUpload` / `confirmCadUpload` / `getLatestCadUpload` (Server Actions in `src/app/admin/factory-bom/actions.ts`, session-checked, 25 MiB cap, signed upload to `cad-models`). The embed wrapper:
  - passes `actorEmail` (new optional field on both admin actions, honored **only** when the session is the embed principal, never overriding a real operator) so `cad_uploads.uploaded_by` and the CAD event's `operatorEmail` carry the reported user instead of the shared principal;
  - maps every admin result through an allow-list to friendly codes and **never forwards the admin `error` text**;
  - is idempotent: the client sends `sha256`; if a `cad_uploads` row for the same `(global_sku, sha256)` exists in `uploaded | queued | processing | draft_ready`, the wrapper returns `{ reused: true, uploadId, status }` and does not create a second row. `confirmCadUpload` already sends a deterministic Inngest event id (`cad-uploaded-{row.id}`), so confirm retries dedupe.
- The `.blend` flow (conversion to GLB through the existing handoff) is unchanged.
- Stills: **out of the intake.** The base64 Server Action path (`uploadCadStillImage`) hits the 1 MB Server Action body limit. Catalog images, when supplied, go through the vault `primary_image` kind with signed upload. Client pieces take no stills at intake. The builder confirms `confirmAssetCore` for `primary_image` works when the SKU exists (it does after Task 7) and reports otherwise.

**Acceptance.** `tests/intake-packet.test.ts` (storage adapter faked): key pattern, wrong-job key rejected, `x.pdf.exe` rejected, non-PDF content with a `.pdf` name removed and `PDF_INVALID`, oversize removed, sha256 dedupe, confirm idempotent, `upsert: false` used, no `getPublicUrl` call, download link requires an actor and logs `intake.packet_viewed`, signed URL absent from every log line. `tests/intake-cad-wrapper.test.ts`: reuse on same sha, no raw admin text forwarded, `actorEmail` honored only for the embed principal.

---

## TASK 9 — Route Handlers and Server Actions scoped to `/embed`
### 9.1 Why the scoping matters (verified in the code)
- `src/proxy.ts` treats a request as embed only when the pathname starts with `/embed`. Only then does it (a) copy `?embedKey=` into the `ccpatio-embed-auth` cookie (Path `/embed`, `HttpOnly`, `Secure`, `SameSite=None`, `Partitioned`) and (b) set the `x-ccpatio-embed: 1` context header.
- `getPimSession()` honors the embed principal only when that header is `1` **and** the key or cookie matches `GHL_EMBED_SECRET`.
- Therefore a Route Handler under `/api/**` **cannot** authenticate an embed caller (no context header, and the cookie is not sent to that path). Intake endpoints MUST live under `/embed/**`.
- `isPublicAsset(pathname)` returns true for any path containing `.`, which skips embed key handling and frame policy. **No intake route path segment may contain a dot** (no `route.json`-style names).
- Server Actions are invoked by POSTing to the page URL, so an action called from `/embed/factory-bom` carries the embed context. The same action invoked from a non-embed path gets no embed principal, so `getPimSession()` denies it. This is the boundary, and tests prove it (below).

### 9.2 Route Handlers (read endpoints, `GET` only)
Create under `src/app/embed/factory-bom/api/` (URLs `/embed/factory-bom/api/...`):
| Route | Query (zod) | Response | Cache |
|---|---|---|---|
| `opportunities/route.ts` | `q` (2–80 chars) | `{ ok, results: [{ id, name, contactName, valueCents }] }` | `private, max-age=30`, `Vary: Cookie` |
| `finishes/route.ts` | `kind` (`frame\|powder\|fabric`), `q?` (≤80) | `{ ok, results: [{ sku, name }] }` | `private, max-age=300`, `Vary: Cookie` |
| `sku-check/route.ts` | `mode=client` + `opp`, `piece`; or `mode=catalog` + `col`, `cat`, `l`, `d` | client: `{ ok, project: {jobExists, pieces, packet?, locked}, itemCode, duplicate? }`; catalog: `{ ok, sku, collision?, suggestedVariantSku?, updateBlockedReason? }` | `no-store` |

Every handler, in this order:
1. `export const dynamic = "force-dynamic"; export const runtime = "nodejs";`
2. `const session = await getPimSession();` as the FIRST statement, before any DB or GHL access. No session returns `401 { ok:false, code:"NOT_SIGNED_IN" }` with `Cache-Control: no-store`.
3. Parse the query with the strict zod schema. Failure returns `400 { ok:false, code:"VALIDATION" }` (no zod internals in the body).
4. Call the server module. Any throw goes through `toIntakeFailure` and maps to the status (`UPSTREAM_BUSY` 503 plus `Retry-After`, `INTERNAL` 500, `PROJECT_NOT_FOUND` 404). The body never contains upstream text.
5. Never accept `embedKey` in an API query string and never log request URLs that might contain it. Client `fetch` uses a relative URL without `embedKey` (the cookie carries it).

### 9.3 Server Actions (mutations)
One file: `src/app/embed/factory-bom/actions.ts` (`"use server"`). Exports exactly: `createIntakeAction`, `requestIntakeUploadsAction` (CAD plus packet plan), `confirmCadUploadAction`, `confirmPacketUploadAction`, `getPacketDownloadLinkAction`, `updateFinishesAction`, `getIntakeProgressAction`. Each:
- first line: `resolveIntakeActor(...)` (which calls `getPimSession()`);
- zod-parses its input;
- returns `ActionResult<T>` only (never throws to the client; unexpected errors are mapped by `toIntakeFailure`).
`updateFinishesAction` exists so a TBD finish is never a dead end: it re-validates, rewrites `attributes.finishes`, clears or sets `finishesPending`, and audits `intake.finishes_updated`. It is refused when the project is `locked`.

### 9.4 Proofs required
- `tests/intake-routes.test.ts`: for each route, (a) no session returns 401, (b) **embed principal presented WITHOUT the context header** (simulating a call from a non-embed path) returns 401, (c) valid embed principal with the header returns 200, (d) strict-schema 400s, (e) upstream failure yields the mapped 503 with no upstream text, (f) cache headers as specified. Use the real `getPimSession()` with mocked `next/headers` (model on `tests/pim-session.test.ts`), not a stubbed session.
- `tests/intake-actions-scope.test.ts` (static): every export of `actions.ts` and every `route.ts` calls `getPimSession` / `resolveIntakeActor` **before** any `getDb`, `ghlGet`, storage or `fetch` call (ordering check like Path A guard 5). No intake route file exists under `src/app/api/`. No route path segment contains `.`. `src/proxy.ts` is unchanged in the diff.

---

## TASK 10 — The wizard UI (3 screens, PDF slot, 3D toggle, design system)
New folder `src/app/embed/factory-bom/intake/`. All components are client components unless noted. All copy comes from `src/lib/intake/copy.ts`. Look and feel follows Appendix C exactly.

### 10.1 Flow and state
`IntakeWizard` owns one reducer: `{ screen: 1|2|3, files, preflight, intent, project, pieceName, quantity, finishes, catalogFields, intakeKey, createState, uploadState }`.
- `intakeKey = crypto.randomUUID()` is created when screen 3 first mounts and **kept until success or explicit reset**.
- Navigation preserves `opportunityId` and `ghlUserEmail`. Use one `embedNav()` helper that merges the current search params, **drops `embedKey`** (the cookie carries it), and sets `sku`. The old `router.push('?sku=')` dropped the opportunity id and would drop the attribution email.
- `page.tsx` parses and normalizes `ghlUserEmail` once on the server and passes `reportedUserEmail` as a prop. The client never re-parses it.
- After `createIntakeAction` succeeds the wizard runs the uploads (Task 8), then routes to `?sku={sku}` and the existing steps.
- **Resume:** `?sku=` on a piece whose files are incomplete shows a "Finish adding files" card driven by `loadIntakeSubject` (no CAD upload present, or client piece without a packet). Reloading mid-upload is safe because every step is idempotent.

### 10.2 Screen 1 — Drop your design
- One drop zone accepting `.glb .dae .blend .skp .pdf` plus images. `classifyDropped` runs immediately. Rejections explain themselves in plain language ("SketchUp files can't be measured. Export a .glb and upload that.").
- **Model card** (`ModelCard.tsx`, the default, lightweight): file name, size, "3D model readable" or a plain-language problem, part count, approximate overall size in inches (from `readGlbSummary`), and a units warning when `unitsLookOdd`. A duplicate-file warning appears when the sha256 matches an existing upload for this piece (via `sku-check` only after a piece exists; on first intake there is nothing to compare, so skip it).
- **3D toggle (OD2):** a `role="switch"` control labeled "Show 3D preview", rendered **only** when the geometry file is `.glb`, valid, and `canUseWebGl()` (a tiny offscreen canvas probe) is true. For `.blend`, `.skp` and `.dae` there is no toggle, no disabled toggle and no tooltip; a single quiet line says "3D preview is available for .glb files. Other formats are read after upload."
- **Viewer (`viewer/ModelViewer.tsx`):** loaded with `next/dynamic(() => import("./viewer/ModelViewer"), { ssr: false, loading: <skeleton /> })`, inside `ModelCard.tsx`, and only after the toggle is turned on. It is the ONLY file in the app allowed to import `three` or `@react-three/*` (Guard G5).
  - React Three Fiber `<Canvas frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "low-power" }}>`; `OrbitControls`; `Bounds` for auto-fit; hemisphere plus one directional light.
  - **No `<Environment preset>`** (it fetches HDRs from a CDN). No post-processing, no shadows, no auto-rotate when `prefers-reduced-motion`.
  - Load the model from a `blob:` object URL created from the dropped `File` (no upload, no base64). Revoke it on unmount. Disable Draco and Meshopt decoders (the default Draco decoder fetches from a third-party CDN); a file that needs them hits the error boundary.
  - Error boundary and `webglcontextlost` handler fall back to the metadata card with "Preview paused. [Try again]". Dispose geometry, materials and the renderer on unmount (`gl.dispose()`, `Cache.clear()`).
  - Cap the interaction area so page scroll inside the iframe still works on touch.
- **PDF slot (`PacketSlot.tsx`):** shows the dropped PDF (name, size) or an empty "Factory order (PDF)" slot. It reads "Required for client projects" on that path. At most one PDF per submission.

### 10.3 Screen 2 — Who is this piece for?
Two large floating cards (`floatCard`, hover lift, selected state with GoldBeam):
- **A client's project** ("Built for one customer")
- **A standard catalog product** ("We'll make this again")
If `opportunityId` is in the URL, the client card is pre-selected and screen 3 opens with the project already filled (with a "Change" link). Intent is a deliberate click; there is no silent default.

### 10.4 Screen 3a — Client project details
- **Project picker** (`OpportunityCombobox.tsx`): label "Find client project". Debounced 300 ms, minimum 2 characters, `AbortController` cancels in-flight requests, a client-side `Map<normalizedQuery, results>` with a 30 s TTL. Rows show **contact name, project (opportunity) name and value** (`Intl.NumberFormat`, `—` when `valueCents` is null). Keyboard navigation and ARIA combobox semantics are modeled on `TokenCombobox`. Skeleton rows while loading, inline "Searching…", an empty state, and a retry state for `UPSTREAM_BUSY`. The GHL id is bound in state only and is never shown.
- After a project is chosen the wizard calls `sku-check` once: if the project is `locked` the screen explains and offers nothing to submit; if a packet is on file the PDF slot becomes "Using the factory order already on file ✓ [Replace with a newer version]".
- **Piece name** (required, 3–60 chars) and **How many** (integer 1–99, stepper).
- **Finishes (OD3), all three REQUIRED:** Frame, Powder coat, Fabric. Each is a typeahead (`FinishSelect.tsx`) fed by `/api/finishes`. Each also offers one explicit option, **"TBD / Pending"**; choosing it reveals a required note ("Who will confirm, and by when?", 5–200 chars) and shows a quiet amber banner: "Finishes pending — this piece can't be marked complete until they're chosen." No default selection. Continue is disabled while any finish is empty.
- **Item code (auto)** is shown read-only in the mono `ticket` style, computed live with `naming.ts` and confirmed by the server.
- If the server answers `DUPLICATE_PIECE`: a `CollisionPrompt` appears: "You already added 'Malibu…' to this project." with **Replace the 3D model** or **Add another** (appends `-V2`).
- Primary button: **Create and read 3D model**. A disabled button always states why in one line directly above it.

### 10.5 Screen 3b — Standard catalog product
- **Collection** and **Product type** are dictionary comboboxes (props loaded in `page.tsx` via `loadIntakeTaxonomy`; labels, aliases and codes searchable; no free text). A "Not listed? Ask an Ops Manager" note replaces any add-new control (the dictionary action needs an operator session).
- **Product name** (prefilled from the filename suggestion; the user confirms). **Overall length (in)** and **Depth (in)**: required, up to one decimal, `inputMode="decimal"`, prefilled from the GLB summary where available, with a mismatch warning above about 10% against the model.
- **Item code (auto)** previews live. A debounced `sku-check` call detects collisions and shows a `CollisionPrompt`: "This product already exists: 'Malibu 96 Sectional'." with **Update existing 3D model** and **This is different** (OD1; the latter shows the `-V2` code it will use).
- Optional drawing PDF (`shop_drawing`) and optional product photo. Neither blocks creation.

### 10.6 After creation — progress
A progress card with named stages: **Saving → Uploading → Waiting → Reading your 3D model → Done**. It uses `getIntakeProgressAction` (which wraps `getLatestCadUpload`) on a 2 s interval, with exponential back-off after 60 s and a friendly timeout message ("This is taking longer than usual. You can leave this page; we'll keep going."). Uploads show a real progress bar (XHR). One GoldBeam on the active card. Every failure shows a banner with the friendly message and "Reference XXXXXX", plus a Retry that is safe (idempotent).

### 10.7 Autofill suppression (Chrome address-autofill collisions)
- `autoComplete="off"` on the `<form>` and on every `<input>`.
- **Opaque `name` and `id` values** (for example `f_7k2m`); never `name`, `client`, `address`, `email`, `phone`, `zip`, `city`.
- Combobox inputs use `role="combobox"`, `aria-autocomplete="list"`, `autoComplete="off"`, and `data-1p-ignore` / `data-lpignore="true"` (password managers).
- Labels avoid address-like wording ("Find client project", not "Client name").
- Dimensions use `type="text" inputMode="decimal"` (not `type="number"`).
- Acceptance includes a manual Chrome pass with a profile that has a saved address and contact: no field may offer to fill. Record screenshots in the handback.

### 10.8 Design and accessibility
- Appendix C tokens only. All controls at least 44 px tall. Visible focus rings. Respect `prefers-reduced-motion` (no beam animation, no step transitions). Use `framer-motion` (already a dependency) only for 150–200 ms step transitions.
- Add a `@media (prefers-reduced-motion: reduce)` rule for `.animate-beam-glide-lux` in `src/app/globals.css` (additive; it improves every existing beam).
- Run the layout at 1280 px and 390 px wide (iframe widths) and capture screenshots for the handback.

**Acceptance.** Task 12 Playwright specs.

## TASK 11 — Existing steps, and removing the legacy entry
- **Rename** `AirlockWizard.tsx` to `DesignWizard.tsx`, component `DesignWizard`. Step titles: "Piece & 3D model", "Materials check", "Build steps & shipping", "Final review". Header shows the piece name and client, with the item code small and grey.
- **`page.tsx`:** remove `listFactoryProducts()` from this route. Use `loadIntakeSubject(sku)` plus `loadIntakeTaxonomy()`. Steps 2 and 4 need child names and item types only for the BOM children of this root; add a targeted `loadChildMeta(skus[])` and pass that instead of the whole catalog.
- **Lazy loading:** load Steps 2, 3 and 4 with `next/dynamic` (client components). Step 1 and the intake stay in the first-load bundle.
- **Step 1** becomes a *model status card*: current model status, a plain-language geometry result (for a hygiene failure: "Some parts of the model can't be measured: {names}. You can continue and type the cut list by hand."), a **Replace model** action (the same upload machinery as intake, which for a client piece past the pause surfaces the friendly change-order message), the packet status with **View factory order**, and a **Finishes** summary with an **Edit finishes** control. Remove `window.location.reload()` (use `router.refresh()`) and the "Force rename" / "Replace catalog image" controls (automatic and hidden). `step1AllowsContinue` additionally requires, for client pieces, a packet on file.
- **Step 4:** rename, translate every blocking code through a map in `copy.ts` (every code in `evaluateAirlock` output gets a sentence; unknown codes get a generic sentence and the raw code is logged), replace the four attestation checkboxes' wording per Appendix B, replace `alert()` with an inline banner, remove the unused `releaseCustomJobAction` import. Behavior of release and finalize is unchanged. `evaluateAirlock` stays client-side in this phase (Section 0.2).
- **Finalize gate:** in `src/app/admin/path-a/actions.ts`, `finalizeDesignAction` additionally refuses with the blocking code `FINISHES_PENDING` when `attributes.intake.finishesPending` is true (A10). It reuses the existing `blockingCodes` response shape; do not change Phase 11 behavior otherwise. Step 4 translates the code.
- **Shared admin components rendered in the embed** (`CadUploadDropzone`, `BomMaterialRow`, `BomOperationsPanel`, anything else Steps 2–3 import from `src/app/admin/factory-bom/`): audit their user-visible strings. Either add a `variant="embed"` prop with copy from `copy.ts`, or fork embed-specific copies under `src/app/embed/factory-bom/`. List every component you changed or forked in the handback. Do not change their admin behavior.
- **Delete (after Task 12 passes):** `FunnelFork.tsx`, `IntakeDropzone.tsx`, `PacketLines.tsx`, `AirlockWizard.tsx`, and the server exports `beginAirlockIntake` and `uploadFactoryPacketAction` in `src/app/admin/factory-bom/actions.ts` (grep first: `FunnelFork` is the only caller of `beginAirlockIntake`; confirm none remain). `mintCustomJob` and `promoteToCatalog` stay (deprecated; tests use them). A guard forbids importing them from `src/app/embed/**`.
- `src/server/factory-bom/list-factory-products.ts` is unchanged (admin still uses it).

---

## TASK 12 — Tests, guards, e2e, bundle budget
### 12.1 Static guards (`tests/intake-static-guards.test.ts`; same style as `tests/path-a-static-guards.test.ts`, which you should read first)
| # | Guard |
|---|---|
| G1 | No `any`, `as any`, `@ts-ignore`, `@ts-expect-error` or `catch (…: any)` in `src/lib/intake/**`, `src/server/factory-bom/intake/**`, `src/server/ghl/{search-opportunities,fetch-intake-opportunity,parse}.ts`, `src/app/embed/factory-bom/**`, `src/server/master-catalog/create-product-core.ts`. |
| G2 | No code in the same scope returns a caught error's `.message`/`.stack` in an object (pattern check for `error:`/`message:` assigned from a catch variable), and no `JSON.stringify(error)`. |
| G3 | The transitive import graph of the intake modules contains no `src/lib/katana`, `src/server/integrations/**`, `src/inngest/path-a-release`, `src/server/woocommerce/**`, or Clover/QBO modules (graph walk like Path A guard 4b). |
| G4 | No `fetch(` to a Katana, Woo, QBO or Clover host in the intake scope. GHL is reached only through `private-api.ts`, and only with `GET`. |
| G5 | `three`, `@react-three/fiber` and `@react-three/drei` are imported only inside `src/app/embed/factory-bom/intake/viewer/**`, and that folder is referenced only through `next/dynamic`. |
| G6 | Every `route.ts` under `src/app/embed/factory-bom/api/` and every export of `src/app/embed/factory-bom/actions.ts` authenticates before any DB, GHL, storage or fetch call. No intake route exists under `src/app/api/`. No route path segment contains `.`. `src/proxy.ts` is not in the diff. |
| G7 | Packet code never calls `getPublicUrl`, and uses `upsert: false` (through `createAssetSignedUpload`). |
| G8 | Embed code never imports `mintCustomJob`, `promoteToCatalog`, `beginAirlockIntake` or `uploadFactoryPacketAction`. |

### 12.2 Banned-terms guard (`tests/embed-copy-guard.test.ts`)
- Parse every `.ts`/`.tsx` under `src/app/embed/factory-bom/`, `src/lib/intake/` and `src/server/factory-bom/intake/` plus the shared admin components listed in Task 11 with the TypeScript compiler API. Collect string literals, template literals, JSX text and the values of the attributes `aria-label`, `title`, `placeholder`, `alt`, `label`. Test each against `BANNED_TERMS` (Appendix B).
- Skip import/export specifiers, `className`, `data-testid`, `key`, `href`, `name`, `id`, `htmlFor`, `type`, `role`.
- The only escape is `tests/fixtures/embed-copy-allowlist.json`: each entry needs a one-line justification and QC reviews every entry (internal enum tokens only).
- Also fail on any **file or component name** under `src/app/embed/factory-bom/` containing a banned term.
- The P0 commit (C1) is exempt; the guard must be green from C4.

### 12.3 Unit and integration suites (all listed in Tasks 4–9)
`tests/intake-p0-regressions.test.ts`, `intake-errors`, `intake-actor`, `intake-naming`, `intake-glb-summary`, `intake-files`, `intake-ghl`, `intake-taxonomy`, `intake-finishes`, `intake-create-client`, `intake-create-catalog`, `intake-packet`, `intake-cad-wrapper`, `intake-routes`, `intake-actions-scope`, `intake-static-guards`, `embed-copy-guard`. Existing suites that must stay green: every `tests/path-a-*.test.ts`, `pglite-path-a-store`, `custom-build-job` (DB), `sku-preview` (DB), `actions` (DB), `dictionary-system` (DB), `asset-vault`, `confirm-asset` (DB), `pim-session`, `airlock-dossier`.

### 12.4 Playwright (`tests/e2e/embed-intake.spec.ts`)
Run with the embed principal (set a test `GHL_EMBED_SECRET` on the Next process; open `/embed/factory-bom?embedKey=…&ghlUserEmail=rep@example.com&opportunityId=…`), not god-mode, so the real embed auth path is exercised. Stub the opportunity list with `page.route` returning the operator mock. Cases:
1. Drop a small valid `.glb`: the metadata card shows; **no viewer chunk is requested before the toggle** (assert via `page.on('request')`); toggle on loads the viewer chunk and a `<canvas>` appears; toggle off restores the card.
2. Drop `.blend`, then `.skp` + `.pdf`: **no toggle element exists in the DOM**.
3. Drop a PDF: accepted, shown in the PDF slot; two PDFs prompt a choice.
4. Client path: Create is disabled until project, name, quantity and all three finishes are set; choosing TBD requires a note; the item code preview matches `naming.ts`.
5. Catalog path: dictionary comboboxes reject free text; a stubbed collision shows both choices and the `-V2` code.
6. Autofill: every input has `autocomplete="off"` and an opaque `name`.
7. **Runtime jargon sweep:** at every wizard state, `body.innerText` contains none of the Appendix B terms.
8. Iframe embedding: load the page inside an iframe from a different origin (a data page) and confirm the wizard renders (frame-ancestors policy intact).
9. Screenshots at 1280 and 390 wide attached to the report.
The create-and-upload step is proven by the PGlite/real-Postgres suites with the fake GHL fetcher, because the server re-verifies the opportunity against GHL and there is deliberately no test-only bypass in production code. The handback must include a short Operator-run live smoke checklist (one real opportunity, one real `.glb` and PDF) marked "NOT RUN BY BUILDER".

### 12.5 Bundle budget (`scripts/qa/check-embed-bundle.ts`)
After `npm run build`, read `.next/diagnostics/route-bundle-stats.json`:
- `/embed/factory-bom` `firstLoadUncompressedJsBytes` must be **less than or equal to the Task 0 baseline** (steps 2–4 lazy loading should reduce it; report the actual number).
- No chunk listed in that route's `firstLoadChunkPaths` may contain the strings `WebGLRenderer` or `OrbitControls` (the viewer stays out of first load).
- Print baseline, new value and delta. Fail on regression.

---

## TASK 13 — Docs, environment, dependencies
1. **Dependencies (A9).** Add `three`, `@react-three/fiber`, `@react-three/drei` and `@types/three` (exact versions; run `npm view <pkg> peerDependencies` and confirm compatibility with React 19.2.8 first, and paste the output into the handback). **QC signs off on the addition before it is committed.** If the Turbopack build needs `transpilePackages`, report it and ask QC before editing `next.config.ts`. Do not add `gltfjsx`, post-processing packages or a draco/ktx2 decoder bundle.
2. **`.env.example`:** document the factory-bom menu link: `/embed/factory-bom?embedKey=<GHL_EMBED_SECRET>&ghlUserEmail={{user.email}}&opportunityId={{opportunity.id}}`. State that `opportunityId` is available only where GHL provides an opportunity context (the Operator confirms for each menu placement) and that `ghlUserEmail` is a label for the audit trail, unsigned, and never authorizes anything.
3. **Docs:** do NOT edit `docs/MDM_MASTER_BLUEPRINT.md` in this phase (it is a protected spec). Put the intake model, the packet stored-object contract and the lexicon pointer in the handback file only.

---

## TASK 14 — Final verification and handback
Run, in this order, and paste the RAW output of every command into `phase_12_handback_report.md`:
1. `npx tsc --noEmit`
2. `npx vitest run` (full). Zero failures, zero unexpected skips. State the file and test counts.
3. DB suites against a **TEST** database only. Re-run the Phase 10 Task 4 "Step A" identity check first and paste it. If only the live DB is available: do NOT run write suites against it. Report the limitation and let QC decide. When allowed: `npx cross-env RUN_DB_TESTS=1 npx dotenv -e .env.test.local -e .env.local -- vitest run tests/custom-build-job.test.ts tests/sku-preview.test.ts tests/actions.test.ts tests/dictionary-system.test.ts tests/confirm-asset.test.ts`. List the test file FIRST in the dotenv chain (`setup-env.ts` never overrides already-set variables).
4. Real-Postgres idempotency proof: extend `scripts/qa/proof-of-life.runner.ts` with an additive step that runs `createIntake` twice and five-way concurrently against the TEST DB with a unique per-run opportunity id (`qa-intake-<uuid>`), asserts exactly one SKU, one job and one item, replays idempotently, and **deletes only the rows it created by exact key** (items, then SKU rows, then job; never a bulk delete). Do not weaken any existing step.
5. `npm run db:check` (expected exit 0 and **no new migration files**).
6. `npm run build`, then `npx tsx scripts/qa/check-embed-bundle.ts` (Task 12.5).
7. `node .cursor/skills/qca/scripts/qca.mjs` and transcribe the JSON stdout. Never elevate an exit code 2 (`DEFECT_REJECTED`) to certified.
8. **`npm run qa:lifecycle`** (required by the repo's `.cursorrules`). Paste the raw, unedited terminal output exiting with code 0. If any phase fails: fix the code (never the tests, never a mock of the database in Phase 2), and re-run.
9. Manual Chrome autofill pass (Task 10.7) and the screenshots.

**Handback file** (`phase_12_handback_report.md`) must contain, in this order:
- an honest headline table (tsc, vitest, DB suites, db:check, build, bundle budget, QCA, qa:lifecycle), each with the raw result;
- the fail-first evidence for every task (before and after runs);
- the A1–A11 assumption table with "confirmed" or "contradicted, here is what I did";
- the list of Next.js doc passages verified and anything unverified;
- the D1/D2/D3 resolution with the regression evidence;
- the V-suffix sweep table (Task 7.3);
- the list of shared admin components changed or forked (Task 11);
- everything NOT done or not provable (live DB state, real GHL, real storage, Chrome autofill on non-Chrome browsers) in bold, plainly;
- the Operator-run live smoke checklist.

**Definition of Done.** All of the above green, the banned-terms guard and the runtime jargon sweep clean, no new migration, no change to `src/proxy.ts`, no Katana/Woo/QBO/Clover import in the intake graph, the viewer chunk absent from first load, and the handback delivered.

---

## APPENDIX A — Contracts (shapes only; the Builder writes the code)
```ts
type IntakeErrorCode =
  | "NOT_SIGNED_IN" | "VALIDATION" | "PROJECT_REQUIRED" | "PROJECT_NOT_FOUND"
  | "PROJECT_CLOSED" | "PROJECT_LOCKED" | "FINISHES_REQUIRED" | "FILE_REQUIRED"
  | "FILE_TYPE" | "FILE_TOO_LARGE" | "PDF_INVALID" | "COLLECTION_INVALID"
  | "PRODUCT_TYPE_INVALID" | "DUPLICATE_PIECE" | "DUPLICATE_PRODUCT"
  | "CONFLICT_RETRY" | "UPSTREAM_BUSY" | "STORAGE_FAILED" | "INTERNAL";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: IntakeErrorCode; message: string; ref: string;
      fieldErrors?: Record<string, string>; retryAfterSeconds?: number;
      details?: unknown /* only typed, user-safe prompt data, e.g. the duplicate prompt */ };
```
| Code | HTTP (routes) | Catalog message (copy.ts) |
|---|---|---|
| `NOT_SIGNED_IN` | 401 | "Please reopen this page from GoHighLevel." |
| `VALIDATION` | 400 | "Please check the highlighted fields." |
| `PROJECT_REQUIRED` | 400 | "Choose the client project first." |
| `PROJECT_NOT_FOUND` | 404 | "We couldn't find that client project in GoHighLevel." |
| `PROJECT_CLOSED` | 409 | "That client project is closed, so pieces can't be added to it." |
| `PROJECT_LOCKED` | 409 | "This project was already sent to production. Ask an Ops Manager about a change order." |
| `FINISHES_REQUIRED` | 400 | "Choose the frame, powder coat and fabric, or pick TBD and add a note." |
| `FILE_REQUIRED` | 400 | "Add a 3D model (.glb or .blend), and the factory order PDF for client pieces." |
| `FILE_TYPE` | 400 | "That file type isn't supported here." |
| `FILE_TOO_LARGE` | 413 | "That file is too large. The limit is 25 MB." |
| `PDF_INVALID` | 422 | "That file isn't a readable PDF. Export it again and retry." |
| `COLLECTION_INVALID` / `PRODUCT_TYPE_INVALID` | 400 | "Pick one of the listed options." |
| `DUPLICATE_PIECE` / `DUPLICATE_PRODUCT` | 409 | (prompt, not an error banner; see Task 10) |
| `CONFLICT_RETRY` | 409 | "Someone else just changed this. Please try again." |
| `UPSTREAM_BUSY` | 503 | "GoHighLevel is busy. Try again in a moment." |
| `STORAGE_FAILED` | 502 | "The upload didn't finish. Please try again." |
| `INTERNAL` | 500 | "Something went wrong on our side." (always followed by "Reference {ref}") |

Item and SKU data model summary (no schema change):
- `custom_build_jobs` 1:1 with the GHL opportunity (`ghl_opportunity_id` unique). `client_slug` set once. `packet_storage_path` = latest factory-order PDF key.
- `custom_build_job_items` 1:N pieces (`global_sku` unique, `quantity`, `design_status`).
- `sku_mappings.attributes`: `custom_build`, `job_id`, `finishes { frame, powder, fabric }` (SKU or `{ tbd: true, note }`), `intake { key, fingerprint, actor, finishesPending, packet?, variantOf?, createdAt }`.

## APPENDIX B — Lexicon and banned terms
**Banned in all embed user-visible strings (case-insensitive unless noted):** `airlock`, `mint` (and `minted`, `minting`), `slug`, `quarantine`, `katana`, `dossier`, `hygiene`, `GEOM_` (case-sensitive), `global sku`, `hub sku`, `SKU` (case-sensitive standalone word), `BOM` (case-sensitive standalone word), `attestation`, `blocking code`, `opportunity` / `opportunities` (the UI says "client project"), `saga`, `webhook`, and any raw `UPPER_SNAKE_CASE` status or error code.

| Developer term | Human term |
|---|---|
| Airlock / Start Airlock Intake | Add a 3D model |
| Mint Custom Job | For a client project |
| Promote to Catalog | Standard catalog product |
| Client Slug / Item Slug | Client project (picked) / Piece name |
| Display Name (Optional) | Name on the order (required) |
| Original Name / Category / Collection | Product name / Product type / Collection |
| Length / Depth | Overall length (in) / Depth (in) |
| SKU / Global SKU | Item code (read-only) |
| Identity & CAD / Cut List Verification / Operations & Logistics / Release Gate | Piece & 3D model / Materials check / Build steps & shipping / Final review |
| Quarantine Gate Attestation | Ready-to-build checklist |
| Identity: Product and CAD match precisely | This is the right piece and the right 3D model |
| Cut List: Material yield has been verified | The material list looks right |
| Operations: Routing and times are scheduled | The build steps and times look right |
| Acknowledgement: finalizing (no Katana write) | I understand this marks the design complete. Production starts after the deposit. |
| Acknowledgement: releasing to live Katana production | I understand this sends the piece to the factory floor. |
| Blocking Codes Prevent Release | Fix these before sending to the factory |
| `MISSING_ROOT_META` etc. | A plain sentence per code (map in `copy.ts`) |
| GEOM_HYGIENE / Rejected Geometry Nodes | Some parts can't be measured / Parts we couldn't read |
| Force rename to {sku}.* / Replace catalog image | (hidden, automatic) |
| Release to Katana / Finalize design (no Katana write) | Send to production / Mark design complete |
| Katana Recipe: … (Mode: log) | Production recipe: Ready / Waiting / Not set up |
| WooCommerce Sync / Primary Image | Website listing / Product photo |
| BOM Certified / Custom Line / Snapped to | Matches an existing product / Needs a new design / Matched: {name} |
| draft_ready / queued / processing | 3D model read / Waiting to be read / Reading your 3D model… |
| Factory order PDF (packet) | Factory order (PDF) |
| Collision | This product already exists |
| Frame / Powdercoat / Fabric | Frame / Powder coat / Fabric |

## APPENDIX C — Design system: "Soft UI with floating cards and animated gold beams"
**Provenance.** These tokens are taken from the shipped code, not from the video reference attached to the request (the MP4 could not be reviewed in this environment). The Operator must visually review the Builder's screenshots against the video.
- **Canvas:** `bg-slate-50 text-slate-800` (`canvas` in `src/app/admin/factory-bom/factory-bom-ui.ts`). Headings `text-zinc-800`, secondary `text-zinc-500`, item codes in the mono `ticket` style.
- **Wizard container:** `glassCard` = `bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.06)]`.
- **Floating cards (inner):** `relative overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]` (the `floatCard` pattern in `InventoryCard.tsx` and `DispatchPortal.tsx`); selectable cards add a gentle hover lift (`hover:-translate-y-0.5`, 150 ms) and a selected ring `ring-1 ring-[#C5A059]/40`.
- **Gold beam:** a 2 px line along the top edge of a card: `pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden` containing `animate-beam-glide-lux absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-[#C5A059] to-transparent` (`beam-glide-lux`: 4 s ease-in-out infinite, `translateX(-100%)` to `220%`, in `globals.css`). Implement once as `src/components/ui/GoldBeam.tsx`. Use it on the **active** card, the **selected** intent card and the **progress** card only, never more than two beams on screen. Disabled under `prefers-reduced-motion`.
- **Buttons:** primary `continueButton` (slate-800, tactile press); secondary `tactileButton`; tertiary `quietButton`; `releaseButton` (emerald) only for the final "Send to production". Minimum height 44 px (`min-h-11`).
- **Fields:** `softField`. **Pills:** `pill`. **Banners:** `emeraldBanner` for success; matching amber (`border-amber-200 bg-amber-50 text-amber-800`) and rose (`border-rose-200 bg-rose-50 text-rose-800`) variants for warnings and errors, same radius and padding.
- **Motion:** `framer-motion` for 150–200 ms step transitions only, through `useReducedMotion`. No other animation libraries.
- **Forbidden:** the dark `.pim-glass` / `.pim-input` styles, new color palettes, emoji, and raw status words as labels.

## APPENDIX D — File inventory
**Create**
- `src/lib/intake/{copy,types,naming,files,glb-summary}.ts`
- `src/components/ui/GoldBeam.tsx`
- `src/server/factory-bom/intake/{errors,actor,create-intake,load-subject,taxonomy,finishes,packet,project-status}.ts`
- `src/server/ghl/{parse,search-opportunities,fetch-intake-opportunity}.ts`
- `src/server/master-catalog/create-product-core.ts`
- `src/app/embed/factory-bom/actions.ts`
- `src/app/embed/factory-bom/api/{opportunities,finishes,sku-check}/route.ts`
- `src/app/embed/factory-bom/intake/{IntakeWizard,DropStep,IntentStep,ClientDetailsStep,CatalogDetailsStep,ModelCard,PacketSlot,OpportunityCombobox,FinishSelect,Combobox,CollisionPrompt,UploadProgress}.tsx`, `intake/{useDebouncedFetch,upload-xhr,nav}.ts`, `intake/viewer/ModelViewer.tsx`
- `src/app/embed/factory-bom/DesignWizard.tsx` (replaces `AirlockWizard.tsx`)
- `scripts/qa/check-embed-bundle.ts`
- Tests: `tests/{intake-p0-regressions,intake-errors,intake-actor,intake-naming,intake-glb-summary,intake-files,intake-ghl,intake-taxonomy,intake-finishes,intake-create-client,intake-create-catalog,intake-packet,intake-cad-wrapper,intake-routes,intake-actions-scope,intake-static-guards,embed-copy-guard}.test.ts`, `tests/e2e/embed-intake.spec.ts`, `tests/fixtures/{ghl-opportunity-search.mock.json (Operator), embed-copy-allowlist.json}`
- `phase_12_handback_report.md`

**Modify**
- `src/app/embed/factory-bom/page.tsx`; `steps/Step1Cad.tsx`, `Step2Materials.tsx`, `Step3Operations.tsx`, `Step4Release.tsx`
- `src/app/admin/factory-bom/actions.ts` (P0 fix of `beginAirlockIntake`; optional `actorEmail` on `requestCadUpload`/`confirmCadUpload`; removal of `beginAirlockIntake` and `uploadFactoryPacketAction` at the end)
- Shared admin components only if Task 11's audit requires a `variant="embed"` (list them in the handback)
- `src/app/admin/path-a/actions.ts` (`FINISHES_PENDING` blocking code only)
- `src/server/path-a/item-store.ts` (`ensureItem` optional `quantity`)
- `src/server/factory-bom/mint-custom-job.ts`, `promote-to-catalog.ts` (typed `dbTx`, `original_name`, `source_file`, no-orphan rule, `@deprecated`)
- `src/app/embed/admin/master-catalog/actions.ts` (`createNewProduct` becomes a wrapper over the core)
- `src/app/globals.css` (reduced-motion rule for the beam)
- `package.json` and the lockfile; `.env.example`; `scripts/qa/proof-of-life.runner.ts` (additive step)

**Delete (after Task 12 is green)**
- `src/app/embed/factory-bom/{FunnelFork,IntakeDropzone,PacketLines,AirlockWizard}.tsx`

**Must NOT change:** `src/proxy.ts`, `src/server/ghl/search-hold-targets.ts`, `src/server/factory-bom/list-factory-products.ts`, `src/lib/katana.ts`, any Inngest function, `src/server/db/schema.ts`, any migration, `docs/MDM_MASTER_BLUEPRINT.md`, `FINAL_INTEGRATION_ROADMAP.md`, `CLAUDE.md`.

## APPENDIX E — Observations (found during the audit; NOT fixed in this phase)
1. `createNewProduct` (`src/app/embed/admin/master-catalog/actions.ts`) performs no session check of its own. Task 7 wraps it in a core without changing that behavior; the Architect recommends a Phase 13 fix.
2. `searchGhlHoldTargets` (showroom) can return GHL's raw error text to the browser. The intake routes do not; the showroom should be aligned in Phase 13.
3. `Step4Release.tsx` runs the server-side `evaluateAirlock` engine in the browser bundle. Phase 12 only lazy-loads it; moving it server-side is a later phase.
4. Embed authentication relies on a third-party (partitioned) cookie. Browsers that block it (notably Safari) cannot use any embed endpoint, existing ones included. Not changed here.
5. `searchHoldTargets` fans out to up to 8 GHL calls per query. The new picker uses at most 2; the showroom should be reviewed for GHL rate limits.
