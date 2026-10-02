# Metal and Logistics Cutover Plan

**Status:** For review. No metal stock writes and no metal recipe rows until this plan is accepted.
**Does not replace** the approved fabric path in [`WIP_AND_PROCUREMENT_MIGRATION_PLAN.md`](./WIP_AND_PROCUREMENT_MIGRATION_PLAN.md). It supersedes two sentences in that plan: manufacturing orders are no longer forbidden from `DONE` once the factory is finished, and metal on-hand can be initialized without turning `QTY METAL` into a recipe.

Binding context: [`docs/MDM_MASTER_BLUEPRINT.md`](./MDM_MASTER_BLUEPRINT.md). Location for every quantity in this plan is CC Manufacturing, Katana location `98179`.

---

## 1. Factory and logistics stay separate

White-glove delivery can sit in the same Katana tenant as the factory. It cannot sit on the manufacturing order.

The manufacturing order ends at Quality Control and Assembly & Packaging. When those two tasks are completed, the order is wrapped for the truck, the header is `DONE`, inventory for that build is realized, and COGS locks. A delivery task on the same MO would keep the header `IN_PROGRESS` until the truck returns, which holds COGS open and counts a truck route as factory capacity.

| Layer | Object | What it owns |
|---|---|---|
| Factory | Manufacturing order and its operation rows | Metal cutting, fab pod, sandblast, powder, oven, dekton, fabric cut, sew, stuff, quality control, assembly and packaging |
| Logistics | Sales order `additional_info` | `Delivery Date`, `PU / DROP`, `Delivery Address`, `Delivery Conf.`, `PU / DROP Confirmed` |

There is no White Glove operation, resource, or recipe row.

`Production Deadline` is the date the factory must finish. It stays in the sales-order note and is also written to the manufacturing order `production_deadline_date`. `Delivery Date` is not copied onto the manufacturing order.

`READY FOR DELIVERY` means the factory is finished and the truck has not rolled. For those 10 orders:

| Task | Status |
|---|---|
| Quality Control | `COMPLETED` |
| Assembly & Packaging | `COMPLETED` |
| Manufacturing-order header | `DONE` |

`NEW` orders keep the current derivation: both end tasks stay `NOT_STARTED` while any production task is open, and quality moves to `IN_PROGRESS` only when every production task is already `COMPLETED`. The header is `DONE` only when quality and packaging are both `COMPLETED`.

Katana rejects new recipe and operation rows on a `DONE` manufacturing order, and completing the only open task can close the header by itself. The write order stays: recipe rows, then every operation row created as `NOT_STARTED`, then operation statuses, then the header. `READY FOR DELIVERY` is set to `DONE` last.

The sales-order note format already approved stays. Logistics, purchasing, labor projections, and sales rep are lines in `additional_info`. They are not routing tasks.

---

## 2. Data dictionary

Standard Report columns. This is the map the import is allowed to use.

| Column | Category | What it tracks | Where it goes |
|---|---|---|---|
| Order Number | Identity | Primary key | `WIP-{number}` |
| Status | Identity | `NEW` or `READY FOR DELIVERY` | Which orders import, and whether the factory header can close |
| Customer Info | Identity | Client name | Katana customer |
| Type | Identity | `RESIDENTIAL`, `COMMERCIAL`, and the other sheet words | Sales-order note |
| PU / DROP | Logistics | Target pick-up or drop-off date | Sales-order note only |
| Production Deadline | Logistics / factory | Date the build must be finished | Sales-order note and MO `production_deadline_date` |
| Delivery Date | Logistics | Date the truck rolls | Sales-order note only |
| Delivery Conf. | Logistics | Client confirmed the date (`YES` / `NO`) | Sales-order note only |
| PU / DROP Confirmed | Logistics | Team confirmed logistics (`YES` / `NO` / `NA`) | Sales-order note only |
| METAL | Factory routing | Fabrication workstation | Metal Cutting, FAB POD A, Sandblasting |
| POWDER COAT | Factory routing | Paint and cure | Powder Coating Booth, Curing Oven |
| DEKTON | Factory routing | Stone workstation | Dekton Fabrication |
| CUSHIONS | Factory routing | Upholstery rollup | Fallback for the three upholstery tasks |
| CORTE | Factory routing | Fabric cutting | Fabric Cutting |
| SEW | Factory routing | Sewing | Fabric Sewing |
| FILLING | Factory routing | Stuffing | Cushion Stuffing |
| FABRIC | Purchasing | Manual PO word (`NEED`, `RECEIVED`, `ORDERED`) | Not a recipe. Yards come from Fabric Needs |
| FOAM | Purchasing | Manual PO word | Sales-order note. No recipe row |
| Covers | Purchasing | Manual PO word | Sales-order note. No recipe row |
| Umbrella | Purchasing | Manual PO word | Sales-order note. No recipe row |
| Tenjam/Others | Purchasing | Manual PO word | Sales-order note. No recipe row |
| Firepit System | Purchasing | Manual PO word | Sales-order note. No recipe row |
| QTY CUSH | Engineering | Piece count | Sales-order note. Not a BOM quantity |
| QTY METAL | Engineering | Piece count | Sales-order note. Not a tube SKU and not feet |
| QTY DEKT | Engineering | Piece count | Sales-order note. Not a slab quantity |
| Proj. Hrs Cushion | Engineering | Estimated labor, stored as sheet text | Sales-order note. Not an operation time |
| Proj. Hrs Metal | Engineering | Estimated labor, stored as sheet text | Sales-order note. Not an operation time |
| Proj. Hrs Dekton | Engineering | Estimated labor, stored as sheet text | Sales-order note. Not an operation time |
| Delivery Address | Logistics | Physical stop | Sales-order note only |

Fabric Needs is unchanged: yards and vendor SKU drive fabric recipe rows. `SALE` is the sales rep line on the sales order.

---

## 3. What the metal file is

`data_migration/METAL_ON_HAND_2026-10-01.csv` is a stick count taken by Angel on 1 Oct 2026. It is not a cut list.

| Fact | Value |
|---|---|
| Rows | 31 profiles |
| Sticks | 540 |
| Length | Every row is 20 ft |
| Feet | 10,800 |
| Unit in Katana | `ft` on `MET-*` and `RM-MET-*` |
| Open orders with `QTY METAL` > 0 | 24 orders, 385 pieces |
| Of those, metal cell is active | 23 orders, 345 pieces |
| Metal cell `NOT REQUIRED` but pieces filled | 1 order, 40 pieces |
| Active metal cell and no piece count | 10 orders |

Two rows are marked `CHECK` and are not uploadable until the shop confirms them:

- `RECT TUBE` 2x1, gauge written over as `11g?` (11g or 14g), 6 sticks
- `FLAT BAR` 1-1/2x3/4, size written as 1-1/2 x 3/4 and flagged to confirm, 4 sticks

The catalog already has 38 Metal variants at CC Manufacturing in `Update existing materials.csv`, including duplicate names for the same physical tube (`MET-TB22060`, `MET-SQT20016`, and `RM-MET-2X2-TUBING` are all 2x2). On-hand quantity is not in that file. The safe target is one variant per physical profile.

---

## 4. Inventory initialization

Upload absolute feet at location `98179` only. Feet equal `QTY_PCS × LENGTH_FT`. For this file that is `QTY_PCS × 20`. Showroom locations are not touched. Finished-goods and fabric quantities are not touched.

Use one Katana stocktake, number `MIG-METAL-COUNT-20261001`, with `counted_quantity` set to the absolute feet. `set_remaining_items_as_counted` must be **false**. The fabric migration set that flag true, which marks every variant absent from the stocktake as counted at zero. A metal-only count with that flag on would wipe fabric and finished goods.

`POST /stock_adjustments` stays forbidden. A delta adjustment double-counts if the script is retried. A named stocktake is idempotent: if `MIG-METAL-COUNT-20261001` is already `COMPLETED`, the retry skips it.

Before any write, the dry-run reads live `GET /inventory` for the mapped variants at location `98179` and prints current feet, counted feet, and the delta. If a mapped variant is already non-zero, the confirm stops. The October materials export showed these tubes at zero on hand, and that has to be rechecked live because that export is not the source of truth.

Canonical variant when several SKUs describe one profile: the `MET-TB*` / `MET-FH*` / `MET-TBR*` / `MET-RDH*` purchasing code. The `RM-MET-*` cut-list placeholders and the `STEEL TUBE` / `HR STEEL` twins do not also receive the sticks.

### Count rows that match an existing variant

| Count profile | Sticks | Feet | Variant | Notes |
|---|---:|---:|---|---|
| Square tube 1x1 16g | 110 | 2,200 | `MET-TB11060` | |
| Rect tube 1-1/2x3/4 16g | 55 | 1,100 | `MET-TB11234060` | Not `RM-MET-15X075-TUBING` |
| Rect tube 3x2 16g | 40 | 800 | `MET-TB32060` | |
| Flat bar 1x1/8 | 40 | 800 | `RM-MET-FLATBAR` | Only variant whose note says 1x1/8. Confirm before upload |
| Square tube 2x2 16g | 25 | 500 | `MET-TB22060` | Not `RM-MET-2X2-TUBING` or `MET-SQT20016` |
| Rect tube 2x3/4 16g | 15 | 300 | `MET-TB234060` | |
| Rect tube 2x1 16g | 15 | 300 | `MET-TB21060` | |
| Rect tube 4x2 16g | 12 | 240 | `MET-TB42060` | |
| Round bar 1/2 solid | 10 | 200 | `MET-RDH12` | |
| Flat bar 1x1/4 | 7 | 140 | `MET-FH141` | |
| Flat bar 1-1/2x3/16 | 5 | 100 | `MET-FH316112` | Not `MET-10019150` |
| Square tube 2x2 11g | 4 | 80 | `MET-TB22120` | |
| Flat bar 2x3/16 | 4 | 80 | `MET-FH3162` | |
| Round tube 3/4 14g | 3 | 60 | `MET-TBR34083` | |
| Square tube 3x3 16g | 3 | 60 | `MET-SQT30016` | Name says steel. Confirm it is the aluminum bin |
| Flat bar 2x1/4 | 3 | 60 | `MET-10025200` | Name says HR steel. Confirm before upload |
| Flat bar 1-1/2x1/8 | 2 | 40 | `MET-FH18112` | |

Those 16 rows are 6,200 feet on the unambiguous `MET-*` codes, plus 860 feet on the three rows flagged "confirm" in the table (`RM-MET-FLATBAR`, `MET-SQT30016`, `MET-10025200`). The confirm set is 7,060 feet only after those three names are accepted.

### Count rows with no variant

These 12 profiles are 3,540 feet. They are listed in the dry-run and are not given a guessed SKU.

| Count profile | Sticks | Feet |
|---|---:|---:|
| Square tube 1-1/2x1-1/2 16g | 125 | 2,500 |
| Rect tube 1-1/2x3/4 11g | 13 | 260 |
| Rect tube 3x1 16g | 7 | 140 |
| Flat bar 1-1/2x1/4 | 7 | 140 |
| Round tube 1 14g | 6 | 120 |
| Rect tube 3x2 11g | 5 | 100 |
| Round tube 2 14g | 4 | 80 |
| Round tube 1-1/2 14g | 3 | 60 |
| Rect tube 1-1/2x1 11g | 3 | 60 |
| Square tube 1x1 11g | 2 | 40 |
| Rect tube 4x2 11g | 1 | 20 |
| Flat bar 2x1/8 | 1 | 20 |

Minting them is a separate approval: proposed `MET-*` SKU, name, UOM `ft`, category Metal, then the same stocktake. The 1-1/2 square tube is the large one. Dropping it would hide 2,500 feet from purchasing.

The two `CHECK` rows (200 feet) stay out of the stocktake until the gauge and the flat-bar size are confirmed.

---

## 5. Metal recipe allocation

The script cannot choose a tube SKU or a length for these 57 jobs.

`QTY METAL` is a piece count. The metal file is a shop-wide stick count. Neither file says which order consumes which profile, or how many feet a piece uses. The seating formulas in `src/lib/level2-bom.ts` need a model width, depth, arm count, and leg count, and these orders have no `FIN-*` model.

A generic placeholder such as one `RM-MET-GENERIC` row per order, quantity = `QTY METAL`, would do the same damage the generic fabric row was rejected for. Katana would raise a shortage in pieces of an item purchasing cannot buy, while the real extrusions (tracked in feet) would show the full stick count as free stock. Auto-procurement would flag the wrong material.

A mapping table cannot be derived from the files we have. It has to be supplied.

**This cutover does not post metal recipe rows.**

`QTY METAL` stays in the sales-order note. The 385 pieces are not allocated, not converted to feet, and not run through the fabric FIFO shortage gate. After the stocktake, purchasing sees on-hand aluminum. They do not see these 57 jobs reserving specific tubes.

Metal consumption for a bespoke job lands later, from a cut list with one row per order and profile:

| Column | Meaning |
|---|---|
| Order number | Join to `WIP-{number}` |
| Variant SKU | One `MET-*` code from the stocktake map |
| Feet | Consumption, including scrap if the shop includes it |

That file is posted the same way fabric yards are posted: one manufacturing-order recipe row, token `wip-metal:{order}:{sku}`, quantity in feet, location stock already initialized. Availability is Katana's calculated stock at `98179` (`on hand − committed`), FIFO by order number. The script still does not create purchase orders. Rows predicted `IN_STOCK` on a profile the shop says is short are blockers, same as Canvas Flax. Orders whose manufacturing order is already `DONE` cannot take recipe rows; those cut-list lines wait until the header is reopened, or they are excluded.

---

## 6. Execution sequence

No step writes until its dry-run is accepted. Metal stock and the WIP confirm are separate confirms so a stocktake cannot ride along with sales-order creation.

1. **Lock this plan.** Accept the factory/logistics boundary, the dictionary, the canonical SKU table, and the decision that `QTY METAL` is not a recipe.
2. **Factory-close change, still in the WIP script, no metal rows.** `READY FOR DELIVERY` completes Quality Control and Assembly & Packaging and then sets the header `DONE`. `Production Deadline` is sent as `production_deadline_date`. Delivery fields stay in `additional_info`. Dry-run the 57 orders and confirm the 10 ready orders show header `DONE` and the 47 `NEW` orders do not.
3. **Metal identity dry-run.** Parse `METAL_ON_HAND_2026-10-01.csv`. Emit matched feet, confirm-before-upload feet, unmapped profiles, and the two `CHECK` rows. Read live inventory at `98179` for the matched variants. Write `data_migration/reports/metal-on-hand-dry-run.json`. No stocktake yet.
4. **Approve mints and the three weak name matches**, or drop them from the stocktake. Unmapped profiles are minted only from that approved list.
5. **Metal stock confirm.** Post `MIG-METAL-COUNT-20261001` at location `98179` with `set_remaining_items_as_counted: false`. Skip if that stocktake is already `COMPLETED`. Re-read inventory and confirm the counted feet.
6. **WIP confirm** of the 57 orders, fabric recipes only, notes including the dictionary fields, no metal recipe rows. The Canvas Flax blocker still refuses a full confirm while order 1768 is in scope. Order 1769 is already on sales order `52651271` and is updated in place.
7. **Cut list, later.** When the shop provides order, SKU, and feet, a second dry-run allocates those feet against the stock from step 5 and prints the shortage lines purchasing will see. That confirm is not part of the stocktake and not part of step 6.

---

## Decisions needed before code

1. Accept that these 57 manufacturing orders get fabric recipes only, and metal shortages for them wait on a cut list.
2. Accept or drop the three weak matches: `RM-MET-FLATBAR` (1x1/8), `MET-SQT30016` (3x3, named steel), `MET-10025200` (1/4 x 2, named HR steel).
3. Mint the 12 missing profiles, led by 2,500 feet of 1-1/2 square tube, or leave that stock out of Katana for this cutover.
4. Confirm the two `CHECK` rows before either is uploaded.
5. Accept `READY FOR DELIVERY` as a finished factory order: quality and packaging `COMPLETED`, header `DONE`, delivery remaining on the sales order.
