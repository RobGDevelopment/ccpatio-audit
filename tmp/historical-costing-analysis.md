# Historical Costing Analysis — CC Patio → Katana Resources

Generated: 2026-09-14T14:51:00.030Z

This report was produced by `scripts/ops/extract-historical-costing.ts`, which recursively scanned workspace `.xlsx` / `.xls` / `.csv` files (excluding `node_modules`, `.next`, `.git`) for Cost / Labor / Hour / Rate / Overhead / Consumable / Margin signals.

## Executive verdict (for Architect)

**Primary historical shop labor rate found: `$30/hour`.**

Source of truth: `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` → sheet `Items wUpholstery` column headers explicitly state:

- Metal Labor (**$30/hour**)
- Sandblast + Primer+Powdercoat Labor (**$30/hour**)
- Upholstery Labor (**$30/hour**)
- Powder Coat Labor (**$30/hour**) and Dekton Labor (**$30/hour**) — also printed on Tables / Fire Pit / Foam Case Study headers

These dollar cells on each SKU row are **job-level labor $ totals**, not rates. Implied hours = labor$ ÷ $30.

> Katana COGS = (Setup Time + Run Time) × Resource Hourly Rate. The Hub routing already stores minutes; this report is for the **Default cost per hour** field on each Resource.

## Recommended Katana Resource rates

Historical spreadsheets do **not** differentiate wage by cell — Metal, Sandblast/Powder, and Upholstery all quote the same **$30/hour**. Until payroll/burden is updated, map that single fully-burdened (or near-burdened) shop rate to every production cell, then adjust after Shop Floor actuals.

| Katana Resource | Recommended Default $/hr | Historical basis | Confidence |
|---|---:|---|---|
| Fabric Cutting | $30 | Upholstery Labor ($30/hour) — cutting is upstream of sew/stuff in same upholstery cost pool | Medium |
| Fabric Sewing | $30 | Upholstery Labor ($30/hour) | High |
| Cushion Stuffing | $30 | Upholstery Labor ($30/hour) + Foam/Dryfast material lines separate | Medium |
| Metal Cutting | $30 | Metal Labor ($30/hour) | High |
| Metal Grinding / Grinding Station | $30 | Bundled inside Metal Labor ($30/hour) — no separate grind rate found | Medium |
| Building & Welding / Welding Station | $30 | Metal Labor ($30/hour) | High |
| Metal Sandblasting / Sandblasting | $30 | Sandblast + Primer+Powdercoat Labor ($30/hour) | High |
| Metal Powder Coating / Powder Coating Booth | $30 | Same $30/hour labor column; powder **material** is separate ($8.64/lb, $0.21/sqft) | High |
| Curing Oven | $30 | No distinct oven rate — historically rolled into Sandblast+Primer+Powdercoat Labor | Low |
| Quality Check / Quality Control | $30 | No QC labor column found — default to shop rate until measured | Low |
| Material Handling | $30 | No dedicated handling rate — often absorbed into Metal Labor / Consumables | Low |
| Assembly & Packaging | $30 | No dedicated pack rate; Consumables + Misc cover materials only | Low |
| Dekton Cutting / Grinding / Polishing | $30 | Dekton Labor ($30/hour) on Tables / Fire Pit / Foam Case Study headers | High |

## Material baselines (from spreadsheet headers)

| Material / process | Rate | Source |
|---|---:|---|
| Aluminum 2×2 tubing | $1.68/LF | Cost 2025 Items/Tables headers |
| Aluminum 2×3 tubing | $3.67/LF | Cost 2025 Items header |
| Aluminum 1.5×3/4 tubing | $1.00/LF | Cost 2025 Items header |
| Aluminum 2×1 tubing | $1.444/LF | Cost 2025 Items/Tables headers |
| Aluminum 1.5×1.5 tubing | $2.98/LF | Cost 2025 Tables header |
| 1″ Flat Bar | $0.034/LF | Cost 2025 Items header |
| 1/2 Round | $1.41/lb | Cost 2025 Tables header |
| Primer | $9.45/lb · $0.23/sqft | Cost 2025 Items header |
| Powder coat (material) | $8.64/lb · $0.21/sqft | Cost 2025 Items header |
| Fabric | $20/yard | Cost 2025 Items header (Fabric Cost) |
| Dekton slab | $8/sqft | Cost 2025 Items/Tables/Fire Pit headers |
| Powder coat labor (job adder examples) | $10–$20 typical on fire-pit rows | Fire Pit Tables Summary `Powder Coat Cost` column |

## Consumables / overhead / misc

Cost 2025 treats these as **flat $ per SKU**, not percentages:

| Bucket | How it appears | Observed pattern (sample) |
|---|---|---|
| Consumables | Column `Consumables` | Often **$25–$50** on upholstered frames; sometimes blank |
| Misc | `Misc. (Burners, Ropes, Swivel Mounts)` | Hardware/adders (e.g. swivel mount **~$34** on Ocean swivel) |
| Primer Cost | Flat $ per frame | Commonly **$5 / $10 / $20** by size class |
| Powder Coat Cost | Flat $ (labor/material adder) | Commonly **$10 / $20** on fire pits; parallel to primer bands on seating |
| Profit Margin | Derived vs MSRP | Example club chair ~**27% cost / 73% margin**; designer discount 20% tracked separately |

**Implication for Katana:** do **not** bury consumables inside Resource $/hr. Keep Resource rates as labor; model Consumables/Misc/Primer/Powder material as BOM ingredients or MO overhead lines so MAC stays honest.

## Worked examples (implied hours @ $30/hr)

| Item | Metal $ | ⇒ hours | Sandblast+PC $ | ⇒ hours | Upholstery $ | ⇒ hours | Consumables | Total Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BRAVADA CLUB CHAIR | $150.00 | 5.00 h | $75.00 | 2.50 h | $60.00 | 2.00 h | $50.00 | $570.28 |
| BRAVADA SWIVEL CHAIR | $150.00 | 5.00 h | $60.00 | 2.00 h | $60.00 | 2.00 h | $50.00 | $596.68 |
| BRAVADA LOVESEAT 60" x 34" x 31" BH NO ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $75.00 | 2.50 h | $50.00 | $661.91 |
| BRAVADA LOVESEAT 60" x 34" x 31" BH W/ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $75.00 | 2.50 h | $50.00 | $669.61 |
| BRAVADA MINI LOVESEAT 48" x 34" x 31" BH NO ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $90.00 | 3.00 h | $50.00 | $638.77 |
| BRAVADA MINI LOVESEAT 48" x 34" x 31" BH W/ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $90.00 | 3.00 h | $50.00 | $646.47 |
| BRAVADA SOFA 72" x 34" x 31" BH NO ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $90.00 | 3.00 h | $50.00 | $839.42 |
| BRAVADA SOFA 72" x 34" x 31" BH W/ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $90.00 | 3.00 h | $50.00 | $1,034.12 |
| BRAVADA SOFA 84" X 34" X 31" BH NO ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $105.00 | 3.50 h | $50.00 | $869.17 |
| BRAVADA SOFA 84" X 34" X 31" BH W/ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $105.00 | 3.50 h | $50.00 | $876.87 |
| BRAVADA SOFA 96" X 34" X 31" NO ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $105.00 | 3.50 h | $50.00 | $960.39 |
| BRAVADA SOFA 96" X 34" X 31" W/ ARMS | $120.00 | 4.00 h | $60.00 | 2.00 h | $105.00 | 3.50 h | $50.00 | $968.09 |

## Spreadsheet inventory (keyword-scored)

Files scanned: **35**

| File | Sheet | Keyword hits | Sample headers |
|---|---|---:|---|
| `docs/data_sheets/CCPatio_Executive_SKU_Review.xlsx` | SKU Review | 955 | — |
| `docs/Vividworks/E-Commerce - Website Product Info.xlsx` | vividworks_material_options | 487 | Category (Fabric/Powder/Dekton); Cost Per Unit |
| `docs/Vividworks/Handoff/vividworks_material_options.csv` | Sheet1 | 487 | Category (Fabric/Powder/Dekton); Cost Per Unit |
| `docs/data_sheets/CC Patio - Purchasing Database (v2 2026-08-19).xlsx` | Item Catalog | 310 | — |
| `docs/data_sheets/CC Patio - Purchasing Database (v2 2026-08-19).xlsx` | Purchase History | 280 | Unit Cost |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | 02 - WEB FABRICS & FINISHES | 234 | — |
| `docs/Vividworks/E-Commerce - Website Product Info.xlsx` | Website Products | 133 | — |
| `docs/Vividworks/VividWorksStartingProducts.xlsx` | Website Products | 133 | — |
| `docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx` | Copy of Website Products | 133 | — |
| `_ARCHIVE_TO_REMOVE_/topology/Data_Sheets/Website Product Info.xlsx` | Website Products | 132 | — |
| `docs/data_sheets/Website Product Info.xlsx` | Website Products | 132 | — |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | 99 - DICTIONARY | 101 | — |
| `docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx` | Web Finishes | 90 | Mark each finish Yes/No for e-comm and enter any retail upcharge ($) over base (e.g. premium Dekton or specialty powder). Sellable powders are pre-filled; Dekton rows come from the STN-* dictionary.; Mark each finish Yes/No for e-comm and enter any retail upcharge ($) over base (e.g. premium Dekton or specialty powder). Sellable powders are pre-filled; Dekton rows come from the STN-* dictionary.; Mark each finish Yes/No for e-comm and enter any retail upcharge ($) over base (e.g. premium Dekton or specialty powder). Sellable powders are pre-filled; Dekton rows come from the STN-* dictionary.; Mark each finish Yes/No for e-comm and enter any retail upcharge ($) over base (e.g. premium Dekton or specialty powder). Sellable powders are pre-filled; Dekton rows come from the STN-* dictionary. |
| `docs/Vividworks/E-Commerce - Website Product Info.xlsx` | vividworks_phase2_products | 85 | — |
| `docs/Vividworks/Handoff/vividworks_phase2_products.csv` | Sheet1 | 85 | — |
| `docs/Vividworks/Handoff/ecommerce_catalog_worksheet.xlsx` | Web Finishes | 84 | Mark each finish Yes/No for e-comm and enter any retail upcharge ($) over base (e.g. premium Dekton or specialty powder). Sellable powders are pre-filled; Dekton rows come from the STN-* dictionary. |
| `docs/Vividworks/Handoff/CC_Patio_Vendor_Handoff_Workbook.xlsx` | 02 - WEB FABRICS & FINISHES | 82 | — |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | 07 - VW ASSET BINDINGS | 82 | — |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | 01 - PHASE 1 & 2 PRODUCTS | 77 | Shipping Flat Rate; Fabric Color; Dekton Color |
| `docs/Vividworks/Handoff/CC_Patio_Vendor_Handoff_Workbook.xlsx` | 01 - PHASE 1 & 2 PRODUCTS | 75 | Shipping Flat Rate; Fabric Color; Dekton Color |
| `docs/Vividworks/E-Commerce - Website Product Info.xlsx` | vividworks_phase1_products | 74 | — |
| `docs/Vividworks/Handoff/vividworks_phase1_products.csv` | Sheet1 | 74 | — |
| `docs/Vividworks/Handoff/ecommerce_catalog_worksheet.xlsx` | Phase 1 & 2 Products | 72 | — |
| `docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx` | Phase 1 & 2 Products | 72 | — |
| `docs/data_sheets/CC Patio - Purchasing Database (v2 2026-08-19).xlsx` | A. SET MIN-MAX | 62 | — |
| `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` | Items wUpholstery | 49 | 2 x 2  ($1.68/LF); Cost; $3.67/LF; 1.5 x 3/4 ($1/LF); Cost; 2 x 1 (1.444/LF) |
| `docs/data_sheets/Vividworks_Primeview E-Commerce Handoff.xlsx` | Web Fabrics | 47 | LOCKED e-comm fabric set (36) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet.; LOCKED e-comm fabric set (36) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet.; LOCKED e-comm fabric set (36) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet.; LOCKED e-comm fabric set (36) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet.; LOCKED e-comm fabric set (36) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet. |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | Q&A | 45 | — |
| `_ARCHIVE_TO_REMOVE_/topology/Data_Sheets/Website Product Info.xlsx` | Website Products w Links | 43 | — |
| `docs/Vividworks/E-Commerce - Website Product Info.xlsx` | Website Products w Links | 43 | — |
| `docs/Vividworks/VividWorksStartingProducts.xlsx` | Website Products w Links | 43 | — |
| `docs/data_sheets/Website Product Info.xlsx` | Website Products w Links | 43 | — |
| `docs/Vividworks/Handoff/ecommerce_catalog_worksheet.xlsx` | Web Fabrics | 39 | LOCKED e-comm fabric set (36) extracted from "CC Patio Core Sunbrella Fabric Colors.docx". Swatches embedded. Assign Fabric Grade A–F (upcharges on Upcharge Matrix). Replaces the standalone colors sheet. |
| `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` | Tables | 38 | 2 x 2 -Linear Feet ($1.68/LF); Cost; 1.5 x 3/4 ($1/LF); Cost; 1.5 x 1.5 -Linear Feet (2.98/LF); Cost |
| `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` | Foam Case Study | 27 | — |
| `docs/Vividworks/Handoff/Spark_Generated/PRICING UPDATE - - CC PATIO CURRENT PRICE List 2026 MSRP.xlsx` | Definitions | 25 | — |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | _QA_OPTIONS | 25 | — |
| `docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx` | 08 - HANDOFF CHECKLIST | 22 | — |
| `docs/data_sheets/Standard Report 2026 CCPatio.xlsx` | Export Lines | 22 | Powder Coat; Dekton |
| `docs/data_sheets/Standard Report 2026 CCPatio.xlsx` | NEW | 21 | POWDER COAT; DEKTON; SEW; FABRIC; FOAM; Proj. Hrs Dekton |

## All extracted unit rates (machine scrape)

| Kind | Value | Unit | Label (truncated) | File / Sheet |
|---|---:|---|---|---|
| labor_hourly | 30 | $/hour | Metal Labor  ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| labor_hourly | 30 | $/hour | Sandblast + Primer+Powdercoat Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| labor_hourly | 30 | $/hour | Upholstery Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| labor_hourly | 30 | $/hour | Metal Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| labor_hourly | 30 | $/hour | Powder Coat Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| labor_hourly | 30 | $/hour | Dekton Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| labor_hourly | 30 | $/hour | Metal Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Fire Pit Tables Summary |
| labor_hourly | 30 | $/hour | Powder Coat Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Fire Pit Tables Summary |
| labor_hourly | 30 | $/hour | Dekton Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Fire Pit Tables Summary |
| labor_hourly | 30 | $/hour | Metal Labor  ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| labor_hourly | 30 | $/hour | Sandblast + Primer+Powdercoat Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| labor_hourly | 30 | $/hour | Upholstery Labor ($30/hour) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_lb | 8.64 | $/lb | Powder Coat Cost ($8.64/lb, .21/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_lb | 8.64 | $/lb | Powder Coat Cost ($8.64/lb, .21/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_lb | 9.45 | $/lb | Primer Cost ($9.45/lb, .23/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_lb | 9.45 | $/lb | Primer Cost ($9.45/lb, .23/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_lf | 1 | $/LF | 1.5 x 3/4 ($1/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_lf | 1 | $/LF | 1.5 x 3/4 ($1/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| per_lf | 1 | $/LF | 1.5 x 3/4 ($1/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_lf | 1.444 | $/LF | 2 x 1 (1.444/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_lf | 1.444 | $/LF | 2 x 1 (1.444/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| per_lf | 1.444 | $/LF | 2 x 1 (1.444/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Fire Pit Tables Summary |
| per_lf | 1.444 | $/LF | 2 x 1 (1.444/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_lf | 1.68 | $/LF | 2 x 2  ($1.68/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_lf | 1.68 | $/LF | 2 x 2 -Linear Feet ($1.68/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| per_lf | 1.68 | $/LF | 2 x 2 -Linear Feet ($1.68/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Fire Pit Tables Summary |
| per_lf | 1.68 | $/LF | 2 x 2  ($1.68/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_lf | 2.98 | $/LF | 1.5 x 1.5 -Linear Feet (2.98/LF) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| per_lf | 3.67 | $/LF | $3.67/LF | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_lf | 3.67 | $/LF | $3.67/LF | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_sqft | 0.21 | $/sqft | Powder Coat Cost ($8.64/lb, .21/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_sqft | 0.21 | $/sqft | Powder Coat Cost ($8.64/lb, .21/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_sqft | 0.23 | $/sqft | Primer Cost ($9.45/lb, .23/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_sqft | 0.23 | $/sqft | Primer Cost ($9.45/lb, .23/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_sqft | 8 | $/sqft | Dekton ($8/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_sqft | 8 | $/sqft | Dekton Cost $8/SQFT | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Tables |
| per_sqft | 8 | $/sqft | Dekton Cost $8/SQFT | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Fire Pit Tables Summary |
| per_sqft | 8 | $/sqft | Dekton ($8/sqft) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |
| per_yard | 20 | $/yard | Fabric Cost ($20/yard) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Items wUpholstery |
| per_yard | 20 | $/yard | Fabric Cost ($20/yard) | `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` / Foam Case Study |

## Gaps & Architect decisions

1. **Burdened vs unburdened:** Spreadsheet says `$30/hour` with no explicit fringe/overhead load. Confirm with finance whether this is cash wage or fully burdened. If unburdened, raise Resource rates (or add a shop overhead Resource) before go-live.
2. **Cell differentiation:** History uses one rate for Metal / Finish / Upholstery. Differentiating Weld vs Grind vs Cut requires Shop Floor time studies — not present in these files.
3. **Dekton Labor $/hr:** Confirmed **$30/hour** on Tables / Fire Pit headers (Items sheet column sometimes omits the rate text).
4. **Curing Oven / QC / Material Handling / Pack:** No historical $/hr — start at shop rate or $0 with time-only tracking until actuals exist.
5. **Material unit costs ($/LF, $/sqft, $/yard)** belong on **variant purchase_price / BOM**, not on Resource hourly rates.

## Raw artifact

- Machine-readable extract: `tmp/historical-costing-extract.json`
- Primary workbook: `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx`
