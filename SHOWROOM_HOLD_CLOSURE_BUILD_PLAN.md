# Showroom Hold Closure

**Document:** `SHOWROOM_HOLD_CLOSURE_BUILD_PLAN.md`  
**Authoring phase:** `hold-closure-blueprint`  
**Intent:** Execution blueprint for the remaining Mission Control packet and the showroom-hold gaps. This phase writes no application code.  
**Allowed files this phase:** `.cursor/phase.lock`, `SHOWROOM_HOLD_CLOSURE_BUILD_PLAN.md`  
**Target test this phase:** `npm run typecheck`  
**Expected blast radius this phase:** `2`  
**Binding architecture:** `docs/MDM_MASTER_BLUEPRINT.md`. Do not implement the V8 transactional bus.  
**Stack (grounded):** Next.js `16.3.2` App Router, Drizzle, Supabase Postgres via `POSTGRES_URL`, Inngest, Tailwind 4. `PROJECT_STATE.md` matches `package.json`.

`mc-6d-issues-inbox` is committed at `beab2f9`. `MISSION_CONTROL_BUILD_PLAN_6.md` remains the spec for `mc-6e-escalation-modal`. This file does not rewrite that packet. Implementation of the packets below starts only after the director accepts this file. Each packet is one fresh chat, one lock written by `node .cursor/skills/phase-lock/scripts/write-lock.mjs`, at most 8 `allowed_files` unless `override_blast_cap` is true, and `expected_blast_radius` equal to the actual diff. `node .cursor/skills/qca/scripts/qca.mjs` is the only certification authority. Exit code 2 stays `DEFECT_REJECTED`. Commit a packet only after that script prints `CERTIFIED` and `audit_exit` 0. Before every audit, `git restore` `.cursor/logs/qca-last.log` and `.cursor/session-stamp.json` when they are dirty. Do not commit `.cursor/aar.json`, `.cursor/logs/qca-last.log`, or `.cursor/session-stamp.json`.

Antigravity executes the packets in order: `mc-6e-escalation-modal`, `hold-7a-mdm-exception`, `hold-7b-convert-by-kind`, `hold-7c-webhook-phantom`, `hold-7d-compensate-orphan`, `hold-7e-ledger-inbox`.

---

## 0. What the audit found

`createHold` in `src/server/stock/create-hold.ts` already routes a live product variant to `POST /sales_orders` and a material variant to a negative `POST /stock_adjustments` at CC Manufacturing `98179`. The house customer on that call is `CC Patio Showroom Hold`. The opportunity name is written into the adjustment `reason` and `additional_info`. The adjustment body does not send `customer_id`.

`convertOneHold` in `src/server/stock/convert-holds.ts` always calls `deleteHoldSalesOrder`. A material row stores the adjustment id in `katana_dummy_so_id` and the flag `stock_adjustment` in `converted_order_no`. A 404 from `GET /sales_orders/{id}` is treated as absent, the row becomes `converted`, and the negative adjustment remains. `src/server/ghl/push-factory-order.ts` and `sweepStuckConverting` in `src/server/stock/sweep-expired-holds.ts` both call `convertOneHold`. Those callers stay untouched. The convert packet fixes the callee.

`POST /api/webhooks/katana` releases a ledger row only for `stock_adjustment.deleted` when the number matches `HOLD-` plus 8 hex characters and `converted_order_no` is still `stock_adjustment`. A missing number is a 400. There is no `sales_order.deleted` handler. A row in `converting` is ignored. `released_by` is `katana-webhook` and `release_reason` is `manual`. The release-reason enum is not extended.

`fetchFailedPublishJobs` requests only `function_id=ccpatio-middleware-publish-approved-product`. `inventory_holds.last_error` is not an inbox source. Hold crons `send-hold-expiration-warnings`, `auto-release-expired-holds`, and `sweep-expired-inventory-holds` are outside that query.

`docs/MDM_MASTER_BLUEPRINT.md` §2.2 and §2.4 still forbid `POST /stock_adjustments`. `docs/SOFT_HOLD_ARCHITECTURE.md` still says the design is proposed. The material path is already in the code. Packet `hold-7a-mdm-exception` records the exception. It does not add a second writer.

If Katana creates the document and the ledger insert fails, `create-hold.ts` tries a compensating delete. If that delete throws, the document exists with no row. Packet `hold-7d-compensate-orphan` attempts one ledger insert so the later inbox can see it.

Both crons stay. The open showroom grid does not poll. Validation status 422 inside `src/lib/katana.ts` stays. The walk-in name stays in the adjustment reason text. Embed identity stays the shared embed key plus a server-side GoHighLevel user lookup.

---

## 1. Shared invariants

Every packet below inherits these. A packet QCA that passes typecheck, lint, and the target test is still `DEFECT_REJECTED` when an auditor finds one of these in the diff.

1. **Lock before code.** `phase_id` is the packet id. `expected_blast_radius` equals the allowed-file count. `base_ref` is `HEAD`. `override_blast_cap` is false. The worktree is clean before `write-lock.mjs`, or the script refuses the lock.
2. **Diff equals the lock.** `.cursor/aar.json` is excluded from the count. `.cursor/session-stamp.json` and `.cursor/logs/qca-last.log` are restored before the audit and are never committed.
3. **Role gate stays server-side.** Mission Control actions call `requireMissionControlAuth`. `Ops_Manager`, `Designer`, a missing row, and `ghl-embed@ccpatio.com` stay out.
4. **Read the hub. Do not drive a new bus.** No V8 bus, no Woo order webhook, no new `channel_sync.channel`, no pgsodium, no factory-airlock edits, no new `inventory_hold_release_reason` value.
5. **Secrets stay off the wire.** Inbox copy, action results, and logs do not contain a vendor token, a refresh token, or an `Authorization` header.
6. **Document kind is read before it is overwritten.** `converted_order_no` holds `sales_order` or `stock_adjustment` until conversion writes the real `GHL-` order number.
7. **Certification.** Exit 2 is not renamed. `npm run qa:lifecycle` runs after QCA only when the packet edits a route, server action, schema, or UI component. This authoring packet does not run it.

### Director steps that apply to every packet

- Accept this file before `mc-6e-escalation-modal` starts.
- Accept each packet’s QCA JSON before asking for that packet’s commit. One packet per chat.
- In the Katana account, confirm a webhook posts to `https://<production-host>/api/webhooks/katana` with the same secret as Vercel `KATANA_WEBHOOK_SECRET`. Subscribe `stock_adjustment.deleted` before the floor check. Add `sales_order.deleted` only after `hold-7c-webhook-phantom` is deployed. Do not put the secret in `.env.local` or in chat.
- In Vercel, confirm `KATANA_WEBHOOK_SECRET` is set on the production project. Do not paste the value back.
- Leave `GHL_FACTORY_ORDERS` at `log` until a live factory push is an explicit request. Conversion code is still reached by the sweeper when an intake already has a Katana sales order id, so `hold-7b-convert-by-kind` is not optional because the flag is `log`.
- After `hold-7c-webhook-phantom` is deployed, delete a `HOLD-` stock adjustment and confirm a refresh of `/embed/showroom` drops that hold. Delete a `HOLD-` sales order and confirm the same. The open grid does not live-update. Refresh is required.
- After `hold-7b-convert-by-kind` is deployed, convert one material hold on a test opportunity and confirm the negative stock adjustment is gone in Katana and the ledger row is `converted`.

### Agent steps that apply to every packet

- Read this file and `.cursor/phase.lock`.
- Restore `.cursor/logs/qca-last.log` and `.cursor/session-stamp.json` when `git status` shows them.
- Write the lock from a JSON payload whose `allowed_files` are exactly the list in that packet.
- Edit only those files.
- Run `node .cursor/skills/qca/scripts/qca.mjs` and transcribe the JSON verbatim.
- On `DEFECT_REJECTED`, fix the listed violations and run the audit again. Do not commit.
- On `CERTIFIED`, commit only the allowed files after the director asks.

---

## 2. Packet `mc-6e-escalation-modal`

Specified in `MISSION_CONTROL_BUILD_PLAN_6.md` section 6. This file does not change that spec.

| | |
|---|---|
| Intent | A button on `/mission-control` opens a modal. Submitting calls `sendOhCrapAlert` with reason `unknown`, source `system`, a short message, and `resolutionPath` `/mission-control`. The modal closes on `{ ok: true }` and shows the error string on failure. It does not collect a vendor key. |
| Target test | `npx vitest run tests/mission-control-escalation.test.ts` |
| Blast | 5 |

Allowed files:

- `.cursor/phase.lock`
- `src/app/mission-control/escalation-action.ts` — create. `requireMissionControlAuth`, then `sendOhCrapAlert`. The message is trimmed, at most 500 characters, and rejected when empty.
- `src/components/mission-control/EscalationModal.tsx` — create. Native `<dialog>` or an in-page dialog with a label, a textarea, submit, and cancel. Focus returns to the button on close.
- `src/app/mission-control/page.tsx` — mount the button in the header. Do not change the role redirect.
- `tests/mission-control-escalation.test.ts` — create. Empty message is refused. A valid message calls `sendOhCrapAlert` once. The action rejects `Ops_Manager` before send.

QCA invariants from the Mission Control plan:

- No new email provider, no webhook, and no DLQ table. `sendOhCrapAlert` is the only sender.
- The modal is not rendered under `/embed` and does not use `window.open`.
- `OH_CRAP_ADMIN_EMAIL` is read inside the existing helper. The client does not pass the destination address.
- The page stays `force-dynamic` and unframeable.

Agent steps: implement those four files, run QCA, then `npm run qa:lifecycle` because the page and the action change. Director steps: open `/mission-control` as `SuperAdmin` or `IT_Admin`, submit a short message, and confirm the modal closes on success. Phase 6 is closed only after that commit.

---

## 3. Packet `hold-7a-mdm-exception`

Docs only. Authorize the showroom material hold the code already performs.

| | |
|---|---|
| Intent | `POST /stock_adjustments` stays forbidden for fabric relief, migration, shipping, invoicing, and fulfillment. It is allowed only for a showroom material hold. |
| Target test | `npm run typecheck` |
| Blast | 3 |

Allowed files:

- `.cursor/phase.lock`
- `docs/MDM_MASTER_BLUEPRINT.md` — §2.2 and §2.4. The exception is a negative quantity, location `98179`, number `HOLD-` plus 8 hex characters, house customer `CC Patio Showroom Hold`, opportunity name in `reason` and `additional_info`.
- `docs/SOFT_HOLD_ARCHITECTURE.md` — replace the proposed banner with the implemented behavior, including that a material hold reduces on-hand and a later stocktake can erase it.

QCA invariants:

- No application code and no schema change.
- The legacy fabric freeze `MIG-HOLD-FABRIC-20260811` / `52594042` stays a sales-order line PATCH. It is not a stock adjustment.
- This packet does not run `npm run qa:lifecycle`.

Director steps: read the two edited sections and accept the exception in writing before `hold-7b-convert-by-kind` starts. No Katana click.

---

## 4. Packet `hold-7b-convert-by-kind`

| | |
|---|---|
| Intent | Conversion deletes the recorded Katana document. A 404 from the other endpoint is not success. |
| Target test | `npx vitest run tests/hold-convert-kind.test.ts tests/soft-hold-release.test.ts` |
| Blast | 4 |

Allowed files:

- `.cursor/phase.lock`
- `src/server/stock/convert-holds.ts` — read `converted_order_no` before the update that writes the real `GHL-` order number. `stock_adjustment` calls `deleteKatanaHoldDocument` and never `GET /sales_orders`. A 404 from the matching endpoint is absent and may convert. Any other status writes `last_error` and the row stays `converting`.
- `src/server/stock/delete-hold-order.ts` — `sales_order` or null keeps the existing guards: legacy fabric freeze `52594042`, `HOLD-` number match, not shipped, not invoiced, no manufacturing order.
- `tests/hold-convert-kind.test.ts` — create. Pure cases plus a Katana module mock in the style of `tests/publish-idempotency.test.ts`. Do not mock Drizzle.

QCA invariants:

- `src/server/ghl/push-factory-order.ts` and `src/server/stock/sweep-expired-holds.ts` are not edited. They already call `convertOneHold`.
- `tests/soft-hold-release.test.ts` still passes.
- A 404 from `GET /sales_orders/{adjustment id}` does not convert a material hold.
- Agent runs QCA, then `npm run qa:lifecycle`.

Director steps: after deploy, convert one material hold on a test opportunity. Confirm the negative adjustment is gone and the ledger row is `converted`.

---

## 5. Packet `hold-7c-webhook-phantom`

| | |
|---|---|
| Intent | A floor delete of a `HOLD-` sales order or stock adjustment releases the ledger. A missing number can match the stored document id. |
| Target test | `npx vitest run tests/katana-variant-webhook.test.ts tests/hold-webhook-release.test.ts` |
| Blast | 6 |

Allowed files:

- `.cursor/phase.lock`
- `src/server/katana/variant-webhook.ts` — accept `sales_order.deleted` the same way `stock_adjustment.deleted` is accepted. Match `HOLD-` plus 8 hex characters. When the number is missing and a positive document id is present, return that id for a ledger lookup.
- `src/app/api/webhooks/katana/route.ts` — release on either deletion. Signature failure stays 401. A missing secret stays fail-closed. `variant.updated` stays as it is. `revalidatePath` still covers `/showroom` and `/embed/showroom` after a release.
- `src/server/stock/release-hold.ts` — match `order_no` or, when only an id arrived, `katana_dummy_so_id` if `order_no` still matches the hold pattern and the stored kind matches the event. `converting` is not marked released. Write `last_error` on that row so `hold-7e-ledger-inbox` can show it. `released_by` stays `katana-webhook`. `release_reason` stays `manual`.
- `tests/katana-variant-webhook.test.ts` — extend the parser cases.
- `tests/hold-webhook-release.test.ts` — create. Number match, id match, kind mismatch ignored, `converting` keeps its status and gains `last_error`.

QCA invariants:

- No new enum migration.
- No second webhook route.
- Agent runs QCA, then `npm run qa:lifecycle`.

Director steps: add the `sales_order.deleted` subscription after this packet is deployed. Run the two refresh checks in section 1.

---

## 6. Packet `hold-7d-compensate-orphan`

| | |
|---|---|
| Intent | A Katana document that survived a failed ledger insert and a failed compensating delete gets one ledger row. |
| Target test | `npx vitest run tests/hold-compensate.test.ts` |
| Blast | 3 |

Allowed files:

- `.cursor/phase.lock`
- `src/server/stock/create-hold.ts` — only after the compensating delete throws, attempt one insert of the same hold id with status `releasing`, `release_reason` `manual`, `released_by` `compensate`, and `last_error` holding both failures, clipped to 500 characters. Store the Katana id and the `HOLD-` number. Do not create a second Katana document. If that insert also fails, log the error and return it. A successful compensate still returns the original failure and does not insert a row.
- `tests/hold-compensate.test.ts` — create. Compensate success inserts nothing. Compensate failure inserts one `releasing` row. A second insert failure is returned.

QCA invariants:

- No new table and no new status value.
- The error is not swallowed.
- Agent runs QCA, then `npm run qa:lifecycle`.

Director steps: none in Katana. A later inbox row is the signal if this path fires.

---

## 7. Packet `hold-7e-ledger-inbox`

Staff-visible hold failures. This packet does not reopen the 6D contract for catalog publish and `channel_sync`.

| | |
|---|---|
| Intent | The inbox also lists stuck hold rows and failed hold cron runs, in plain English. |
| Target test | `npx vitest run tests/mission-control-issues.test.ts tests/mission-control-hold-issues.test.ts` |
| Blast | 6 |

Allowed files:

- `.cursor/phase.lock`
- `src/server/mission-control/issue-copy.ts` — titles for the three hold function ids and for a ledger row. Raw provider bodies, `Bearer`, and `Authorization` stay stripped.
- `src/app/mission-control/inbox-action.ts` — also read `inventory_holds` rows whose `last_error` is non-empty and whose status is `active`, `releasing`, or `converting`. The client receives translated fields only.
- `src/components/mission-control/IssuesInbox.tsx` — render those rows. A ledger row can be marked seen in component state only. Retry stays on Inngest run ids. Nothing is deleted.
- `src/services/inngest-api.ts` — add a reader for `send-hold-expiration-warnings`, `auto-release-expired-holds`, and `sweep-expired-inventory-holds`. `fetchFailedPublishJobs` keeps `function_id=ccpatio-middleware-publish-approved-product`.
- `tests/mission-control-hold-issues.test.ts` — create. A ledger row with `Bearer` in `last_error` becomes the fixed sentence. A `pending` sync row stays absent. The publish function id query is unchanged.

QCA invariants:

- No Katana call from the inbox.
- No write to `inventory_holds` from this packet.
- `tests/mission-control-issues.test.ts` still passes.
- Agent runs QCA, then `npm run qa:lifecycle`.

Director steps: sign in as `SuperAdmin` or `IT_Admin`, open `/mission-control`, and confirm a known failed hold row renders a sentence. Confirm a `pending` sync row is still absent.

---

## 8. Residuals this file does not build

- `sweep-expired-inventory-holds` every 15 minutes and `auto-release-expired-holds` hourly both stay. Compare-and-swap is the guard. No third sweeper.
- The open showroom grid does not poll. Webhook `revalidatePath` applies on the next load.
- Validation status 422 inside `src/lib/katana.ts` stays. Split routing is not reopened.
- The walk-in name stays in the adjustment `reason` text. The Katana customer record stays the house account. No guessed `customer_id` field is added.
- Embed identity stays the shared embed key plus a server-side GoHighLevel user lookup. No signed menu URL.
- Vault encryption, QuickBooks, Woo order webhooks, and the V8 bus stay out.

---

## 9. Director gate

Accept this file, then open packet `mc-6e-escalation-modal` in a new session. The lock for that session is the five paths in section 2 and nothing else.
