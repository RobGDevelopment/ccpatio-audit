# Phase B1: WooCommerce Ingress and Katana Synchronization

Status: LOCKED (`.cursor/phase.lock`, `phase-b1`). Authority: `FINAL_INTEGRATION_ROADMAP.md` step 6 (Path B Link), operator directive of 2026-10-14.
Out of scope: QBO ledger (roadmap step 8), the Primeview integration manual, pillow fabrics, grade modifiers.

## 1. Binding operator decisions

| # | Decision |
|---|----------|
| D1 | Primeview owns the CPQ. Primeview has zero direct access to Katana. VividWorks is dead. |
| D2 | The only accepted finish keys are `fabric`, `powder_coat`, `frame`. Frame is a strict key mapping to a `MET-*` SKU (`MET-ALUM` or `MET-STEEL`). |
| D3 | `fabric` is required for upholstered items (20 to 30 fabrics). Pillow fabrics and grade modifiers are deferred. |
| D4 | The static `src/generated/global-e2e-skus.ts` is deleted. SKUs are validated against the live hub DB. |
| D5 | Base SKU rule: `item_type = 'finished_good'`, active, AND approved for web (`sku_mappings.sync_to_woo = true` OR a non-archived `ecommerce_listings` row). Anything else is quarantined. |
| D6 | Finish SKU rule: active, `item_type = 'raw_material'`, correct prefix for the slot, and `attributes.web_sellable === true`. |
| D7 | Katana SO: `order_no = WOO-<id>`, customer name + email + shipping address only, `price_per_unit = 0` on every row. |
| D8 | Katana MO: `createSubassemblies: true`. The code walks the MO tree and swaps the nested generic placeholder recipe rows (`RM-FAB-GENERIC`, `RM-PWD-GENERIC`) for the customer's SKUs. Strict: no swallowed errors. |
| D9 | Post-payment edits alert only. An `order.updated` delivery that arrives after the paid delivery was processed and changes the manufacturing fingerprint is quarantined as `post_payment_edit`. Never reprocessed automatically. |
| D10 | Quarantine replay is authorized: `/admin/quarantine` Server Action + UI for Woo orders. |
| D11 | `docs/CAPITAL_STACK_VENDOR_HANDOFF.md` (+ `.pdf`, + renderer script) is deleted. |

## 2. Interpretation notes (called out to the operator)

1. **"Any `order.updated` after paid processing"** is implemented as a *manufacturing fingerprint* comparison, not a blanket quarantine. WooCommerce fires `order.updated` on every status change, note, and stock adjustment (`processing` to `completed` is routine). Fingerprint inputs: line items (id, SKU, quantity, finishes), shipping address, customer name, customer email. A delivery with an unchanged fingerprint is acknowledged (200) and logged. A changed fingerprint is quarantined as `post_payment_edit` and alerted.
2. **Frame has no recipe swap yet.** No `RM-FRAME-GENERIC` placeholder exists in Katana today. Until one is provisioned, `frame` is validated (web_sellable `MET-*`), carried on the SO row attributes, and written to the SO `additional_info`, but no MO recipe row is swapped. The code swaps automatically if the placeholder appears in a recipe (`FRAME_PLACEHOLDER_SKU` in `finish-keys.ts`).
3. **Unsupported placeholders quarantine.** A recipe containing any `RM-*-GENERIC` placeholder that B1 cannot bind (e.g. `RM-DKT-GENERIC-SLAB`) is quarantined, not manufactured with a generic row.
4. **Non-physical keys are ignored; material-selecting near-miss keys are rejected.** `fabric_grade` and similar pricing metadata are ignored. Keys that select a physical material under a different name (`cushion_fabric`, `powder-coat`, `frame_type`, `dekton`, `pillow`, ...) quarantine the order, because silently dropping them would manufacture the wrong item.
5. **Customer phone is not sent to Katana** (D7 lists name, email, shipping address only). Woo `order_key` is no longer sent as `customer_ref` (it is an order-access token); `woo:<id>` is sent instead.

## 3. Structure

```
route.ts (ingress)
  1. req.text() once, signature, ping, JSON, topic filter
  2. structural parse (ingress.schema.ts, no SKU authority)
  3. extractWooLineSpecs (line-specs.ts + finish-keys.ts)      pure
  4. resolveWooOrder (sku-resolver.ts)                         DB, batched, injectable
  5. quarantine pending_review on any issue (quarantine-store.ts)
  6. classifyWooOrder; paid => decidePaidDelivery (paid-baseline.ts)
       first | redelivery  => inngest.send(id = woo:order:<id>:paid)
       unchanged           => 200 ack
       edited              => quarantine post_payment_edit + alert
woo-order.ts (Inngest saga)
  resolve-specs -> SO (price 0, attributes) -> per row: MO(createSubassemblies) -> bind-finishes-<row>
katana.ts
  bindMtoPlaceholderStrict: tree walk, throws on any failure, idempotent (already-bound is success)
/admin/quarantine
  woo-actions.ts: replay (pending_review), acknowledge (post_payment_edit), discard
```

## 4. Idempotency and SRE guardrails

- Inngest event id `woo:order:<id>:paid`; saga unique key; Katana `order_no` lookup with provenance check; per-row MO existence check (paged); bind step is a no-op when the specific variant is already on the tree.
- Replay refuses when a saga row or a processed baseline already exists for the order.
- No `catch` that swallows. Quarantine auto-resolve after a successful paid enqueue logs at error level on failure and never changes the response; every other failure throws or returns a structured error.
- Schema: no migrations. `quarantined_orders.status` has no DB check constraint (plain text since `0001`), so adding `post_payment_edit` to the Drizzle enum is additive and TS-only.

## 5. Sequencing

1. Lock + blueprint (this file).
2. Pure modules: `finish-keys.ts`, `line-specs.ts` (+ unit tests).
3. `sku-resolver.ts`, route refactor, baseline logic, delete static file and dependents.
4. Katana leg: payload, strict bind, saga steps.
5. Quarantine replay Server Action + UI.
6. Docs cleanup.
7. `npm run qa:lifecycle`, QCA.

## 6. Provenance of the deletions

`src/generated/global-e2e-skus.ts` dependents: `ingress.schema.ts` (rewired), `tests/sku-set.test.ts` (deleted), `src/server/katana/katana.service.ts` + `db-adapters.ts` (dead stubs, unreferenced by runtime code, deleted), `scripts/ops/execute-inventory-migration.ts` (warning-only check removed).
