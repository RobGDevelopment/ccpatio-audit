# Third-party inventory import

**Status:** Approved. The importer is `scripts/ops/import-3rd-party-inventory.ts`. Dry-run is the default. Live writes require `--confirm`.

Showroom cards only list categories in `SHOWROOM_STOCK_CATEGORIES`. These sheets must land on `Umbrellas`, `Flexy`, and `Tenjam`.

## 1. Sheets

Headers are file row 3. Row 1 is a title. Row 2 is blank. `parseCsvLine` keeps quoted inch marks such as `Riser 8"`.

Drop `In`, `Out`, blank headers, and the unheaded `Fame Only` note on the Astro carbon frame row.

| File | Kept columns | Rows |
|---|---|---|
| `CURRENT 3RD PARTY ITEMS INVENTORY.xlsx - SCOLARO UMBRELLAS.csv` | Vendor, Size (M), Feet, Shape, Type, Canopy, Frame, Total on Hand | 15 |
| `CURRENT 3RD PARTY ITEMS INVENTORY.xlsx - FIM SHADE SYSTEMS.csv` | Vendor, Type, CANOPY, Total on Hand | 6 |
| `CURRENT 3RD PARTY ITEMS INVENTORY.xlsx - TEN JAM.csv` | Vendor, Type, Color, Total on Hand | 146 |

`Total on Hand` is the opening quantity. Zero still creates the variant. It does not post a stock adjustment.

## 2. Katana products

`POST /products` with `uom: "pcs"`, `is_sellable: true`, `is_producible: false`, `is_purchasable: true`. Do not use `upsertProductInKatana`. That helper marks finished goods producible and only marks `FIN-*` sellable.

| Vendor | Category |
|---|---|
| `SCOLARO` | `Umbrellas`, including type `MARINA` |
| `FIM` | `Flexy` |
| `Tenjam` | `Tenjam` |

One product per item name. Each sheet row is a variant.

Item name is the brand plus the title-cased type. `FIM` stays an acronym. Inch marks stay.

- `Scolaro Astro`
- `FIM Flexy Zen 300`
- `Tenjam Riser 8"`

The variant Spec skips blanks, `NONE`, and `-`.

- Scolaro: `10' SQ - Canopy: ECRU - Frame: TITANIUM`. Word sizes with no feet use that word: `BASE - SQ`, `COVER - SQ - Frame: DARK`. The meter column is not printed.
- FIM: `Canopy: PUMPKIN`. Mixed-case cells stay as written (`Canopy: Canvas Canopy`).
- Tenjam: `Color: Solid White`. A dash color (Splash Weight, Shayz Lounger Pump) has no Spec.

The Spec is stored as `config_attributes: [{ config_name: "Spec", config_value: "<sentence>" }]`. The product name stays the short item name so the collection facet does not become `10'`.

SKUs:

- `3P-UMB-ASTRO-10-SQ-ECRU-TITANIUM`
- `3P-ESY-FLEXYZEN300-PUMPKIN`
- `3P-TJM-RISER8-SOLIDWHITE`

The `3P-` prefix stays off the in-house `UMB-` / `FIN-UMB-` recipe block list.

## 3. Opening stock

Location is CC Manufacturing, `98179`. `POST /stock_adjustments` adds a quantity, so the posted quantity is `Total on Hand` minus `quantity_in_stock` at that location. A matching count posts nothing. Reason: `3rd-party opening balance`.

## 4. Showroom card

`search-katana-stock.ts` copies the Spec config onto `StockRow.variantLabel`. `InventoryCard` prints it under the title with `break-words line-clamp-3 text-xs text-slate-600`. The three-column In stock / Committed / Available row is unchanged. Facets still split on the short product name.
