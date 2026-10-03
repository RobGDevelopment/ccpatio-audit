# Commercial Document Lane — Architecture

**Status:** Accepted 2026-10-02. Decisions 1–36 were approved as written. §18 is now §2.5 of [`docs/MDM_MASTER_BLUEPRINT.md`](MDM_MASTER_BLUEPRINT.md). Phase 1 is in the tree: `quotes`, `quote_line_items`, and `/embed/order-desk`. Phases 2–8 stay blocked on the previous phase's exit.
**Audience:** Sales, dispatch, factory triage, management, and the engineer who implements the accepted slice.
**Binding SoT:** [`docs/MDM_MASTER_BLUEPRINT.md`](MDM_MASTER_BLUEPRINT.md) §2 and §3. This lane is a proposed exception. Until §18 is merged into that file, the blueprint wins and this document is a review draft.
**Companions:** [`docs/SOFT_HOLD_ARCHITECTURE.md`](SOFT_HOLD_ARCHITECTURE.md), [`docs/METAL_AND_LOGISTICS_CUTOVER_PLAN.md`](METAL_AND_LOGISTICS_CUTOVER_PLAN.md).
**Date:** 2026-10-02.
**Reviewed against:** the Drizzle schema, `/embed/showroom`, `/embed/dispatch`, `calculateFulfillmentOptions`, `inventory_holds`, `order_intake`, and `POST /api/webhooks/ghl`.

The sales and delivery portals share one commercial document per GoHighLevel opportunity. Supabase stores that document. Katana remains the inventory engine. GoHighLevel remains the CRM. Priority1 remains the carrier rater. Clover remains the tender. None of those systems is replaced, and none of them is read back as the price, the promise date, or the truck assignment.

---

## 1. Decisions to approve

Rejecting a row changes every later section that depends on it. Do not implement around a rejected row.

| # | Decision | Proposed plan |
|---|---|---|
| 1 | What this release is | A commercial-document lane: draft quote, freight snapshot, promise date, frozen revision, Clover collection, then the existing Katana path. It is not a second order bus. |
| 2 | System of record for the quote | Supabase `quotes`. GoHighLevel opportunity value may be updated after a save as a display mirror. The mirror is never read back into the quote. |
| 3 | System of record for stock | Katana, location CC Manufacturing `98179`. A showroom hold remains a `HOLD-` sales order plus an `inventory_holds` row. The quote stores `inventory_hold_id`. It does not create a second reservation. |
| 4 | System of record for a live delivery date | After conversion, the accepted promise is copied onto the Katana sales-order note (`additional_info`). It is not a manufacturing-order operation. `production_deadline_date` stays the factory finish date. |
| 5 | Where a draft lives | New `quotes` table. `order_intake` stays the factory document. A draft is not an intake row. |
| 6 | How many open quotes | One row per `ghl_opportunity_id` while status is `draft` or `sent`. Void and expired free the key. |
| 7 | How many factory orders | One `order_intake` per opportunity for the life of that opportunity, which is already the unique key. A second sale on the same opportunity is out of this release. |
| 8 | What "Won" does | Unchanged. Won does not create a sales order and does not delete a hold. |
| 9 | What opens the factory | A collected deposit on a quote that has at least one configured line inserts `order_intake` and stops. A person still maps `FIN-*` / `FAB-*` and Approve & Push still creates manufacturing orders. `GHL_FACTORY_ORDERS=log` still refuses the Katana write. |
| 10 | Stock-only payment | A quote whose every line is `stock_hold` converts on the deposit webhook: real sales order first, then delete each `HOLD-` order. No manufacturing order. |
| 11 | Mixed quote payment | Deposit does not create the Katana sales order. It claims the holds (`converting`) and inserts `order_intake`. Approve & Push creates the one `GHL-{opportunityId}` sales order that contains both the mapped lines and the held stock, then deletes the dummy orders. |
| 12 | Deposit versus balance | First collection is a deposit. `deposit_pct` defaults to 50. The Clover amount is the frozen deposit, not the grand total. Balance collection is a second checkout after `deposit_paid`. The truck is not scheduled from the deposit alone. |
| 13 | Tax | Not calculated in this release. The frozen total is merchandise plus freight. A tax-inclusive Clover charge is a later decision. |
| 14 | Who may override freight, promise date, or hold expiry | A signed-in operator whose `user_roles.role` is `Ops_Manager` or `SuperAdmin`. The shared embed key cannot authorize an override. |
| 15 | Hold expiry override | Writes `inventory_holds.expires_at` and clears `warning_sent_at`. Cannot pass `now + 90 days` (`HOLD_EXTEND_MAX_DAYS`). Cannot touch `released` or `converted`. |
| 16 | Auto-attach of holds | The first time a draft is created, every `active` hold on that opportunity becomes a line. Holds placed later show up as suggestions. They are not inserted into a draft the rep has already saved. |
| 17 | Hold swap order | Create the new `HOLD-` order first. Point the line at it. Then release the old hold. If the release fails, the new hold stays and the old hold remains visible for a retry. The swap does not delete the new hold to undo a failed release. |
| 18 | Miles | Delete the ZIP-prefix stub in the same change that turns freight on. An unknown ZIP has no miles and no freight total. There is no fallback that treats "everything else" as 1,200 miles. |
| 19 | Which freight option is applied | At or inside `local_radius_miles` (default 50): `LOCAL_WHITE_GLOVE` at `local_white_glove_fee` (default $150). Past local and at or inside `fleet_max_radius_miles` (default 500): `INTERNAL_FLEET` at the fleet tariff in decision 20. Past the fleet radius: the lowest Priority1 customer total. Inside the fleet radius the rep may switch to that LTL quote; the switch is stored on the quote. |
| 20 | Fleet tariff | Not invented here. Phase 3 cannot exit until management writes the numbers into `logistics_settings`: `fleet_base_fee`, `fleet_per_mile`, and `fleet_per_pound` (any of them may be zero). Price = base + per-mile × miles + per-pound × shipment weight, rounded to cents. |
| 21 | Rating cadence | Re-rate only when the input hash changes and the cache row is missing or expired. Debounce 1.5 seconds after the last edit. Cache TTL is 20 minutes. |
| 22 | Packaging for v1 | One pallet per quote. Weight is the sum. Freight class is the highest class. Footprint is the max length and the max width from `logistics_profiles`. Packed height is the explicit `quotes.packed_height_in`, default 40, and must sit between 36 and 45 or the rate is refused. Product heights are not summed and are not divided by line count. |
| 23 | Incomplete logistics | A line missing weight or a known NMFC class can sit on a draft and cannot be sent. Missing length or width blocks send the same way. The rater does not substitute 90×40. |
| 24 | Promise date | An estimate, not a reservation. Quote time does not consume `delivery_days` capacity. Copy: "Estimated delivery date if executed by [date]". Booking happens on the dispatch board after the goods are ready. |
| 25 | Promise formula | Ready date = executed-by date for an active stock hold, or executed-by plus `lead_time_days` for a configured line. Shipment ready date is the latest line. LTL adds the selected carrier `transitDays`. White-glove and fleet add `fleet_transit_days` (default 1). The shown date is the earliest `delivery_days` row on or after that target whose zone matches and whose remaining stops and weight can take the shipment. No zone, no capacity row, or null transit days blocks the promise. |
| 26 | Lead time source | New `logistics_profiles.lead_time_days`. Katana is not queried for a production schedule at quote time. A manufacturing order does not exist yet. |
| 27 | Send | Inserts an immutable `quote_revisions` row, then a `clover_checkouts` row in `pending`, and only then calls Clover. The charged amount is `quote_revisions.amount_due`. |
| 28 | Payment match | The webhook applies only when the Clover payment id is new and the amount matches `amount_due` to the cent. Any other amount is stored as `conflict` and does not touch Katana. |
| 29 | Lost before money | Lost or Abandoned releases `active` holds, voids a `draft` or `sent` quote, and expires the open checkout. |
| 30 | Lost after money | Holds in `converting` or `converted` stay. The Katana sales order stays. The quote is flagged `lost_after_payment`. A person handles the refund and any Katana cancellation. |
| 31 | Dispatch suggestion | Earliest truck-day in the ZIP's zone with remaining stop count and weight. Tie-break: a truck that already has a stop in that zone that day, then the truck with the most remaining weight. The dispatcher confirms. The suggestion does not assign itself. |
| 32 | Calendar replacement | `/embed/deliveries` is the dispatcher screen. Each confirmed stop stores the GoHighLevel appointment id written back. The board does not become the only place a rep can see the date. |
| 33 | Map | A view of `delivery_stops` after the board exists. Google does not own the route. Route optimization is not in this release. |
| 34 | Identity on a sales action | Same rule as holds. The stored rep is the GoHighLevel Users API result for `ghlUserId`. A display name from the browser is ignored. |
| 35 | Price | `quote_line_items.unit_price` is a numeric snapshot of `finished_goods_catalog.msrp` taken when the line is added. MSRP that does not parse blocks send. The `HOLD-` sales order stays at `pricePerUnit` 0. That zero is the reservation, not the customer price. |
| 36 | Access | New tables enable row-level security and `REVOKE ALL` from `anon` and `authenticated`, same as `logistics_profiles` and `inventory_holds`. The browser never queries them. Server code uses `getDb()` on `POSTGRES_URL`. |

---

## 2. What the lane is

A rep opens a GoHighLevel opportunity inside an iframe. The middleware loads or creates one draft quote for that opportunity. Lines, freight, and a promise date accumulate on that draft. Send freezes a revision and asks Clover for a deposit link. The payment webhook either converts stock or opens factory triage. Dispatch later schedules a stop from goods Katana says are ready.

The iframe is a client of the document. It is not where the document lives.

### 2.1 Ownership

| Fact | Owner | Write rule | Read-back rule |
|---|---|---|---|
| Contact, opportunity, pipeline stage | GoHighLevel | Opportunity value may be patched after a successful save or send | Never copy opportunity value, custom fields, or notes back over the quote |
| Quote, line prices, freight snapshot, promise, overrides, revision | Supabase | Server actions only | The page renders the quote row |
| On-hand and committed quantity | Katana location `98179` | Holds and the real sales order | Available = in-stock minus committed, as the showroom already does |
| Who reserved a unit, and when the reservation dies | `inventory_holds` | Existing create, extend, release, and convert functions | The quote line points at the hold id |
| Carrier rate and transit days | Priority1, then `freight_rate_cache` and `quotes.freight_snapshot` | One POST per cache miss | Expired cache is discarded |
| Tender | Clover | Checkout created for `amount_due` | Webhook must match that amount and the payment id |
| Truck stop and zone capacity | Supabase `delivery_stops` and `delivery_days` | Dispatcher confirmation decrements remaining capacity | The map reads stops. It does not write them |
| Delivery date on a live order | Katana sales-order `additional_info` | Copied once at conversion from the accepted promise | A later Katana edit does not rewrite the quote. A mismatch is a person' s job |
| Factory finish | Manufacturing order `production_deadline_date` | Existing factory push | Not used as the customer delivery date |
| Catalog item on Clover POS | `channel_sync` channel `clover` | Existing catalog fan-out | Unrelated to the checkout link |

### 2.2 What stays forbidden

These remain forbidden after this lane is approved. They are the cancelled transactional bus, and this document does not revive them.

- WooCommerce order webhooks. `POST` consumers for Woo orders stay closed.
- A QuickBooks invoice mutex, deposit matcher, or custom reconciliation queue.
- A custom dead-letter screen and `/api/admin/redrive`. Failed payment steps retry in Inngest. `payment_events.last_error` is the operator-visible reason.
- `POST /stock_adjustments`.
- A delivery operation, resource, or recipe row on a manufacturing order.
- Auto-push of a GoHighLevel Won stage.
- Treating `order_intake` as a shopping cart.
- Rating freight with invented pallet dimensions.
- Querying Katana for a production schedule on each quote keystroke.
- Authorizing a manager override from `ghlUserId` in the query string.

### 2.3 Portal map

| Portal | Today | This lane |
|---|---|---|
| `/embed/showroom` | Places and releases holds | Unchanged. Order Desk reads the rows it writes |
| `/embed/dispatch` | Freight form. Ready-to-ship list is hardcoded `SO-1001`, `SO-1002`, `SO-1003`. Miles come from `getEstimatedDistance` | Stays a rater until Phase 3 replaces the stub. It is not the fleet board |
| `/embed/order-desk` | Does not exist | Phase 1. Loads the quote for the opportunity id in the query string |
| `/embed/deliveries` | Does not exist | Phase 7. Zone board and confirmed stops |
| `/admin/order-triage` | Maps `FIN-*` / `FAB-*` and Approve & Push | Still the only place a configured line becomes a manufacturing order |
| `/admin/logistics` | Edits `logistics_profiles` and `logistics_settings` | Gains the fleet tariff and `lead_time_days` |

---

## 3. Current contracts this lane must not break

### 3.1 Showroom holds

The hold ledger is implemented. `docs/SOFT_HOLD_ARCHITECTURE.md` still says "proposed" in its header. The code is the contract. This lane calls that code. It does not invent a parallel hold.

| Rule | Value |
|---|---|
| Duration | 14 days from creation (`SHOWROOM_HOLD_TTL_DAYS`) |
| Extend | Another 14 days, and `warning_sent_at` is cleared |
| Maximum horizon | 90 days from now (`HOLD_EXTEND_MAX_DAYS`) |
| Warning | Inngest task while expiry is 24–48 hours out |
| Katana order number | `HOLD-` plus the first 8 hex characters of the hold UUID |
| Katana customer on the dummy order | Name `CC Patio Showroom Hold`, email `showroom-holds@ccpatio.com` |
| Price on the dummy line | `0` |
| Location | `98179` |
| Idempotency key | `soft-hold:{holdId}` |
| Lock | Postgres advisory lock on the variant id for the duration of create |
| Proof | After Katana accepts, committed quantity at `98179` must rise by the held qty or the dummy order is deleted |
| Statuses | `active`, `releasing`, `released`, `converting`, `converted` |
| Release reasons | `expired`, `lost`, `abandoned`, `manual`. Null while active, converting, or converted |
| Terminals | `released` and `converted` |
| Claim | `UPDATE … WHERE status = 'active'` (or the same intake already `converting`) |
| Lost / Abandoned | `POST /api/webhooks/ghl` releases active holds and does not insert `order_intake` |
| Conversion | `runApprovedFactoryOrder` claims holds, creates the real sales order, then deletes dummies. If the real sales order id was never stored, holds revert to `active` |
| Real order number | `GHL-{opportunityId}` |
| Factory gate | `GHL_FACTORY_ORDERS=live` is the only mode that calls Katana. `log` returns a dry run |
| Legacy fabric freeze | `MIG-HOLD-FABRIC-20260811` / id `52594042`. Showroom code refuses to delete it. This lane also refuses |

Create already compensates. If the ledger insert fails, the Katana dummy is deleted. A quote swap uses `createHold` and the existing release path. It does not POST a sales order on its own.

Anyone who can open the showroom may release a hold they did not place. `released_by` records who did it. This lane keeps that rule. A quote that still points at a released hold shows the line as unheld and blocks send until the rep attaches a live hold or removes the line.

### 3.2 Factory intake

`order_intake.ghl_opportunity_id` is unique. Statuses are `received`, `approved`, `pushed`, `failed`, `rejected`. A repeated Produce Factory Order webhook returns duplicate and does not reset a `pushed` row. `version` is the optimistic lock. Approve & Push refuses a stale version.

Mapped lines are `{ finSku, fabricSku, quantity }`. Push requires at least one mapped line. This lane does not relax that requirement for configured goods. Stock-only conversion is a different function (§11.2) because a stock order has no fabric line and must not call `createMakeToOrderManufacturingOrders`.

`additional_info` on the sales order already carries logistics as text, including Delivery Date, PU / DROP, Delivery Address, and the confirmation flags. Those lines are notes. They are not routing tasks. Conversion copies the accepted promise into that note. It does not add a delivery operation.

### 3.3 Freight as it works today

`calculateFulfillmentOptions(destZip, distanceMiles, skid)` in `src/server/freight/fulfillment.ts`:

| Distance | Options |
|---|---|
| `<= local_radius_miles` (default 50) | `LOCAL_WHITE_GLOVE` at `local_white_glove_fee` (default 150.00). Priority1 is not called |
| `<= fleet_max_radius_miles` (default 500), and outside local | `INTERNAL_FLEET` with `priceUsd: null`, plus a Priority1 option marked up by `ltl_handling_markup_pct` (default 15) |
| Beyond the fleet | Priority1 only |

Priority1 request:

| Item | Value |
|---|---|
| Endpoint | `POST https://api.priority1.com/v2/ltl/quotes/rates` |
| Origin | `85260` (`CC_PATIO_PICKUP_ZIP`) |
| Accessorials | `RESDEL`, `LGDEL`, `APPT` |
| Collapse | One pallet. Weight summed. Class is the highest. Length and width are the max. Height is the sum of item heights |
| Height gate | Packed height must be between 36 and 45 inches or `FreightRatingError` |
| Choice | Lowest `customerTotalUsd` |

`getEstimatedDistance` does not measure a road:

| ZIP prefix | Miles returned |
|---|---|
| `85` | 45 |
| `90` | 400 |
| anything else | 1200 |

The hardcoded queue disagrees with that function. `SO-1003` is ZIP `85255` at 15 miles, while `getEstimatedDistance("85255")` returns 45 because the ZIP starts with `85`. Phase 3 removes both the stub and the hardcoded queue from the path Order Desk uses. Leaving the stub as a fallback is a rejected implementation.

`DispatchPortal.toFreightSkid` forces every product onto a 90×40 pallet and divides 40 inches of height by the line count so the 36–45 gate still passes. That is a rating hack. Decision 22 replaces it.

`getQuotingProducts` already omits profiles that lack weight or a known class. It does not require length, width, or height. Send will, after decision 23.

Known classes are the check on `logistics_profiles`: `50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500`.

### 3.4 Katana rate limit

`katanaFetch` treats HTTP 429 as a rate limit. Bulk scripts install a pacer aimed at 60 requests per 60 seconds. The order path leaves the pacer unset and retries up to 3 times (`MAX_RATE_LIMIT_RETRIES`), waiting until the reset header or 65 seconds. Interactive quote traffic shares the token with catalog sync. This lane does not add a Katana read to the quote keystroke path.

### 3.5 Identity

`/embed/*` accepts `embedKey` and compares it to `GHL_EMBED_SECRET`. `getPimSession()` then yields one principal, `ghl-embed@ccpatio.com`. That principal proves the frame was launched with the key. It does not name the rep and it is not an `Ops_Manager`.

`user_roles.role` is `SuperAdmin`, `IT_Admin`, `Ops_Manager`, or `Designer`. There is no Sales role and no Dispatch role. Sales actions on the embed use the GoHighLevel user resolved server-side (decision 34). Override actions require a real operator session (decision 14).

`ghlUserId` in the menu URL is unsigned. The hold path already ignores a display name from the browser and re-fetches the user. This lane uses that same lookup. A person who knows another rep's id can still attribute a draft to that rep. Signing the query string is out of scope, as it already is for holds.

### 3.6 Money as it exists today

Clover integration upserts a POS catalog item when `sync_to_clover` is set. There is no checkout client and no payment webhook. `incoming_webhooks.source` allows `woocommerce` and `ghl` only.

`finished_goods_catalog.msrp` and `cost` are text. A quote cannot sum them in SQL without a parse. The snapshot on the line is the parse result. Unparseable text blocks send rather than becoming zero.

Hold lines post `pricePerUnit: 0` so the reservation does not look like a sale. Customer price lives only on the quote line.

---

## 4. Quote lifecycle

### 4.1 Statuses

| Status | Meaning | Stock holds | Editable lines |
|---|---|---|---|
| `draft` | Open working copy | `active` holds may be attached | Yes |
| `sent` | A revision exists and a checkout is pending or linked | Still `active` until money or Lost | No. Edit voids the revision and returns the quote to `draft` |
| `deposit_paid` | Deposit payment matched | Stock-only: `converted`. Mixed: `converting` on the new intake | No |
| `paid` | Balance payment matched | Unchanged from deposit | No |
| `converted` | Katana sales order id stored on the quote | `converted` | No |
| `void` | Rep or system killed the document | Released if they were still `active` | No |
| `expired` | Sent revision passed `expires_at` with no payment | Released if still `active` | No |

`deposit_paid` and `paid` exist because decision 12 splits the money. A stock-only quote can sit in `deposit_paid` with a Katana sales order already created, while dispatch still waits for `paid` and for goods-ready. If decision 12 is rejected in favor of "one payment for the grand total", drop `deposit_paid`, set `deposit_pct` to 100, and treat that single payment as both deposit and balance.

### 4.2 Optimistic lock

Every save from the iframe sends the `version` it loaded.

```text
UPDATE quotes
SET …, version = version + 1, updated_at = now()
WHERE id = :id AND version = :expected AND status = 'draft'
RETURNING *;
```

Zero rows is a conflict response, not a retry that overwrites. The client reloads. `sent` and later statuses reject line edits with a specific error. The void-and-redraft action is a separate server action, not a save.

### 4.3 Opening Order Desk

Query string, same menu pattern as the showroom:

```text
/embed/order-desk?embedKey=<GHL_EMBED_SECRET>&ghlUserId={{user.id}}&ghlUserEmail={{user.email}}&opportunityId={{opportunity.id}}
```

Server sequence:

1. Reject the request when the embed key or a direct operator session is missing.
2. Resolve the actor through the Users API. Fail closed when the user is missing or in another location. Do not fall back to the query-string name.
3. Load the opportunity from GoHighLevel. Reject lost and abandoned opportunities for a new draft. An existing `deposit_paid`, `paid`, or `converted` quote still opens read-only so the rep can see it.
4. Read `dest_zip` from the contact address. Store it when it is five digits. Leave it null when it is not. Do not invent a ZIP.
5. If an open quote exists (`draft` or `sent`), return it with its lines, the freight snapshot, the promise, and any unattached active holds as suggestions.
6. If none exists, insert `draft` at `version` 1 and, in the same unit of work, insert one line per `active` hold on that opportunity (decision 16).
7. Price each new line from `finished_goods_catalog.msrp`. A failed parse stores the line with `unit_price` null and `price_error` set.
8. Do not call Priority1, Clover, or Katana on open.

### 4.4 Suggestions after the first save

On later loads, an `active` hold whose id is not on a line is a suggestion. The rep adds it with an explicit action. That action sets `inventory_hold_id` and copies sku, variant, and qty from the hold. It does not create another `HOLD-` order.

A suggestion whose hold is `releasing`, `released`, `converting`, or `converted` is not offered.

### 4.5 Line kinds

| `line_kind` | Meaning | Hold |
|---|---|---|
| `stock_hold` | A finished unit reserved in the showroom | `inventory_hold_id` required before send |
| `configured` | A build that still needs fabric mapping | `inventory_hold_id` null |

Freight is not a line. A freight line would be collapsed into the pallet and rated as furniture.

Adding a configured line does not place a hold. Adding a stock line from the catalog, with no existing hold, asks the rep to confirm "Hold this from inventory?" Confirmation calls `createHold` with the opportunity already on the quote, then attaches the new id. Declining leaves the line as `configured` only when the rep explicitly says it is a build. A stock SKU without a hold and without that confirmation cannot be sent.

### 4.6 Removing a stock line

The server asks "Release the previous hold?" Confirmation calls the existing manual release. The line delete and the release are sequential, not one database transaction, because Katana sits in the middle. Order:

1. Compare-and-swap the quote line as `removing` only in application state for that request. The line row is deleted only after release returns success.
2. Release the hold (`manual`, `released_by` = actor).
3. Delete the line and bump `version`.

If release fails, the line stays and shows the hold error. The unit stays committed, which is the safe failure.

### 4.7 Swap

Rep changes the SKU on a line that already has a hold. The UI asks both questions from the brief: release the previous hold, and hold the new item. Both answers must be yes to proceed. No means the line is unchanged.

Server order (decision 17):

1. Version-check the quote. Status must be `draft`.
2. Load the old hold. It must be `active` and on this opportunity. Otherwise stop with the actual status (`expired`, `lost`, `converted`).
3. `createHold` for the new variant, qty, actor, and opportunity. This takes the advisory lock, checks availability, posts the dummy order, proves committed stock, and inserts the ledger row. Failure leaves the old line untouched.
4. Point `quote_line_items.inventory_hold_id` at the new hold and bump `version`.
5. Release the old hold.
6. If step 5 fails, keep the new hold on the line and return `previous_hold_still_active` with the old hold id. The page shows a retry. It does not delete the new Katana order.

Two swaps on the same variant serialize on the existing advisory lock. Two swaps on different variants lock in ascending `katana_variant_id` order inside the quote action before either `createHold`, so two reps cannot deadlock on a pair of variants.

### 4.8 Lost while a draft or sent quote is open

`POST /api/webhooks/ghl` already releases active holds. This lane adds, in that same request, after the release:

- If a quote for that opportunity is `draft` or `sent`, set it to `void`, set `void_reason` to `lost` or `abandoned`, and set any `pending` or `linked` checkout to `void`.
- Do this only for those two quote statuses (decision 29 and 30).

The webhook stays synchronous and idempotent. A second Lost delivery finds the holds already terminal and the quote already void, and returns 200.

---

## 5. Freight

### 5.1 When a rate runs

A draft rate runs after line, ZIP, packed height, or method edits, under these gates:

- Status is `draft`.
- ZIP is five digits.
- `distance_miles` is present and its source is `geocode` or `manual_override`. Source `stub` is not a valid source. The stub function is removed.
- Every line that counts toward freight has weight, known class, length, and width.
- `packed_height_in` is between 36 and 45 inclusive.
- The last edit was at least 1.5 seconds ago.
- The input hash is absent from `freight_rate_cache` or `expires_at` is in the past.

Failure stores `freight_error` on the quote and clears `freight_total`. It does not keep the previous total, because the previous total described different goods.

### 5.2 Input hash

SHA-256 of a canonical JSON object with sorted keys:

- origin ZIP `85260`
- destination ZIP
- distance miles to two decimals
- packed height to two decimals
- skid count (v1 is always 1)
- each item: sku, qty, weight, class, length, width
- accessorials `RESDEL`, `LGDEL`, `APPT`
- `local_white_glove_fee`, `local_radius_miles`, `fleet_max_radius_miles`, `ltl_handling_markup_pct`
- `fleet_base_fee`, `fleet_per_mile`, `fleet_per_pound`

Settings are inside the hash so a tariff change does not reuse a stale cache row.

### 5.3 Miles

New cache, one row per destination ZIP, origin fixed at `85260`.

Population is one distance lookup per new ZIP, stored with `fetched_at`. A stored row is reused for 30 days. The lookup is a server-side distance call from the dock ZIP to the destination ZIP. It is not the Maps JavaScript widget, and it is not `getEstimatedDistance`.

Until the lookup returns, `distance_miles` is null, `distance_source` is null, and freight is not rated. A manager may override miles (decision 14). The override sets `distance_source` to `manual_override` and writes `quote_overrides`. The cache row is not overwritten by an override, so the next quote to that ZIP still sees the measured miles.

### 5.4 Applied option

Implement decision 19 in `calculateFulfillmentOptions` by giving `INTERNAL_FLEET` a numeric price from decision 20. The function still returns the other legal options so the rep can switch to LTL inside the fleet radius. Order Desk writes the applied option onto the quote:

| Column | Contents |
|---|---|
| `freight_method` | The applied method |
| `freight_total` | The applied customer amount, unless an override replaced it |
| `calculated_freight_total` | The amount the formula produced. Overrides do not change this |
| `freight_snapshot` | The full `FulfillmentPlan`, including carrier name, code, broker total, customer total, and `transitDays` |
| `freight_input_hash` | The hash that produced it |
| `freight_quoted_at` | Timestamp of the rate |
| `selected_carrier_code` | Null for white-glove and fleet. The Priority1 `carrierCode` when the method is LTL |

Switching from fleet to LTL is a draft edit. It changes the hash inputs only in the selected method, which is stored beside the hash as `freight_method`. The cache still holds the plan. Switching does not require a second Priority1 POST when the plan is fresh.

### 5.5 Fleet formula

```text
freight = round_cents(
  fleet_base_fee
  + fleet_per_mile * distance_miles
  + fleet_per_pound * total_weight_lb
)
```

All three settings are `numeric`, non-negative, and required before Phase 3 is turned on for reps. Zero is a legal number. Null is not. Phase 3 ships the columns with null defaults and the rater refuses `INTERNAL_FLEET` until all three are set. That refusal is preferable to a silent $0 truck.

White-glove ignores the fleet formula and uses `local_white_glove_fee`.

### 5.6 What is not rated

- A quote with zero shippable lines.
- A line flagged `is_modular_component` on `logistics_profiles` is a component, not its own pallet piece, until a later release says otherwise. v1 excludes those rows from the skid and from the merchandise total only when the parent line is also on the quote. If a modular component is the only line, it is rated as a normal piece. This avoids dropping a part the rep quoted alone.
- Accessorial changes. v1 always sends residential, liftgate, and appointment. A commercial dock that does not need them is an override of the freight total, with a reason, not a new accessorial picker.

---

## 6. Promise date

### 6.1 What it is

The sentence on the quote is: "Estimated delivery date if executed by [executed_by]". `executed_by` defaults to the current date in `America/Phoenix`. The rep may move that date forward on a draft. Moving it re-runs the formula. It does not call Katana.

The date is not written to `delivery_days` and does not decrement capacity. Two quotes may show the same Tuesday. The dispatcher resolves that when the goods are actually ready (decision 24).

### 6.2 Inputs

| Input | Source |
|---|---|
| `executed_by` | Quote column. Default: Phoenix today |
| Stock line ready | `executed_by`, and only when the attached hold is `active` |
| Configured line ready | `executed_by + lead_time_days` calendar days |
| `lead_time_days` | `logistics_profiles.lead_time_days`, integer `>= 0`. Null blocks the promise for that line |
| Shipment ready | The latest line ready date |
| Transit | LTL: `transitDays` from the selected carrier in `freight_snapshot`. Null blocks the promise. White-glove and fleet: `logistics_settings.fleet_transit_days`, default 1 |
| Target day | Shipment ready plus transit days |
| Zone | `delivery_zones.zone_code` for `dest_zip`. Missing zone blocks the promise |
| Capacity | `delivery_days` rows for that zone with `service_date >= target`, `stops_booked < capacity_stops`, and `weight_booked_lb + shipment_weight <= capacity_weight_lb` |

`lead_time_days` is a planning constant the factory maintains on the logistics profile. It is not a live view of the fab schedule. After a manufacturing order exists, its `production_deadline_date` is the factory's date. If that date is later than the promise minus transit, triage shows the conflict. The automation does not silently move the customer date.

### 6.3 Selection

Among feasible `delivery_days` rows, pick the earliest `service_date`. If two trucks have that date, pick the truck that already has a `delivery_stops` row in the same zone on that date. If neither does, pick the truck with the largest remaining weight. The quote stores:

| Column | Contents |
|---|---|
| `calculated_promise_date` | The date the formula picked |
| `promise_date` | The date the customer is shown. Equals the calculated date until an override |
| `promise_truck_code` | The truck the formula assumed. Not a booking |
| `promise_formula` | A version string, starting at `promise-v1` |
| `promise_if_executed_by` | The `executed_by` used |
| `promise_calculated_at` | Timestamp |

No feasible day stores nulls in the calculated columns and sets `promise_error` to `no_capacity`. Send is blocked while `promise_date` is null.

### 6.4 Override

A manager sets `promise_date` to a specific date and writes a reason. `calculated_promise_date` stays. The override does not insert a stop and does not need a capacity row. The reason is how the shop explains a date the calendar did not offer.

---

## 7. Overrides and who may click them

### 7.1 Fields

| Field | Who | Effect | Limit |
|---|---|---|---|
| `freight_total` | Ops Manager, Super Admin | Shown freight becomes the typed amount. Snapshot and `calculated_freight_total` stay | `>= 0`, reason 1–500 characters |
| `promise_date` | Ops Manager, Super Admin | Shown date changes. Calculated date stays | A real date, reason 1–500 characters |
| `distance_miles` | Ops Manager, Super Admin | Re-rates with `distance_source = manual_override` | `>= 0` |
| `hold_expires_at` | Ops Manager, Super Admin | Updates that hold's `expires_at`, clears `warning_sent_at` | Not past 90 days from now. Hold must be `active` |
| `packed_height_in` | The rep, on a draft | Included in the rating hash | 36 through 45 |

Every manager override inserts `quote_overrides` and never updates a previous override row. The quote stores `freight_override_id` or `promise_override_id` pointing at the latest row. Clearing an override inserts a new row with `override_value` null and points the quote back at the calculated column.

### 7.2 How the role is checked

The embed principal is not in `user_roles`. Override actions call the existing operator session, not `embedKey`.

The action loads `user_roles` for the authenticated user id and allows `Ops_Manager` and `SuperAdmin` only. `IT_Admin` and `Designer` do not override price or dates. A missing role is a rejection. The client hides the control; the server still checks.

Hold expiry override is the existing extend path with an explicit timestamp instead of "plus 14 days", still capped at 90 days, still clearing the warning so it can fire again inside the 24–48 hour window.

---

## 8. Send and the frozen revision

Send is a server action on a `draft`.

Preconditions, all required:

- Actor resolved (decision 34).
- `version` matches.
- At least one line.
- Every line has `unit_price >= 0` and `qty > 0`.
- Every `stock_hold` line has a hold in `active` on this opportunity, and the hold qty equals the line qty.
- `freight_total` is non-null and `freight_quoted_at` is inside the cache TTL, unless a freight override exists. An override may outlive the cache. A calculated total may not.
- `promise_date` is non-null.
- `dest_zip` is five digits.
- No `order_intake` already exists for this opportunity. If one does, send fails with `opportunity_already_ordered`. v1 does not attach a second quote to a pushed intake (decision 7).

Then, in one database transaction:

1. Insert `quote_revisions` with the next `revision_no`, the full payload, `merchandise_total`, `freight_total`, `amount_due`, and `deposit_pct`.
2. Set the quote to `sent`, store `current_revision_id`, and bump `version`.
3. Insert `clover_checkouts` with `status = pending`, `amount = amount_due`, and `quote_revision_id`.

After commit, call Clover. On success, set the checkout to `linked` and store `clover_checkout_id` and `checkout_url`. On failure, leave `pending`, store `last_error`, and leave the quote `sent`. Retry reuses that checkout row. Retry does not create another revision.

`amount_due` for the first send:

```text
amount_due = round_cents((merchandise_total + freight_total) * deposit_pct / 100)
```

`deposit_pct` comes from `logistics_settings.deposit_pct`, default 50 (decision 12). The revision copies the percent so a later settings change does not alter what the customer was asked to pay.

### 8.1 Edit after send

"Edit" on a `sent` quote is a void of the open checkout and a return to `draft`. It inserts nothing into `quote_revisions` beyond marking that revision `voided`. The next send creates `revision_no + 1`. Holds stay `active`. A `linked` Clover session is expired before the quote returns to `draft`. If Clover refuses the expire call, the quote stays `sent` and shows the error. The rep cannot have two live links.

### 8.2 GoHighLevel mirror

After a successful send, the server patches the opportunity monetary value to `merchandise_total + freight_total` when the private integration token has opportunities write. Failure stores `quotes.ghl_sync_error` and does not roll back the revision. The page shows that the CRM value was not updated. The quote total remains the one on the revision.

The token today is specified for users, contacts, and opportunities read. Write scope is a Phase 5 setup task. Phase 1 does not depend on it.

---

## 9. Clover and the payment webhook

### 9.1 Checkout row first

`clover_checkouts` exists before the HTTP call to Clover (decision 27). A webhook that arrives for an unknown `clover_checkout_id` is inserted into `payment_events` with status `ignored` and does not create a sales order.

### 9.2 Webhook

New route: `POST /api/webhooks/clover`.

- Verify the provider signature. The route stays unregistered in production until the verifier is implemented. A shared query-string secret is not the verifier.
- Parse the payment id and the amount.
- Insert `incoming_webhooks` with source `clover`. That means extending the source check from `woocommerce | ghl` to include `clover`. Idempotency key: `clover-payment:{paymentId}`.
- Insert `payment_events` with that `external_id`. A unique violation is a duplicate and returns 200 without a second Katana call.
- Compare the amount to `clover_checkouts.amount` for the checkout id on the event. Mismatch sets `payment_events.status = conflict` and stops.
- Match sets the checkout to `paid` and enqueues Inngest event `quote.payment.received` with the payment event id.

The HTTP handler does not call Katana. Inngest does, so a 429 retries the step instead of failing the webhook response after Clover has already charged the card.

### 9.3 What the payment means

| Quote contents | Deposit webhook | Balance webhook |
|---|---|---|
| Every line `stock_hold` | Run stock conversion (§11.2). Quote becomes `deposit_paid`. Holds end `converted` | Quote becomes `paid`. No second sales order |
| Any line `configured` | Insert `order_intake` if missing (§11.1). Claim holds. Quote becomes `deposit_paid`. No sales order yet | Quote becomes `paid`. Still no manufacturing order from this webhook |

Balance before deposit is a `conflict`. The customer paid the wrong checkout. A person sorts it out.

### 9.4 Race with Lost

Both the Lost webhook and the payment step claim holds with `WHERE status = 'active'`.

| Winner | Result |
|---|---|
| Payment claims the holds | Lost finds nothing `active`. If the quote is already `deposit_paid` or further, Lost sets `commercial_conflict = lost_after_payment` and does not delete the Katana order |
| Lost releases the holds first | Payment finds no `active` holds. `payment_events.status = conflict`, `conflict_reason = released_before_payment`. No sales order. The charge is a refund for a person |

There is no automatic refund in this release.

---

## 10. Factory document from a quote

### 10.1 Configured or mixed

On the deposit step, when any line is `configured`:

1. If `order_intake` already exists for the opportunity, stop with a conflict. Do not reset it.
2. Insert `order_intake` with `status = received`, `ghl_opportunity_id`, contact name and email from the quote, and `raw_payload` set to the revision payload so triage can see what was sold.
3. Set `quotes.order_intake_id`.
4. Claim active holds for that opportunity onto this intake (`converting`), the same `claimShowroomHolds` function the factory push already uses.
5. Do not fill `mapped_lines`. Triage still requires a person to map fabric.
6. Do not call `runApprovedFactoryOrder`.

Approve & Push stays the only caller of manufacturing-order creation. When it runs, it already claims holds and deletes dummies after the real `GHL-{opportunityId}` sales order exists. Holds this payment already moved to `converting` are included because `claimShowroomHolds` also returns rows this intake already claimed.

The sales order note written by that push gains the promise:

```text
Delivery Date: YYYY-MM-DD
Promise if executed by: YYYY-MM-DD
Freight method: LOCAL_WHITE_GLOVE | INTERNAL_FLEET | PRIORITY1_LTL
Freight total: 0.00
Quote revision: <uuid>
```

Existing note lines for address and confirmation flags stay. This lane does not invent new confirmation flags.

### 10.2 Stock-only

`convertStockQuote` is a new Inngest function. It is not `runApprovedFactoryOrder`.

1. Claim the holds onto a stock intake.
2. Insert `order_intake` with a new column `intake_kind = stock`. Existing rows default to `factory`. Stock kind is allowed to have empty `mapped_lines`.
3. Create the Katana sales order with order number `GHL-{opportunityId}`, location `98179`, one row per hold (variant, qty, and the quote line's `unit_price` as `pricePerUnit`), idempotency key `quote-stock:{quoteId}`.
4. Only after that id is stored, delete each `HOLD-` order through the existing delete path that refuses any order number other than the ledger's `HOLD-` value.
5. If step 3 fails before an id is stored, revert holds to `active`.
6. Copy the delivery note from §10.1.
7. Set the quote to `deposit_paid` and store `katana_sales_order_id` and `katana_order_no`.
8. Do not call `createMakeToOrderManufacturingOrders`.

`intake_kind = stock` occupies the unique opportunity key on purpose (decision 7). A later custom build on that same opportunity cannot open a second intake in this release.

### 10.3 Double conversion

A hold is deleted once. Stock conversion and factory push both use `converting` → `converted`. The second caller finds a terminal row and does not delete a customer order. The delete guard remains: load the sales order, continue only when `order_no` starts with `HOLD-` and equals the ledger value.

---

## 11. Dispatch board

`/embed/deliveries` replaces the dispatcher's use of the GoHighLevel calendar as the planning surface. It does not delete the calendar (decision 32).

### 11.1 Who is on the board

A stop is eligible when all of these are true:

- The quote is `paid`.
- A Katana sales order id is stored.
- Readiness is true.
- The stop is not `delivered`, `failed`, or `cancelled`.

Readiness:

| Order | Ready when |
|---|---|
| Stock-only | On-hand at location `98179` covers the sales-order lines. The goods were finished before the hold |
| Factory | The manufacturing-order header for that sales order is `DONE` |

Readiness is checked when the dispatcher opens the board and when a refresh runs, not on a per-keystroke Katana poll from every iframe. The board load is one Katana read per visible order, paced. A 429 leaves the previous `ready_at` in place and shows `katana_unavailable`. It does not mark the order unready.

`READY FOR DELIVERY` in the metal cutover means quality control and assembly are `COMPLETED` and the header is `DONE`. This board uses that header. It does not add a delivery task to get there.

### 11.2 Suggestion

For each ready, unscheduled stop:

1. Resolve `delivery_zones` from the quote ZIP.
2. Find `delivery_days` on or after today in `America/Phoenix` for that zone, with remaining stops and remaining weight.
3. Apply decision 31.
4. Insert or update the stop as `suggested` with `suggested_service_date` and `suggested_truck_code`.

Suggestion does not increment `stops_booked`. Confirmation does.

### 11.3 Confirm

The dispatcher confirms a suggested day or picks another day that still has room. The action:

1. Locks the `delivery_days` row.
2. Rechecks remaining capacity.
3. Increments `stops_booked` and `weight_booked_lb`.
4. Sets the stop to `scheduled` with `stop_sequence` equal to the next sequence on that truck-day. Sequence is by ZIP, then by quote id, so a manual reorder is a later enhancement. v1 does not drag stops.
5. Creates or updates the GoHighLevel appointment and stores `ghl_appointment_id`.
6. If the appointment write fails, roll back the capacity increment and leave the stop `suggested`. The truck is not booked in Postgres while the CRM write failed.

Unschedule reverses the increment and clears the appointment when the appointment API succeeds. Failure leaves the stop `scheduled` and shows the error.

### 11.4 Grouping

The board groups scheduled and suggested stops by `service_date`, then `truck_code`, then `zone_code`. Scottsdale on Tuesday is a zone plus a date plus a truck, backed by `delivery_zones` rows whose `zone_code` is whatever operations names (the code is data, not a hardcoded branch in the page).

### 11.5 Statuses

`suggested`, `scheduled`, `ready`, `dispatched`, `delivered`, `failed`, `cancelled`.

`ready` here means the dispatcher has acknowledged goods-ready on a scheduled stop. It is not the Katana header. `dispatched` means the truck left. `delivered` and `failed` are manual marks in v1. Telematics (the historical SOP names Samsara and Onfleet) are not integrated. If those systems are the live route tools, this board still owns the plan and those systems remain outside this release.

---

## 12. Map

Phase 8 draws `delivery_stops` for a selected day. Coordinates come from `delivery_zones.lat` and `lng`, filled by a server geocode of the ZIP when the zone row is created. The browser does not call Google with an API key embedded in the iframe.

The map does not assign trucks, reorder stops, or write `delivery_days`. Route optimization is a separate approval after real stops exist. Decision 33.

---

## 13. Edge cases

| Case | Required behavior |
|---|---|
| Two reps save the same draft | Second save sees a stale `version` and must reload |
| Two reps hold the last unit | Advisory lock plus the committed-stock proof. The loser gets the available-qty error. No ledger row |
| Sweeper expires a hold that is on a draft line | Line remains, hold status is `released`, send is blocked, suggestion does not re-add it |
| Rep releases a hold from the showroom while Order Desk is open | Next load shows the line unheld. The open page does not keep a phantom reservation |
| Swap create succeeds, release fails | New hold is on the line. Old hold stays `active` with a retry |
| Swap create fails | Old line unchanged |
| Priority1 returns no rates | `freight_error` set, total cleared |
| Priority1 429 or timeout | Same. Do not cache the failure for the full TTL. Cache failures for 60 seconds so a debounce storm does not hammer the broker |
| Packed height outside 36–45 | Refuse the rate. The rep or a manager sets `packed_height_in` inside the band |
| ZIP has no measured miles | No freight, no promise |
| ZIP has no zone | Freight may still rate. Promise is blocked with `no_zone` |
| No truck-day has room | Promise blocked with `no_capacity`. A manager may override the shown date |
| Settings change mid-draft | Hash changes, cache misses, a new rate replaces the total |
| Send clicked twice | Second call sees status `sent` and returns the existing revision and checkout url if linked |
| Clover call fails after the revision commit | Quote stays `sent`, checkout stays `pending`, retry reuses the row |
| Webhook replay | Unique `external_id` returns 200 and does not run Inngest again once `payment_events.status` is `applied` |
| Webhook for the wrong amount | `conflict`, no Katana write |
| Webhook before the checkout row exists | `ignored` |
| Lost and payment in the same minute | Status compare-and-swap. Loser follows §9.4 |
| Deposit on an opportunity that already has `order_intake` | Conflict, no second intake, no second sales order |
| `GHL_FACTORY_ORDERS=log` | Configured deposit still inserts intake. Approve & Push still dry-runs. Stock-only conversion also checks the gate and, in `log`, stores the intake and does not call Katana |
| Hold order number collision with a customer order | Delete path refuses anything that is not that row's `HOLD-` number |
| Legacy fabric order | Never deleted by this lane |
| MSRP blank or not numeric | Line saves, send blocked |
| Manager override then a re-rate | Calculated columns update. Shown freight or promise stays on the override until a manager clears it |
| Quote voided | Active holds on its lines are released. Converting and converted holds are not |
| Balance paid before deposit | Conflict |
| Dispatcher confirms a day that filled up | Capacity recheck fails, stop stays `suggested` |
| Katana 429 while checking readiness | Keep prior `ready_at`, show unavailable |
| Embed opened with someone else's `ghlUserId` | Accepted residual risk, same as holds. Overrides are unaffected because they ignore the query string |
| Change order after `pushed` | Out of scope. The unique opportunity key blocks a second intake |

---

## 14. Database

Drizzle definitions go in `src/server/db/schema.ts`. Generate with `npm run db:generate` and apply with `npm run db:migrate`. Do not create these tables from the Supabase SQL editor.

Every new table:

```sql
ALTER TABLE … ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE … FROM anon, authenticated;
```

No policies for `anon` or `authenticated`. The app role behind `POSTGRES_URL` is the writer, which is the same posture as `inventory_holds` and `logistics_profiles`.

Money columns are `numeric(12, 2)`. Quantities are `numeric(12, 4)`. Timestamps are `timestamptz`.

### 14.1 Enums

`quote_status`: `draft`, `sent`, `deposit_paid`, `paid`, `converted`, `void`, `expired`.

`quote_line_kind`: `stock_hold`, `configured`.

`distance_source`: `geocode`, `manual_override`.

`freight_method`: `LOCAL_WHITE_GLOVE`, `INTERNAL_FLEET`, `PRIORITY1_LTL`. Matches `FulfillmentMethod`.

`checkout_status`: `pending`, `linked`, `paid`, `void`, `expired`.

`payment_event_status`: `received`, `applied`, `conflict`, `ignored`.

`quote_override_field`: `freight_total`, `promise_date`, `distance_miles`, `hold_expires_at`.

`intake_kind` added on `order_intake`: `factory` default, `stock`.

`delivery_stop_status`: `suggested`, `scheduled`, `ready`, `dispatched`, `delivered`, `failed`, `cancelled`.

`incoming_webhooks.source` gains `clover`.

### 14.2 `quotes`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK, default random | |
| `ghl_opportunity_id` | text not null | Partial unique index where `status in ('draft','sent')` |
| `ghl_contact_id` | text not null | From the opportunity refetch |
| `ghl_opportunity_name` | text not null | Snapshot |
| `ghl_user_id` | varchar(128) not null | Actor at create |
| `ghl_user_name` | text not null | Users API |
| `ghl_user_email` | text | Users API |
| `status` | `quote_status` not null default `draft` | |
| `version` | integer not null default 1 | Bumped on every mutation |
| `dest_zip` | char(5) | Null until known |
| `distance_miles` | numeric(8, 2) | Null until measured or overridden |
| `distance_source` | `distance_source` | Null until set |
| `packed_height_in` | numeric(6, 2) not null default 40 | Check 36–45 |
| `merchandise_total` | numeric(12, 2) | Sum of line extended prices. Null if any line is unpriced |
| `freight_method` | `freight_method` | |
| `freight_total` | numeric(12, 2) | Shown amount |
| `calculated_freight_total` | numeric(12, 2) | Formula amount |
| `freight_snapshot` | jsonb | `FulfillmentPlan` |
| `freight_input_hash` | char(64) | |
| `freight_quoted_at` | timestamptz | |
| `freight_error` | text | |
| `selected_carrier_code` | text | LTL only |
| `freight_override_id` | uuid | FK to `quote_overrides`, null when showing the calculation |
| `executed_by` | date not null | Phoenix date the formula used as "if executed by" |
| `promise_date` | date | Shown |
| `calculated_promise_date` | date | Formula |
| `promise_truck_code` | text | Assumption, not a booking |
| `promise_formula` | text | `promise-v1` |
| `promise_calculated_at` | timestamptz | |
| `promise_error` | text | |
| `promise_override_id` | uuid | FK |
| `deposit_pct` | numeric(5, 2) | Copied onto the revision at send. Default from settings |
| `current_revision_id` | uuid | FK to `quote_revisions` |
| `order_intake_id` | uuid | FK to `order_intake` |
| `katana_sales_order_id` | integer | |
| `katana_order_no` | text | |
| `commercial_conflict` | text | `lost_after_payment` or null |
| `void_reason` | text | |
| `ghl_sync_error` | text | |
| `created_at`, `updated_at` | timestamptz not null default now() | |

Index `(ghl_opportunity_id)` for the load path, in addition to the partial unique index.

### 14.3 `quote_line_items`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `quote_id` | uuid not null FK `quotes.id` on delete cascade | |
| `line_no` | integer not null | Unique `(quote_id, line_no)` |
| `line_kind` | `quote_line_kind` not null | |
| `sku` | text not null | Stored uppercase |
| `katana_variant_id` | integer not null | |
| `qty` | numeric(12, 4) not null | Check `> 0` |
| `unit_price` | numeric(12, 2) | Null when MSRP did not parse |
| `price_error` | text | |
| `description` | text not null | Snapshot |
| `inventory_hold_id` | uuid FK `inventory_holds.id` | Required by the application before send when kind is `stock_hold`. Nullable in the table so a draft can exist mid-edit |
| `weight_lb` | numeric(12, 4) | Snapshot from the profile at rate time |
| `ltl_class` | varchar(8) | Snapshot |
| `length_in`, `width_in` | numeric(12, 4) | Snapshot |
| `created_at`, `updated_at` | timestamptz not null | |

Index `(inventory_hold_id)` where not null. Index `(quote_id)`.

### 14.4 `quote_revisions`

Insert-only. Updates are limited to `voided_at` when a sent quote returns to draft.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `quote_id` | uuid not null FK | |
| `revision_no` | integer not null | Unique `(quote_id, revision_no)` |
| `payload` | jsonb not null | Lines, ZIP, miles, method, snapshot, promise, actor |
| `merchandise_total` | numeric(12, 2) not null | |
| `freight_total` | numeric(12, 2) not null | |
| `deposit_pct` | numeric(5, 2) not null | |
| `amount_due` | numeric(12, 2) not null | The Clover amount |
| `voided_at` | timestamptz | |
| `created_at` | timestamptz not null default now() | |

### 14.5 `quote_overrides`

Insert-only. No updates and no deletes.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `quote_id` | uuid not null FK | |
| `field` | `quote_override_field` not null | |
| `inventory_hold_id` | uuid | Set when the field is `hold_expires_at` |
| `calculated_value` | text not null | |
| `override_value` | text | Null means "cleared, show the calculation again" |
| `reason` | text not null | Check length 1–500 |
| `actor_id` | uuid not null | `auth.users` id of the manager |
| `actor_role` | text not null | `Ops_Manager` or `SuperAdmin` |
| `created_at` | timestamptz not null default now() | |

### 14.6 `freight_rate_cache`

| Column | Type | Rule |
|---|---|---|
| `input_hash` | char(64) PK | |
| `dest_zip` | char(5) not null | |
| `plan` | jsonb | Null when the row is a short failure cache |
| `error` | text | |
| `expires_at` | timestamptz not null | Success: 20 minutes. Failure: 60 seconds |
| `created_at` | timestamptz not null | |

### 14.7 `dock_distances`

| Column | Type | Rule |
|---|---|---|
| `dest_zip` | char(5) PK | |
| `origin_zip` | char(5) not null default `85260` | |
| `distance_miles` | numeric(8, 2) not null | Check `>= 0` |
| `source` | text not null | `geocode` |
| `fetched_at` | timestamptz not null | Reuse for 30 days |

### 14.8 `clover_checkouts`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `quote_revision_id` | uuid not null unique FK | One attempt row per revision. Retry updates it |
| `amount` | numeric(12, 2) not null | Copied from `amount_due` |
| `status` | `checkout_status` not null default `pending` | |
| `clover_checkout_id` | text | |
| `checkout_url` | text | |
| `last_error` | text | |
| `created_at`, `updated_at` | timestamptz not null | |

### 14.9 `payment_events`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `source` | text not null | `clover` |
| `external_id` | text not null unique | Clover payment id |
| `checkout_id` | uuid FK | Null when the checkout was unknown |
| `amount` | numeric(12, 2) | |
| `status` | `payment_event_status` not null default `received` | |
| `conflict_reason` | text | |
| `payload` | jsonb not null | |
| `last_error` | text | |
| `processed_at` | timestamptz | |
| `created_at` | timestamptz not null | |

### 14.10 `delivery_zones`

| Column | Type | Rule |
|---|---|---|
| `zip5` | char(5) PK | |
| `zone_code` | text not null | Example values are data: an operator inserts `SCOTTSDALE` |
| `lat` | numeric(9, 6) | |
| `lng` | numeric(9, 6) | |
| `created_at` | timestamptz not null | |

Index `(zone_code)`.

### 14.11 `delivery_days`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `service_date` | date not null | |
| `truck_code` | text not null | |
| `zone_code` | text not null | |
| `capacity_stops` | integer not null | Check `> 0` |
| `capacity_weight_lb` | numeric(12, 2) not null | Check `> 0` |
| `stops_booked` | integer not null default 0 | Check `>= 0` and `<= capacity_stops` |
| `weight_booked_lb` | numeric(12, 2) not null default 0 | Check `>= 0` |
| Unique | `(service_date, truck_code, zone_code)` | A truck can serve more than one zone on a day as separate rows |

Capacity is seeded by operations. This lane does not generate a year's worth of trucks from code.

### 14.12 `delivery_stops`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `quote_id` | uuid not null FK | |
| `ghl_opportunity_id` | text not null | |
| `katana_sales_order_id` | integer | |
| `dest_zip` | char(5) not null | |
| `zone_code` | text | |
| `status` | `delivery_stop_status` not null default `suggested` | |
| `suggested_service_date` | date | |
| `suggested_truck_code` | text | |
| `service_date` | date | Set on confirm |
| `truck_code` | text | Set on confirm |
| `stop_sequence` | integer | |
| `weight_lb` | numeric(12, 2) not null | Copied from the quote at suggestion time |
| `ready_at` | timestamptz | |
| `ghl_appointment_id` | text | |
| `last_error` | text | |
| `created_at`, `updated_at` | timestamptz not null | |

Partial unique index on `quote_id` where status is not `delivered`, `failed`, or `cancelled`. One live stop per quote.

### 14.13 Changes to existing tables

`order_intake.intake_kind` `intake_kind` not null default `factory`.

`logistics_profiles.lead_time_days` integer. Null means "promise blocked". Check `>= 0` when not null.

`logistics_settings` gains:

| Column | Type | Default |
|---|---|---|
| `fleet_base_fee` | numeric(10, 2) | null until management sets it |
| `fleet_per_mile` | numeric(10, 2) | null |
| `fleet_per_pound` | numeric(10, 4) | null |
| `fleet_transit_days` | integer not null | 1 |
| `deposit_pct` | numeric(5, 2) not null | 50.00 |

Checks: fees null or `>= 0`, `fleet_transit_days >= 0`, `deposit_pct > 0` and `deposit_pct <= 100`. The singleton check `id = 1` stays.

`incoming_webhooks.source` includes `clover`.

No new column on `inventory_holds` is required. Expiry overrides update `expires_at`.

---

## 15. State machines

### 15.1 Quote

```text
draft → sent → deposit_paid → paid → converted
draft → void
sent → void
sent → draft          (edit voids the checkout first)
sent → expired        (no payment by the revision expiry)
deposit_paid → void   (forbidden automatically; a person sets commercial_conflict instead)
```

`converted` is set when `katana_sales_order_id` is stored and, for factory orders, `order_intake.status` is `pushed`. Stock-only reaches `converted` at the end of `convertStockQuote`. A stock-only quote may be `deposit_paid` and already have a sales order id before it is `converted`; `converted` means the dummy holds are gone and the real order id is stored. The function sets both in the same success path so the quote does not linger in `deposit_paid` without a sales order.

Revision expiry default is 7 days from send, stored on the revision as `expires_at`. The sweeper is an Inngest cron, consistent with the hold sweeper, not a new node-cron process. It voids checkouts still `pending` or `linked` and releases holds still `active` on that quote.

### 15.2 Hold, unchanged

```text
active → releasing → released
active → converting → converted
converting → active     (real sales order id was never stored)
```

### 15.3 Checkout

```text
pending → linked → paid
pending → void
linked → void
linked → expired
```

### 15.4 Stop

```text
suggested → scheduled → ready → dispatched → delivered
scheduled → suggested          (unschedule succeeded)
dispatched → failed
suggested → cancelled
```

---

## 16. Sequences

### 16.1 Draft and auto-hold

```text
Rep opens /embed/order-desk with an opportunity id
  → server resolves the GHL user
  → server loads the opportunity
  → insert quotes (draft) if none is open
  → insert quote_line_items for each active inventory_holds row
  → snapshot MSRP
  → return the document
No Priority1, Clover, or Katana call
```

### 16.2 Swap

```text
Rep confirms release + new hold
  → version check
  → createHold (advisory lock, Katana HOLD- order, ledger insert)
  → update the line to the new hold id
  → release the old hold
  → on release failure, return previous_hold_still_active
```

### 16.3 Rate

```text
Draft edit settles for 1.5s
  → hash the skid, ZIP, miles, settings
  → read freight_rate_cache
  → on miss, calculateFulfillmentOptions
  → write the cache and the quote snapshot
  → recompute the promise from the snapshot's transit days
```

### 16.4 Send and pay

```text
Send
  → transaction: revision + quote sent + checkout pending
  → Clover hosted checkout
  → checkout linked
Webhook
  → signature, unique payment id, amount match
  → Inngest quote.payment.received
  → stock-only: sales order, then delete HOLD- orders
  → mixed: order_intake received, claim holds, stop for triage
```

### 16.5 Dispatch

```text
Board load
  → quotes in paid with a Katana sales order
  → readiness from header DONE or on-hand at 98179
  → suggest a zone day without booking it
Confirm
  → lock delivery_days, increment booked, write the GHL appointment
  → roll back the increment if the appointment write fails
```

---

## 17. Build plan

Each phase ends when its exit is true in the running application. The next phase does not start early to share a pull request.

### Phase 0 — Blueprint gate

**Work.** Add §18 of this document to `docs/MDM_MASTER_BLUEPRINT.md` as §2.5, with the decision table's accepted rows named. Record any rejected row as an explicit change to this file before code.

**Exit.** The blueprint and this file agree. No schema migration has been generated yet.

**Depends on.** Approval of §1.

**Recorded:** Accepted 2026-10-02. No row in §1 was rejected. §2.5 is in the master blueprint.

### Phase 1 — Quote ledger

**Work.** `quotes`, `quote_line_items`, `/embed/order-desk`, load-or-create action, suggestion tray, version conflicts, MSRP snapshot. Wire the menu URL. Revalidate `/embed/order-desk` after save.

**Does not call.** Priority1, Clover, Katana (beyond the reads the showroom already does to list holds), GoHighLevel write.

**Exit.** Opening an opportunity creates one draft. Active holds from that opportunity are lines. A second save with a stale version fails and the first save remains. A refresh shows the same lines. Lost voids the draft and releases holds through the existing webhook.

**Tests.** Version conflict. Two holds become two lines. A released hold does not auto-add. Lost on a draft voids it. Embed key missing is unauthorized.

**Recorded:** Migration `0031_blushing_the_hood` is applied. Opening an opportunity creates one draft and snapshots MSRP onto lines copied from active holds. A later hold stays a suggestion. A stale save does not overwrite. Lost and Abandoned void the open draft. `freight_override_id`, `promise_override_id`, and `current_revision_id` are present as uuid columns; their foreign keys arrive with those tables.

### Phase 2 — Hold swap

**Work.** Attach suggestion, remove line with release, swap in the order in §4.7, using `createHold` and the existing release.

**Exit.** A failed new hold leaves the old line. A failed release keeps the new hold and surfaces the old one. Availability failures match the showroom error. The legacy fabric order is untouched.

**Tests.** Swap happy path deletes only the old `HOLD-` order. Katana failure on create does not release the old hold. Release failure returns `previous_hold_still_active`.

### Phase 3 — Freight snapshot

**Work.** `dock_distances`, `freight_rate_cache`, fleet columns on `logistics_settings`, numeric `INTERNAL_FLEET` price, remove `getEstimatedDistance` from Order Desk, stop using the 90×40 hack for this portal, debounce, hash, overrides for freight and miles.

**Blocked until.** Decision 20 numbers are in `logistics_settings`.

**Exit.** The same skid and ZIP inside 20 minutes does not call Priority1 twice. An unknown ZIP has no total. A line missing class has no total. White-glove, fleet, and LTL amounts match the formula. A manager override keeps the calculated amount in `calculated_freight_total`.

**Tests.** Hash stability. Cache expiry. Height outside 36–45 refuses. Stub function is not on the Order Desk path. Override role rejected for the embed principal.

### Phase 4 — Promise date

**Work.** `lead_time_days`, `delivery_zones`, `delivery_days`, formula `promise-v1`, promise override.

**Exit.** A stock hold and a configured line produce a date that is the later ready date plus transit, snapped to a zone day with capacity. The day is not booked. Missing zone or missing lead time blocks send. Override does not insert a stop.

**Tests.** Capacity not incremented on quote. No-capacity error. LTL uses `transitDays` from the snapshot. Factory deadline is not read.

### Phase 5 — Freeze and collect

**Work.** `quote_revisions`, `clover_checkouts`, send preconditions, edit-voids-link, opportunity value patch when the token can write, manager role check on a real session.

**Exit.** Two clicks produce one revision. The Clover amount equals `amount_due`. A line edit after send is impossible until the link is voided. Clover failure leaves `pending` and a retry does not create revision 2.

**Tests.** Amount math at 50 percent. Send precondition failures (no freight, no promise, unpriced line, dead hold). Duplicate send.

### Phase 6 — Payment to the factory

**Work.** `payment_events`, source `clover` on `incoming_webhooks`, `order_intake.intake_kind`, signature verification, Inngest `quote.payment.received`, `convertStockQuote`, mixed path into triage, Lost race.

**Exit.** A matching deposit on a stock-only quote creates `GHL-{opportunityId}` and then deletes `HOLD-` orders, and does not create a manufacturing order. A mixed quote inserts `received` intake and does not call Katana when the gate is `log`. A replay does not create a second sales order. A Lost that wins first stores `conflict` and no sales order. A payment that wins first is not released by a later Lost.

**Tests.** Idempotency key. Amount mismatch. `GHL_FACTORY_ORDERS=log`. Delete guard rejects a non-`HOLD-` order number. Existing factory push still converts holds it claimed.

### Phase 7 — Dispatch board

**Work.** `delivery_stops`, `/embed/deliveries`, readiness read, suggestion, confirm with capacity lock, GoHighLevel appointment id, rollback on appointment failure.

**Exit.** A paid stock order with on-hand quantity is suggested into its zone and is not booked until confirm. Two confirms of the last stop: one wins. Appointment failure does not consume capacity. The manufacturing order gains no delivery operation.

**Tests.** Capacity lock. Rollback. Header `DONE` versus still in progress. 429 keeps the previous ready timestamp.

### Phase 8 — Map

**Work.** Fill `lat`/`lng` on zone rows. Render stops for one day.

**Exit.** The map and the board show the same stops. The map has no assign control.

**Depends on.** A billing decision for the geocode and the map. Phase 7 does not wait on it.

---

## 18. Blueprint amendment to paste as §2.5

Paste this into `docs/MDM_MASTER_BLUEPRINT.md` only after §1 is accepted. Adjust the deposit percent and the fleet sentence if those decisions change.

```markdown
### 2.5 Scoped exception — commercial document lane

`docs/COMMERCIAL_DOCUMENT_LANE.md` is the build contract for quotes, freight snapshots, promise dates, Clover deposit collection, and the delivery board.

Supabase stores the quote and the truck stop. Katana stores stock, the sales order, and the manufacturing order. GoHighLevel stores the opportunity. Priority1 rates LTL. Clover takes the deposit. The hub does not read those systems back as the price or the route.

The factory path in §2.4 is unchanged for configured goods. A collected deposit may insert `order_intake`. A person still maps `FIN-*` and `FAB-*`. Approve & Push is still the only writer of manufacturing orders, and only when `GHL_FACTORY_ORDERS=live`.

A quote made entirely of showroom holds may, on that same deposit, create the `GHL-{opportunityId}` sales order and delete the `HOLD-` orders. It does not create a manufacturing order.

Won still does not create a sales order. WooCommerce order intake stays closed. There is no QuickBooks mutex and no custom dead-letter screen. Delivery is not a manufacturing-order task. One opportunity has one factory intake.

Manager overrides of freight, promise date, and hold expiry require `Ops_Manager` or `SuperAdmin` on a real operator session. The embed key is not that session.
```

---

## 19. Non-goals

- Tax, trade-discount matrices, and multi-currency.
- A 3D configurator price. MSRP snapshot is the price until a later price book exists.
- Change orders after `order_intake` is `pushed`.
- Partial qty edits on a hold. The showroom rule stands: release and place a new hold.
- Automatic refunds.
- Samsara, Onfleet, or a vehicle-routing solver.
- Replacing the GoHighLevel calendar as the customer-notification system.
- A sales-role row in `user_roles`. Sales identity stays the GoHighLevel user.
- Pacing every interactive Katana call. Phase 7 paces the board read. Quote open does not call Katana except through the existing hold functions when the rep confirms a hold.
- Signing the iframe query string.

---

## 20. Approval

Decisions 1–36 were accepted on 2026-10-02, with no replacements. Fleet tariff numbers and the geocode vendor remain figures to fill before Phase 3 and Phase 8 exit. The rules for those decisions stand.

The original approval instructions were:

- **Accept all** means §18 may be added to the blueprint and Phase 1 may be scheduled. Phases 2–8 still wait on the previous phase's exit.
- **Accept with changes** means name the decision number and the replacement rule. Dependent sections are rewritten before any migration.
- **Reject a decision** means that row and everything that cites it stay unbuilt.

Fleet tariff numbers (decision 20) and the geocode vendor (decision 18 and 33) can be accepted as rules now and filled with figures before Phase 3 and Phase 8 exit. They do not have to be dollar amounts on the day this document is signed.
