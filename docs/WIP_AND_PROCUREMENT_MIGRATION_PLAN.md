# WIP and Procurement Migration Plan

**Status:** For review. No Katana writes until this plan is accepted and `scripts/ops/import-live-factory-data.ts` is run with `--confirm`.
**Scope:** Live factory trackers into Katana sales orders, manufacturing orders, operation rows, and fabric recipe rows.
**Out of this step:** QuickBooks, invoices, shipments, fulfillments, and purchase-order creation. Purchasing creates POs inside Katana after the shortage flags exist.

Binding context: [`docs/MDM_MASTER_BLUEPRINT.md`](./MDM_MASTER_BLUEPRINT.md) §2. Factory routing names come from [`src/lib/factory-routing/resources.ts`](../src/lib/factory-routing/resources.ts) and [`docs/FACTORY_FLOOR_TOPOLOGY.md`](./FACTORY_FLOOR_TOPOLOGY.md).

---

## What the files actually contain

The two exports do not match the shorthand "CUSH / SEWING / METAL / POWDER / QUALITY" or "material quantity columns on the WIP sheet." The script maps the columns below.

### Standard Report — `data_migration/Standard Report 2026 CCPatio - NEW.csv`

1,585 rows. One row per legacy order in the clean data.

| Column | Role |
|---|---|
| `Order Number` | Join key to Fabric Needs `ORDER`. Katana `order_no` becomes `WIP-{number}`. |
| `Status` | Order gate. `ORDER COMPLETED` (1,526) stays closed. Import `NEW` (47) and `READY FOR DELIVERY` (10). |
| `Customer Info` | Katana customer name. |
| `Type` | Free text on the sales order (`RESIDENTIAL`, `COMMERCIAL`, `WARRANTY`, …). |
| `Production Deadline`, `Delivery Date`, `Delivery Address` | SO dates and additional info. `HOLD` and blank dates are omitted. |
| `METAL`, `POWDER COAT`, `DEKTON` | Metal, finish, and stone cell status. |
| `CUSHIONS`, `CORTE`, `SEW`, `FILLING` | Upholstery. `CORTE` is cutting, `SEW` is sewing, `FILLING` is stuffing. |
| `QTY CUSH`, `QTY METAL`, `QTY DEKT` | Piece counts. They are job notes. They are not yards, feet, or BOM quantities. |
| `FABRIC`, `FOAM`, `Covers`, `Umbrella`, `Tenjam/Others`, `Firepit System` | Purchasing words (`RECEIVED`, `NEED`, `ORDERED`) with no SKU and no quantity. Fabric yards come from the other file. Foam, covers, umbrellas, and firepits are not recipe rows in this cutover. |

There is no `QUALITY` column and no finished-good SKU. Two rows have address text in `Status` (`Cardiff`, `UT 84098,`). Those two are exceptions and are not imported.

On the 57 open orders, every production cell is one of `COMPLETED`, `IN PROGRESS`, `NOT STARTED`, `NOT REQUIRED`, or blank. Dirty shop words (`CUT START`, `OK`, `ISSUE`, `PARTIAL`) exist only on `ORDER COMPLETED` history, which this import does not reopen.

### Fabric Needs — `data_migration/CURRENT Fabric Control Inventory 2026-CURRENT.xlsx - FABRIC NEEDS.csv`

4,702 rows. `STATUS = OUT OF STOCK` is exactly 15 rows, on 9 order numbers, across 13 Sunbrella SKUs. All 9 orders are `NEW` on the Standard Report.

| Column | Role |
|---|---|
| `ORDER` | Join key. |
| `FABRIC` | Material name. |
| `SKU` | Sunbrella / vendor code (`46094-0002`). This is the Katana variant code on the 1 Oct 2026 inventory export for the SKUs that already exist. |
| `QTY NEED` | Yards to put on the manufacturing-order recipe row. |
| `STOCK` | Physical on-hand repeated on every row of that SKU. It is one pool, not a per-order remainder. |
| `DIFERENCE` | `QTY NEED - STOCK` for that row alone. Summing it double-counts shared on-hand. Katana calculated stock is the buy number. |
| `STATUS` | `OUT OF STOCK` is the purchasing gate for this cutover. |
| `DATE INTRO` | Compared with the 11 Aug 2026 fabric hold so older reservations are visible in the dry-run. |
| `CLIENT` | Display only. Names disagree with the Standard Report (`CAROL BENNET` vs `CAROL & TODD BENNETT`, `TRIBELL` vs `TWIBELL`). The join is the order number. |

130 Fabric Needs rows join to the 57 open orders:

| Sheet status | Rows | Disposition |
|---|---:|---|
| `RECEIVED` | 62 | Closed purchasing history. No recipe row. |
| `IN STOCK` | 44 | Current assignment. Recipe row so the MO commits the yards. Not part of the shortage gate. |
| `OUT OF STOCK` | 15 | Recipe row. Acceptance requires `ingredient_availability = NOT_AVAILABLE`. |
| `ORDERED` | 3 | Recipe row so the demand exists. The script does not create the PO. |
| `CLIENTE` | 5 | Customer-supplied. No recipe row. |
| `DISCONTINUED` | 1 | Exception report. No recipe row. |

### The 15 shortages

Katana quantities are from `data_migration/InventoryItems-2026-10-01-07_40.csv`, location CC Manufacturing, columns In stock / Committed / Calculated stock. The dry-run re-reads live Katana. It does not trust this snapshot.

| Order | Fabric | Vendor SKU | Hub SKU | Yards | Sheet stock | Sheet diff | Katana in stock | Katana committed | Katana calculated |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|
| 1658 | METAMORPHIC SAND | `46094-0002` | `FAB-MET-SAN` | 52 | 11 | -41 | 11 | 94 | -83 |
| 1774 | METAMORPHIC SAND | `46094-0002` | `FAB-MET-SAN` | 36 | 11 | -25 | 11 | 94 | -83 |
| 1783 | METAMORPHIC SAND | `46094-0002` | `FAB-MET-SAN` | 90 | 11 | -79 | 11 | 94 | -83 |
| 1760 | LINVILLE DENIM | `145707-0012` | `FAB-LIN-DEN` | 32 | 0 | -32 | 0 | 3 | -3 |
| 1782 | ASCEND TROPICAL | `145410-0008` | `FAB-ASC-TRO` | 12 | 5 | -7 | 5 | 0 | 5 |
| 1768 | CANVAS FLAX | `5492-0000` | `FAB-CAN-FLA` | 4 | 0 | -4 | 0 | 0 | 0 |
| 1768 | ADAPTATION INDIGO | `69010-0004` | `FAB-ADA-IND` | 5 | 4 | -1 | 4 | 0 | 4 |
| 1769 | MIDORI STONE | `145256-0005` | `FAB-MID-STO` | 28 | 0 | -28 | 0 | 0 | 0 |
| 1769 | CRUSH SNOW | `42101-0001` | `FAB-CRU-SNO` | 22 | 0 | -22 | 0 | 93 | -93 |
| 1769 | CANVAS CHARCOAL | `54048-0000` | `FAB-CAN-CHA` | 5 | 3 | -2 | 3 | 0 | 3 |
| 1774 | PRECISE FAWN | `145602-0006` | `FAB-PRE-FAW` | 6 | 4 | -2 | 4 | 6 | -2 |
| 1775 | DUMONT STUCCO | `305825-0002` | `FAB-DUM-STU` | 76 | 64 | -12 | 64 | 89.7 | -25.7 |
| 1775 | ESTI MARINE | `44349-0028` | `FAB-EST-MAR` | 27 | 4 | -23 | 4 | 0 | 4 |
| 1784 | UNDERCURRENT LAGOON | `47203-0003` | none | 44 | 0 | -44 | absent | absent | absent |
| 1784 | SPECTRUM PEACOCK | `48081-0000` | none | 6 | 0 | -6 | absent | absent | absent |

Hub codes are the existing dictionary in `data_migration/reports/katana-bulk-update-materials.csv`. Order 1783's 79-yard short and order 1769's 28-yard Midori Stone short match `DIFERENCE`, and the recipe quantity is `QTY NEED` (90 and 28), because Katana subtracts on-hand itself.

Metamorphic Sand's three rows each subtract the same 11 yards. The sheet diffs sum to -145. The yards to commit are 52 + 36 + 90 = 178 against one pool of 11, and Katana has already committed 94 on the August hold (calculated -83). Those three orders are imported in the same run. Purchasing buys the Katana negative calculated stock after the run, not the sum of `DIFERENCE`.

Six of the thirteen SKUs are at or above zero today. The MO recipe row is what drives them negative, in line with the sheet diff: Ascend Tropical (-7), Canvas Flax (-4), Adaptation Indigo (-1), Midori Stone (-28), Canvas Charcoal (-2), Esti Marine (-23). The other five existing SKUs are already negative because of `MIG-HOLD-FABRIC-20260811` (sales order id `52594042`, location `98179`). Linking them to a named MO keeps that shortage and attaches it to the job.

`47203-0003` and `48081-0000` are absent from the 1 Oct inventory export. Sibling colorways exist (`47203-0001` Sand, `47203-0002` Storm, `47203-0004` Tide; Spectrum colors under `480xx-0000`). Live mode mints those two materials before their recipe rows. Until they exist, those two of the fifteen cannot flag.

---

## 1. Data mapping strategy

Location for every document is CC Manufacturing, `CC_MANUFACTURING_LOCATION_ID = 98179` (`src/server/ghl/hold-order.ts`).

The script uses the existing client in `src/lib/katana.ts`: `katanaFetch`, `findVariantBySku`, `findKatanaSalesOrderByOrderNo`, `createKatanaSalesOrder`, and `createMakeToOrderManufacturingOrders`. It pages with `scripts/ops/lib/katana-paginate.ts` and parses CSV with `scripts/ops/lib/csv.ts`. The request pacer is `createIntervalPacer(1100)`, the same interval as the other ops scripts. `Idempotency-Key` is already supported on `katanaFetch`.

`createKatanaSalesOrder` resolves customers by email only. These rows have no email, so the script looks up `GET /customers` by exact `Customer Info` and posts a customer only on a miss. It does not call the email-only helper, or a retry would mint a second customer per order.

### Sales order — `POST /sales_orders`

| Katana field | Source |
|---|---|
| `order_no` | `WIP-{Order Number}` |
| `location_id` | `98179` |
| `customer_id` | Resolved from `Customer Info` |
| `currency` | `USD` |
| `additional_info` | Type, legacy order number, production deadline, delivery date, address, piece counts, fabric client name |
| `customer_ref` | Legacy order number |
| `sales_order_rows[0].variant_id` | Shell variant `FIN-WIP-SHEET` |
| `sales_order_rows[0].quantity` | `1` |
| `sales_order_rows[0].price_per_unit` | `0` |
| Idempotency-Key | `wip-so-{Order Number}` |

Quantity is 1 because the recipe field `planned_quantity_per_unit` is multiplied by the sales-order quantity. One bespoke job keeps yards equal to `QTY NEED`.

Before create, `findKatanaSalesOrderByOrderNo` short-circuits a retry.

### Manufacturing order — `POST /manufacturing_order_make_to_order`

```json
{ "sales_order_row_id": "<row id>", "create_subassemblies": false }
```

`create_subassemblies: false` matches `createMakeToOrderManufacturingOrders` in `src/lib/katana.ts`. These jobs are flat. The sheet has no child SKUs to explode.

The shell product has an empty product recipe and no product operations. Make-to-order then creates an empty MO linked to the sales-order row, and this script adds the order-specific rows underneath. That leaves catalog `FIN-*` recipes untouched.

If a live probe ever shows that make-to-order rejects an empty recipe, the shell gets one `RM-FAB-GENERIC` row and the script deletes that placeholder row after the real fabric rows exist. The dry-run records which branch it is about to use. It does not discover that by writing.

### Recipe rows — `POST /manufacturing_order_recipe_rows`

| Katana field | Source |
|---|---|
| `manufacturing_order_id` | MO just created |
| `variant_id` | Resolved fabric variant |
| `planned_quantity_per_unit` | `QTY NEED` yards |
| `notes` | `wip-fabric:{order}:{vendorSku}` plus the sheet `NOTE` |

A retry lists existing rows and skips a notes token it already wrote. This is the same idea as the hold-relief token in `src/server/ghl/relieve-hold.ts`.

`bindMtoFabric` / `applyMtoIngredientOverrides` stay unused. That path swaps a single `RM-FAB-GENERIC` row for one `FAB-*`. Order 1769 has three fabrics. Order 1784 has two, one of which does not exist yet. Multi-fabric jobs need one recipe row per SKU.

### Operation rows — `POST /manufacturing_order_operation_rows`

Posted only for cells the order actually uses. `NOT REQUIRED` omits the row, so the shop floor does not see a task for work the sheet says is absent.

| Katana field | Source |
|---|---|
| `manufacturing_order_id` | This MO |
| `operation_name` | `resolveKatanaOperationName` |
| `resource_name` | Locked resource from `KATANA_RESOURCES` |
| `status` | Translated cell status |
| `type` | `process` |
| `planned_time_parameter` | Standard Track run minutes converted to seconds, same conversion `syncBOMToKatana` already uses |

Resource ids come from `GET /resources`. A missing resource fails that order in the report. The script does not invent resources. `scripts/ops/import-shop-floor.ts` is the existing resource setup path.

### Variant resolution order

1. `findVariantBySku(vendor code)` — matches the 1 Oct inventory export (`46094-0002`).
2. `findVariantBySku(hub code)` from `katana-bulk-update-materials.csv` (`FAB-MET-SAN`).
3. Hub `sku_mappings.katana_variant_id` / `sku_aliases` when the database is reachable.
4. Otherwise the row is an exception. Live mode does not guess.

---

## 2. Handling custom items

These 57 orders have a customer and cell statuses. They do not have a model code, a `FIN-*` SKU, or a cut list. Cloning a catalog BOM would commit the wrong tubing, powder, and fabric.

**One shell finished good, many order-level recipes.**

| Choice | Why |
|---|---|
| Product / variant SKU `FIN-WIP-SHEET` | One reusable custom build. Created once if `findVariantBySku` misses. |
| Empty product BOM and empty product routing | Make-to-order has nothing to copy. Order-specific rows live on the MO, which is what Katana already does for recipe overrides. |
| Sales order quantity `1` | Yards are the recipe quantity, not a multiple of cushion count. |
| One recipe row per open fabric line | 15 shortage lines, 44 in-stock assignments, 3 ordered lines. |
| Piece counts in `additional_info` | `QTY CUSH` / `QTY METAL` / `QTY DEKT` describe the job. They are not consumption. |
| No metal, powder, dekton, or foam ingredients | The sheet has no SKU and no length or slab quantity for those. Inventing `RM-MET-*` or `RM-PWD-GENERIC` quantities would allocate the wrong stock. |

`FIN-WIP-SHEET` is a migration shell. It is not a VividWorks master SKU and it is not pushed to WooCommerce or Clover.

The two missing fabrics are minted with the same material writer the ops scripts already use (`syncRawMaterialToKatana` / the post-missing-materials path): name from the sheet, SKU = vendor code, category Fabric, UOM `yd`, to match sibling rows such as `47203-0001`. The dry-run checks that `FAB-UND-LAG` and `FAB-SPE-PEA` are unused before recording them as proposed hub aliases. The Katana SKU on the new variant is the vendor code either way.

---

## 3. Status translation logic

Katana uses different enums on the two objects:

| Object | Endpoint | Status values |
|---|---|---|
| Manufacturing order | `PATCH /manufacturing_orders/{id}` | `NOT_STARTED`, `BLOCKED`, `IN_PROGRESS`, `DONE`, `PARTIALLY_COMPLETED` |
| Operation row (the shop-floor task) | `PATCH /manufacturing_order_operation_rows/{id}` | `NOT_STARTED`, `BLOCKED`, `IN_PROGRESS`, `PAUSED`, `COMPLETED` |

Cell translation for the values that appear on open orders:

| Sheet | Operation-row status |
|---|---|
| `NOT STARTED` or blank | `NOT_STARTED` |
| `IN PROGRESS` | `IN_PROGRESS` |
| `COMPLETED` | `COMPLETED` |
| `NOT REQUIRED` | Row is omitted |

### Which task each cell moves

Sequences match `STANDARD_TRACKS`.

| Sheet cell | Katana resource | Operation name | When `COMPLETED` |
|---|---|---|---|
| `METAL` | `Metal Cutting` | Cold Saw Fabrication | Both metal tasks completed. |
| `METAL` | `FAB POD A` | Fabrication & Welding | Same status as Metal Cutting. |
| `METAL` | `Sandblasting` | Sandblast | The sheet has no sandblast cell. Completed metal means sandblast is completed, so the next open task is powder. In-progress metal leaves sandblast `NOT_STARTED`. Omitted when metal is `NOT REQUIRED`. |
| `POWDER COAT` | `Powder Coating Booth` | Powder Coat | Completed when the cell is completed. |
| `POWDER COAT` | `Curing Oven` | Cure | Completed when powder is completed. When powder is `IN PROGRESS`, the booth is `IN_PROGRESS` and the oven stays `NOT_STARTED`. |
| `DEKTON` | `Dekton Fabrication` | Dekton Fabrication | Omitted when `NOT REQUIRED`. |
| `CORTE` | `Fabric Cutting` | Fabric Cut | |
| `SEW` | `Fabric Sewing` | Sew | |
| `FILLING` | `Cushion Stuffing` | Stuff | |
| Order `Status` | `Quality Control` | Final QC | Derived. There is no quality column. |
| Order `Status` | `Assembly & Packaging` | Assemble & Pack | Derived. |

If `CORTE` / `SEW` / `FILLING` are blank and `CUSHIONS` has a status, that rollup status is copied onto the three upholstery tasks. On the current open orders the granular cells are filled, so the rollup is only a fallback.

Quality and pack:

| Order `Status` | Quality Control | Assembly & Packaging |
|---|---|---|
| `NEW`, and any production task is still open | `NOT_STARTED` | `NOT_STARTED` |
| `NEW`, and every included production task is `COMPLETED` | `IN_PROGRESS` | `NOT_STARTED` |
| `READY FOR DELIVERY` | `COMPLETED` | `IN_PROGRESS` |

Order 1769 is the powder example in practice: `METAL`, `POWDER COAT`, and `DEKTON` are `COMPLETED`, and the cushion cells are `NOT STARTED`. The MO's open tasks start at Fabric Cutting. Order 1768 is the same shape. An order whose metal is `COMPLETED` and whose powder is `NOT STARTED` shows Powder Coating Booth as the next open task, because sandblast was advanced with metal.

Manufacturing-order header:

| Condition | MO status |
|---|---|
| Every operation row is `NOT_STARTED` | `NOT_STARTED` |
| Any row is `IN_PROGRESS` or `COMPLETED` while another is open | `IN_PROGRESS` |
| Anything else | `IN_PROGRESS` |

The header is never set to `DONE`. Katana rejects new recipe rows on a `DONE` manufacturing order, and `READY FOR DELIVERY` still has packaging open. Recipe rows are posted before operation statuses, so a status update cannot lock the MO first.

Operation statuses are what the floor sees. If Katana advances the MO header on its own when a task is `IN_PROGRESS`, the script does not fight that, as long as the header is not `DONE`.

---

## 4. Shortage and PO initialization

The script does not post purchase orders. Katana's purchasing screen builds the buy list from manufacturing-order recipe rows whose `ingredient_availability` is `NOT_AVAILABLE`, and from negative calculated stock. Creating POs here would put drafts beside the engine the buyers are about to use.

How a row becomes a shortage:

1. Resolve the variant (or mint the two missing ones).
2. Post `planned_quantity_per_unit = QTY NEED` on that order's MO.
3. Katana compares that demand, plus the existing hold commitment, with on-hand at location `98179`.
4. The row's `ingredient_availability` becomes `NOT_AVAILABLE` when available stock cannot cover it.

That is why the recipe quantity is `QTY NEED` and not the absolute value of `DIFERENCE`. For Midori Stone, on-hand is 0 and committed is 0, so 28 yards lands `NOT_AVAILABLE` with a buy of 28. For Adaptation Indigo, on-hand is 4 and the need is 5, so the buy is 1. For Metamorphic Sand the buy is the live negative calculated stock after all three MOs commit 178 yards on top of the existing hold. It is not 79, and it is not 41 + 25 + 79.

### Hold `MIG-HOLD-FABRIC-20260811`

The August freeze committed "for customer" yards so they would not look free. Several of these SKUs are already negative because of that hold (Metamorphic Sand -83, Crush Snow -93, Dumont Stucco -25.7, Linville Denim -3, Precise Fawn -2). Dumont Stucco's sheet diff is -12 because the sheet subtracts physical stock (64) from 76. Katana will show a larger buy because 89.7 yards are already committed. Buyers use the Katana number.

Default live mode does **not** patch the hold. Relieving it and re-adding the same yards changes who the commitment belongs to, and it changes the buy if the line was not actually inside the hold. The dry-run lists every fabric line whose `DATE INTRO` is on or before 11 Aug 2026 and whose variant still has quantity on the hold. Among the 15, that is only order 1658, introduced 9 Jul 2026 (`7/9/2026`), before the 11 Aug hold. The September and October lines, including 1760, 1769, and 1783, are new demand.

A later run may pass `--relieve-hold` with `--confirm`. That path reuses the notes-token pattern in `relieveFabricHold`: reduce the hold line by `min(QTY NEED, hold remaining)` for pre-freeze lines only, token `wip-relief:WIP-{order}:{sku}`, then the MO commits those yards under the job. Post-freeze lines never touch the hold. This flag stays off for the first live run.

### Acceptance gate

After the live pass, for each of the 15 lines:

`GET /manufacturing_order_recipe_rows?manufacturing_order_id={id}`

The row for that variant exists, `planned_quantity_per_unit` equals `QTY NEED`, and `ingredient_availability` is `NOT_AVAILABLE`.

A line that comes back `IN_STOCK` fails the run. The script does not "fix" that with a stock adjustment or a stocktake. Finished-goods stock stays as it is. `POST /stock_adjustments` stays unused, consistent with the inventory migration and with blueprint §2.

`IN STOCK` and `ORDERED` recipe rows are allowed to come back `IN_STOCK` or `EXPECTED`. If the dry-run predicts one of those will land `NOT_AVAILABLE` because of the hold, it is listed under `holdOverlap` for review. It does not fail the 15-line gate.

---

## 5. Execution plan

One script: `scripts/ops/import-live-factory-data.ts`.

```text
npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --dry-run
npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --dry-run --order 1769
npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --confirm --order 1769
npx dotenv -e .env.local -- tsx scripts/ops/import-live-factory-data.ts --confirm
```

Dry-run is the default even when the flag is omitted. `--confirm` is the only switch that writes to Katana. `--order` repeats safely because of `order_no` lookup and recipe notes tokens. `--relieve-hold` is ignored unless `--confirm` is also present, and it is off by default.

### Pipeline

```text
parse Standard Report
parse Fabric Needs
drop ORDER COMPLETED and the two corrupt status rows
join on order number
resolve variants (GET only)
read live inventory + hold lines for the touched SKUs
predict ingredient_availability
write JSON report
stop, unless --confirm
```

Live order, per sales order:

1. Ensure `FIN-WIP-SHEET` exists.
2. Ensure `47203-0003` and `48081-0000` exist when this order needs them.
3. Find or create the customer by exact name.
4. Find or create `WIP-{order}`.
5. Find or create the make-to-order MO with `create_subassemblies: false`.
6. Post missing fabric recipe rows.
7. Post missing operation rows with translated statuses.
8. Set the MO header to `NOT_STARTED` or `IN_PROGRESS`.
9. Append the ledger.

Then run the 15-line acceptance reads.

### Dry-run report

`data_migration/reports/wip-factory-import-dry-run.json`

```json
{
  "generatedAt": "ISO-8601",
  "mode": "dry-run",
  "scope": { "salesOrders": 57, "excludedCompleted": 1526, "exceptions": 2 },
  "shell": { "sku": "FIN-WIP-SHEET", "action": "would-create | exists" },
  "orders": [
    {
      "legacyOrder": "1769",
      "katanaOrderNo": "WIP-1769",
      "customer": "CAROL BENNET",
      "orderStatus": "NEW",
      "operations": [
        { "resource": "Metal Cutting", "status": "COMPLETED" },
        { "resource": "FAB POD A", "status": "COMPLETED" },
        { "resource": "Sandblasting", "status": "COMPLETED" },
        { "resource": "Powder Coating Booth", "status": "COMPLETED" },
        { "resource": "Curing Oven", "status": "COMPLETED" },
        { "resource": "Dekton Fabrication", "status": "COMPLETED" },
        { "resource": "Fabric Cutting", "status": "NOT_STARTED" },
        { "resource": "Fabric Sewing", "status": "NOT_STARTED" },
        { "resource": "Cushion Stuffing", "status": "NOT_STARTED" },
        { "resource": "Quality Control", "status": "NOT_STARTED" },
        { "resource": "Assembly & Packaging", "status": "NOT_STARTED" }
      ],
      "fabrics": [
        {
          "vendorSku": "145256-0005",
          "hubSku": "FAB-MID-STO",
          "yards": 28,
          "sheetStatus": "OUT OF STOCK",
          "disposition": "recipe-row",
          "predictedAvailability": "NOT_AVAILABLE"
        }
      ]
    }
  ],
  "shortageGate": {
    "expected": 15,
    "predictedNotAvailable": 15,
    "blocked": []
  },
  "materialsToMint": ["47203-0003", "48081-0000"],
  "holdOverlap": [],
  "exceptions": []
}
```

`shortageGate.blocked` must be empty before anyone runs `--confirm` for the full set. Blocked means a variant cannot be resolved, a yard quantity is missing, or live on-hand would leave an `OUT OF STOCK` line at `IN_STOCK`.

Ledger after a live run: `data_migration/reports/wip-factory-import.json`, same shape as `data_migration/reports/applied.json` (order number, Katana ids, recipe row ids, operation row ids). A second `--confirm` skips ids already in the ledger.

### Pilot

First live write is `--confirm --order 1769`.

That order is `NEW`, metal and powder and dekton are `COMPLETED`, cushions are `NOT STARTED`, and it carries the Midori Stone 28-yard shortage plus Crush Snow and Canvas Charcoal. All three variants already exist. It is dated 1 Oct 2026, so it is new demand against the August hold. After it lands, confirm in Katana that the open tasks start at Fabric Cutting and that Midori Stone on that MO is `NOT_AVAILABLE`.

Metamorphic Sand orders 1658, 1774, and 1783 go in the full run together, because they share one on-hand pool.

### What this script will not do

- It will not import the 1,526 completed orders.
- It will not create purchase orders, stock adjustments, stocktakes, invoices, or shipments.
- It will not patch `MIG-HOLD-FABRIC-20260811` unless `--relieve-hold` is passed later.
- It will not rewrite any catalog `FIN-*` recipe.
- It will not allocate tubing, powder, dekton, or foam. Those quantities are not in either CSV.

---

## Review decisions

1. Accept the 57-order scope (`NEW` and `READY FOR DELIVERY` only).
2. Accept `FIN-WIP-SHEET` plus per-MO recipe rows as the custom-build strategy.
3. Accept derived Quality Control / Assembly & Packaging, since the sheet has no quality column.
4. Accept that buyers will use Katana's negative calculated stock, which is larger than the summed sheet diffs where the August hold is already committed.
5. Leave `--relieve-hold` off for the first live run.
