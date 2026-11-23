# PrimeView Phase 1 Handoff Spec (Yardi / ccpatiodev2.primeview.com)

**Generated:** 2026-11-23T20:03:51.281Z
**Import file:** `tmp/primeview-phase1-102-import.csv` (173 columns = 169 PrimeView + 4 native 3D/finish Meta)
**Scope:** All 102 Phase 1 SOW items → **107 unique purchasable Woo SKUs** (100 variations + 7 simple parents; Corner Sofa/Chaise emit `-LS`/`-RS` pairs)
**Make / Resale handoff rows:** 96 / 11
**Fabric swatches:** live Supabase HTTP-200 URLs + local pack `tmp/primeview-fabric-swatches/`

---

## 1. Executive Summary

CC Patio Hub owns catalog authority. This CSV is the turnkey WooCommerce Product CSV Import for PrimeView/Yardi on `ccpatiodev2.primeview.com`:

- **Aluminum Website Price (Mia PDF ground truth):** `Regular price` = Mia's authoritative Aluminum column from the Oct 1, 2026 price list (increased base + manual `$0`/`$5` rounding). **Disregard Steel MSRP on the storefront.** Example: Bravada Club Chair = `2530` (not `2080 × 1.10 = 2288`). **DO NOT** add separate APF/ACF frame upcharges. Cabana pillows + 3P resale use Mia's non-metal column 1:1.
- Exact 173 headers from `product_export_import_headers.csv` (169 original PrimeView + 4 native 3D/finish Meta; UTF-8, `ID` without BOM corruption)
- Preserved PrimeView parent IDs and existing variation IDs where present
- **107 unique purchasable SKUs** on every `simple` / `variation` row (variable parents keep blank SKU)
- Corner Sofa (`27674`) + Corner Chaise (`27687`) Attribute 2 = **Select Facing** (`Left-Side Facing`, `Right-Side Facing`), default Left
- Metric weights/dimensions, shipping class (`parcel` < 50 lb, `freight-ltl` ≥ 50 lb)
- `Meta: acf_fabric_swatches_json` on upholstered parents (24 FAB-* swatches with **live HTTP-200** Supabase public URLs + additive `texture_2k_url` / physical scale fields)
- `Meta: acf_powder_swatches_json`, `Meta: acf_dekton_swatches_json`, `Meta: acf_3d_model_glb_url`, `Meta: acf_3d_model_usdz_url` (native WebGL — never iframe; never in `images[]`)
- Preserved ACF add-on price metas + RankMath/Astra/Brizy from the Oct 30 export
- All `Meta: _w3d_*` columns forced blank (3D excluded from Phase 1)

## 2. Import Instructions (PrimeView WP / Yardi)

1. Backup the staging site (DB + uploads) on `ccpatiodev2.primeview.com`.
2. WooCommerce → Products → Import → upload `primeview-phase1-102-import.csv`.
3. Map columns 1:1 (header names already match Woo export/import).
4. Choose **Update existing products** keyed by `ID` where ID is present; create when ID blank.
5. After import, spot-check:
   - Bravada Club Chair (`9449`) has fabric swatch JSON and blank `_w3d_enabled`
   - Bravada Corner Sofa (`27674`) / Corner Chaise (`27687`) show **Select Facing** with Left/Right and both `-LS`/`-RS` variation SKUs
   - Fly Leg Chair 18×18×18 (`FIN-WFT-DIN-CHA-18X18`) exists under Fly Leg Bench (`28147`)
   - Ripple Table (`28335`) / Cantilever Umbrella (`28343`) have unique simple SKUs
   - No duplicate SKU warnings in the import log
6. Fabric swatch images are already hosted (Supabase public URLs in `Meta: acf_fabric_swatches_json`). Optional: also copy `tmp/primeview-fabric-swatches/*.jpg` into WP media if desired for offline backup.
7. Install the Cart→Order metadata PHP hook in §4, then configure NMI + webhook (§5) before flipping live traffic.

## 3. Parent → Variation SKU Reference (all 102)

| SOW# | Product | Parent ID | Parent | Variation ID | Woo SKU | Canonical | Fulfillment | Price | Wt (lb) | Ship |
| ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | --- |
| 1 | BRAVADA CLUB CHAIR 34" x 34" x 31" BH | 9449 | Bravada Club Chair | 27604 | `FIN-BRV-CLB-CHA-34X34` | `FIN-BRV-CLB-CHA-34X34` | Make | 2530.00 | 72.77 | freight-ltl |
| 2 | BRAVADA SWIVEL CHAIR 34" x 34" x 31" BH | 27630 | Bravada Swivel Chair | 27632 | `FIN-BRV-SWV-CHA-34X34` | `FIN-BRV-SWV-CHA-34X34` | Make | 2970.00 | 72.77 | freight-ltl |
| 3 | BRAVADA LOVESEAT 60" x 34" x 31" BH | 9455 | Bravada Loveseat | 27640 | `FIN-BRV-LOV-SOF-60X34` | `FIN-BRV-LOV-SOF-60X34` | Make | 3175.00 | 94.02 | freight-ltl |
| 4 | BRAVADA MINI LOVESEAT 48" x 34" x 31" BH | 9455 | Bravada Loveseat | 28922 | `FIN-BRV-MIN-LOV-48X34` | `FIN-BRV-MIN-LOV-48X34` | Make | 2915.00 | 84.82 | freight-ltl |
| 5 | BRAVADA SOFA 72" x 34" x 31" BH | 27650 | Bravada Sofa | 27652 | `FIN-BRV-SOF-72X34` | `FIN-BRV-SOF-72X34` | Make | 4015.00 | 104.73 | freight-ltl |
| 6 | BRAVADA SOFA 84" x 34" x 31" BH | 27650 | Bravada Sofa | 27654 | `FIN-BRV-SOF-84X34` | `FIN-BRV-SOF-84X34` | Make | 4435.00 | 115.52 | freight-ltl |
| 7 | BRAVADA SOFA 96" x 34" x 31" BH | 27650 | Bravada Sofa | 27656 | `FIN-BRV-SOF-96X34` | `FIN-BRV-SOF-96X34` | Make | 4715.00 | 124.71 | freight-ltl |
| 8 | BRAVADA ARMLESS SOFA 72" x 34" x 31" BH | 27660 | Bravada Armless Sofa | 27666 | `FIN-BRV-ARM-SOF-72X34` | `FIN-BRV-ARM-SOF-72X34` | Make | 3875.00 | 96.54 | freight-ltl |
| 9 | BRAVADA ARMLESS MINI LOVESEAT 48" x 34" x 31" BH | 27660 | Bravada Armless Sofa | 28436 | `FIN-BRV-MIN-LOV-48X34-ARMLESS` | `FIN-BRV-MIN-LOV-48X34` | Make | 2680.00 | 84.82 | freight-ltl |
| 11 | BRAVADA ARMLESS SOFA 84" x 34" x 31" BH | 27660 | Bravada Armless Sofa | 27668 | `FIN-BRV-ARM-SOF-84X34` | `FIN-BRV-ARM-SOF-84X34` | Make | 4435.00 | 107.32 | freight-ltl |
| 12 | BRAVADA ARMLESS SOFA 96" x 34" x 31" BH | 27660 | Bravada Armless Sofa | 27670 | `FIN-BRV-ARM-SOF-96X34` | `FIN-BRV-ARM-SOF-96X34` | Make | 4715.00 | 116.51 | freight-ltl |
| 13 | BRAVADA CORNER SOFA 72" x 34" x 31" BH (Left-Side Facing) | 27674 | Bravada Corner Sofa | 27682 | `FIN-BRV-COR-SOF-72X34-LS` | `FIN-BRV-COR-SOF-72X34` | Make | 4345.00 | 104.73 | freight-ltl |
| 13 | BRAVADA CORNER SOFA 72" x 34" x 31" BH (Right-Side Facing) | 27674 | Bravada Corner Sofa | (new) | `FIN-BRV-COR-SOF-72X34-RS` | `FIN-BRV-COR-SOF-72X34` | Make | 4345.00 | 104.73 | freight-ltl |
| 14 | BRAVADA CORNER SOFA 84" x 34" x 31" BH (Left-Side Facing) | 27674 | Bravada Corner Sofa | 27684 | `FIN-BRV-COR-SOF-84X34-LS` | `FIN-BRV-COR-SOF-84X34` | Make | 4675.00 | 115.52 | freight-ltl |
| 14 | BRAVADA CORNER SOFA 84" x 34" x 31" BH (Right-Side Facing) | 27674 | Bravada Corner Sofa | (new) | `FIN-BRV-COR-SOF-84X34-RS` | `FIN-BRV-COR-SOF-84X34` | Make | 4675.00 | 115.52 | freight-ltl |
| 15 | BRAVADA CORNER SOFA 96" x 34" x 31" BH (Left-Side Facing) | 27674 | Bravada Corner Sofa | 27686 | `FIN-BRV-COR-SOF-96X34-LS` | `FIN-BRV-COR-SOF-96X34` | Make | 4895.00 | 124.71 | freight-ltl |
| 15 | BRAVADA CORNER SOFA 96" x 34" x 31" BH (Right-Side Facing) | 27674 | Bravada Corner Sofa | (new) | `FIN-BRV-COR-SOF-96X34-RS` | `FIN-BRV-COR-SOF-96X34` | Make | 4895.00 | 124.71 | freight-ltl |
| 16 | BRAVADA CORNER CHAISE 72" x 34" x 31" BH (Left-Side Facing) | 27687 | Bravada Corner Chaise | 27689 | `FIN-BRV-COR-CHS-72X34-LS` | `FIN-BRV-COR-CHS-72X34` | Make | 4160.00 | 104.73 | freight-ltl |
| 16 | BRAVADA CORNER CHAISE 72" x 34" x 31" BH (Right-Side Facing) | 27687 | Bravada Corner Chaise | (new) | `FIN-BRV-COR-CHS-72X34-RS` | `FIN-BRV-COR-CHS-72X34` | Make | 4160.00 | 104.73 | freight-ltl |
| 17 | BRAVADA CORNER CHAISE 84" x 34" x 31" BH (Left-Side Facing) | 27687 | Bravada Corner Chaise | 27691 | `FIN-BRV-COR-CHS-84X34-LS` | `FIN-BRV-COR-CHS-84X34` | Make | 4390.00 | 115.52 | freight-ltl |
| 17 | BRAVADA CORNER CHAISE 84" x 34" x 31" BH (Right-Side Facing) | 27687 | Bravada Corner Chaise | (new) | `FIN-BRV-COR-CHS-84X34-RS` | `FIN-BRV-COR-CHS-84X34` | Make | 4390.00 | 115.52 | freight-ltl |
| 18 | BRAVADA SINGLE CHAISE LOUNGE 30" x 79" x 14" SH | 27703 | Bravada Chaise Lounge | 27705 | `FIN-BRV-SGL-CHS-30X79` | `FIN-BRV-SGL-CHS-30X79` | Make | 2845.00 | 102.86 | freight-ltl |
| 19 | BRAVADA DOUBLE CHAISE LOUNGE 58" x 79" x 14" SH | 27703 | Bravada Chaise Lounge | 28929 | `FIN-BRV-DOU-CHS-58X79` | `FIN-BRV-DOU-CHS-58X79` | Make | 4290.00 | 139.09 | freight-ltl |
| 20 | BRAVADA ROUND DAYBED 84" DIAMETER | 27715 | Bravada Round Daybed | 27717 | `FIN-BRV-DYB-84X84-RND` | `FIN-BRV-DYB-84X84` | Make | 8415.00 | 183.82 | freight-ltl |
| 21 | BRAVADA DAYBED 72" x 72" x 27" BH | 27719 | Bravada Daybed | 27721 | `FIN-BRV-DYB-72X72` | `FIN-BRV-DYB-72X72` | Make | 7480.00 | 149.89 | freight-ltl |
| 22 | BRAVADA DAYBED 84" x 72" x 27" BH | 27719 | Bravada Daybed | 27725 | `FIN-BRV-DYB-84X72` | `FIN-BRV-DYB-84X72` | Make | 7755.00 | 167.29 | freight-ltl |
| 23 | BRAVADA DAYBED 84" x 84" x 27" BH | 27719 | Bravada Daybed | 27723 | `FIN-BRV-DYB-84X84` | `FIN-BRV-DYB-84X84` | Make | 8140.00 | 183.82 | freight-ltl |
| 24 | BROOKLYN SINGLE CHAISE LOUNGE 38" x 79" x 11" SH | 8598 | Brooklyn Chaise Lounge | 29017 | `FIN-BRK-SGL-CHS-38X79` | `FIN-BRK-SGL-CHS-38X79` | Make | 3395.00 | 109.61 | freight-ltl |
| 25 | BROOKLYN TRANSITIONAL DOUBLE CHAISE 48" x 72" x 30" BH | 27748 | Brooklyn Transitional Chaise Lounge | 28931 | `FIN-BRK-TRA-DOU-CHS-48X72` | `FIN-BRK-TRA-DOU-CHS-48X72` | Make | 4715.00 | 121.03 | freight-ltl |
| 26 | BROOKLYN TRANSITIONAL SINGLE CHAISE 36" x 72" x 30" BH | 27748 | Brooklyn Transitional Chaise Lounge | 27750 | `FIN-BRK-TRA-SGL-CHS-36X72` | `FIN-BRK-TRA-SGL-CHS-36X72` | Make | 4290.00 | 103.57 | freight-ltl |
| 27 | BROOKLYN DOUBLE CHAISE LOUNGE 58" x 79" x 11" SH | 8598 | Brooklyn Chaise Lounge | 29019 | `FIN-BRK-DOU-CHS-58X79` | `FIN-BRK-DOU-CHS-58X79` | Make | 4840.00 | 138.80 | freight-ltl |
| 28 | OCEAN CLUB CHAIR w/METAL ARM 34" x 38" x 33" BH | 27787 | Ocean Club Chair | 27789 | `FIN-OCN-CLB-CHA-34X38` | `FIN-OCN-CLB-CHA-34X38` | Make | 2640.00 | 75.95 | freight-ltl |
| 29 | OCEAN SWIVEL CHAIR 34" x 38" x 33" BH | 26791 | Ocean Swivel Chair | 27600 | `FIN-OCN-SWV-CHA-34X38` | `FIN-OCN-SWV-CHA-34X38` | Make | 3190.00 | 75.95 | freight-ltl |
| 30 | OCEAN SOFA 72" x 38" x 33" BH | 27796 | Ocean Sofa | 27800 | `FIN-OCN-SOF-72X38` | `FIN-OCN-SOF-72X38` | Make | 4160.00 | 109.78 | freight-ltl |
| 31 | OCEAN SOFA 84" x 38" x 33" BH | 27796 | Ocean Sofa | 27802 | `FIN-OCN-SOF-84X38` | `FIN-OCN-SOF-84X38` | Make | 4565.00 | 121.31 | freight-ltl |
| 32 | OCEAN SOFA 96" x 38" x 33" BH | 27796 | Ocean Sofa | 27804 | `FIN-OCN-SOF-96X38` | `FIN-OCN-SOF-96X38` | Make | 5130.00 | 131.03 | freight-ltl |
| 33 | OCEAN MINI LOVESEAT 48" x 38" x 33" BH | 27813 | Ocean Loveseat | 28933 | `FIN-OCN-MIN-LOV-48X38` | `FIN-OCN-MIN-LOV-48X38` | Make | 2930.00 | 88.80 | freight-ltl |
| 34 | OCEAN LOVESEAT 60" x 38" x 33" BH | 27813 | Ocean Loveseat | 27815 | `FIN-OCN-LOV-SOF-60X38` | `FIN-OCN-LOV-SOF-60X38` | Make | 3625.00 | 98.53 | freight-ltl |
| 35 | OCEAN SINGLE CHAISE LOUNGE 36" x 79" x 14" SH | 27816 | Ocean Chaise Lounge | 27818 | `FIN-OCN-SGL-CHS-36X79` | `FIN-OCN-SGL-CHS-36X79` | Make | 2945.00 | 108.06 | freight-ltl |
| 36 | OCEAN DOUBLE CHAISE LOUNGE 58" x 79" x 14" SH | 27816 | Ocean Chaise Lounge | 28935 | `FIN-OCN-DOU-CHS-58X79` | `FIN-OCN-DOU-CHS-58X79` | Make | 4455.00 | 139.09 | freight-ltl |
| 37 | MILAN CLUB CHAIR 32" x 36" x 16" SH | 27824 | Milan Club Chair | 27826 | `FIN-MLN-CLB-CHA-32X36` | `FIN-MLN-CLB-CHA-32X36` | Make | 2775.00 | 72.22 | freight-ltl |
| 38 | MILAN OTTOMAN 22" x 60" x 16" | 27830 | Milan Ottoman | 29137 | `FIN-MLN-OTT-22X60` | `FIN-MLN-OTT-22X60` | Make | 1410.00 | 82.79 | freight-ltl |
| 39 | MILAN OTTOMAN 22" x 72" x 16" | 27830 | Milan Ottoman | 29139 | `FIN-MLN-OTT-22X72` | `FIN-MLN-OTT-22X72` | Make | 1650.00 | 91.15 | freight-ltl |
| 40 | MILAN OTTOMAN 34" x 60" x 16" | 27830 | Milan Ottoman | 29143 | `FIN-MLN-OTT-34X60` | `FIN-MLN-OTT-34X60` | Make | 2035.00 | 91.92 | freight-ltl |
| 41 | MILAN OTTOMAN 56" x 42" x 16" | 27830 | Milan Ottoman | 29147 | `FIN-MLN-OTT-56X42` | `FIN-MLN-OTT-56X42` | Make | 2245.00 | 98.62 | freight-ltl |
| 42 | MILAN ONE-SIDED SOFA 72" x 36" x 16" SH | 27836 | Milan One-Sided Sofa | 27840 | `FIN-MLN-SOF-72X36` | `FIN-MLN-SOF-72X36` | Make | 4435.00 | 105.34 | freight-ltl |
| 43 | MILAN ONE SIDED SOFA 84" x 36" x 16" SH | 27836 | Milan One-Sided Sofa | 27842 | `FIN-MLN-SOF-84X36` | `FIN-MLN-SOF-84X36` | Make | 4840.00 | 116.18 | freight-ltl |
| 44 | MILAN ONE-SIDED SOFA 96" x 36" x 16" SH | 27836 | Milan One-Sided Sofa | 27844 | `FIN-MLN-SOF-96X36` | `FIN-MLN-SOF-96X36` | Make | 5545.00 | 125.31 | freight-ltl |
| 45 | MILAN DOUBLE-SIDED SOFA 60" x 62" x 16" SH | 27849 | Milan Double-Sided Sofa | 27851 | `FIN-MLN-SOF-60X62` | `FIN-MLN-SOF-60X62` | Make | 5960.00 | 122.70 | freight-ltl |
| 46 | MILAN T-SHAPED SOFA 62" x 42" x 22" x 16" SH | 27836 | Milan One-Sided Sofa | (new) | `FIN-MLN-SOF-62X42` | `FIN-MLN-SOF-62X42` | Make | 6270.00 | 102.45 | freight-ltl |
| 47 | OCEAN ROUND SIDE TABLE 36" x 17" | 27862 | Ocean Side Table | 28451 | `FIN-OCN-SID-TAB-36X17` | `FIN-OCN-SID-TAB-36X17` | Make | 1485.00 | 149.64 | freight-ltl |
| 48 | BRAVADA COFFEE TABLE 28" x 42" x 17" | 27865 | Bravada Coffee Table | 27867 | `FIN-BRV-COF-TAB-28X42` | `FIN-BRV-COF-TAB-28X42` | Make | 2635.00 | 140.17 | freight-ltl |
| 49 | BRAVADA COFFEE TABLE 36" x 36" x 17" | 27865 | Bravada Coffee Table | 27869 | `FIN-BRV-COF-TAB-36X36` | `FIN-BRV-COF-TAB-36X36` | Make | 2635.00 | 149.64 | freight-ltl |
| 50 | BRAVADA COFFEE TABLE 36" x 56" x 17" | 27865 | Bravada Coffee Table | 27871 | `FIN-BRV-COF-TAB-36X56` | `FIN-BRV-COF-TAB-36X56` | Make | 3465.00 | 209.27 | freight-ltl |
| 51 | BRAVADA COFFEE TABLE 42" x 42" x 17" | 27865 | Bravada Coffee Table | 27875 | `FIN-BRV-COF-TAB-42X42` | `FIN-BRV-COF-TAB-42X42` | Make | 3325.00 | 188.04 | freight-ltl |
| 52 | BRAVADA COFFEE TABLE 42" x 56" x 17" | 27865 | Bravada Coffee Table | 27877 | `FIN-BRV-COF-TAB-42X56` | `FIN-BRV-COF-TAB-42X56` | Make | 3600.00 | 235.90 | freight-ltl |
| 53 | BRAVADA COFFEE TABLE 56" x 56" x 17" | 27865 | Bravada Coffee Table | 27881 | `FIN-BRV-COF-TAB-56X56` | `FIN-BRV-COF-TAB-56X56` | Make | 4990.00 | 298.06 | freight-ltl |
| 54 | OCEAN COFFEE TABLE 28" x 56" x 17" | 27902 | Ocean Coffee Table | 27906 | `FIN-OCN-COF-TAB-28X56` | `FIN-OCN-COF-TAB-28X56` | Make | 3465.00 | 173.75 | freight-ltl |
| 55 | OCEAN COFFEE TABLE 36" x 56" x 17" | 27902 | Ocean Coffee Table | 27910 | `FIN-OCN-COF-TAB-36X56` | `FIN-OCN-COF-TAB-36X56` | Make | 3740.00 | 209.27 | freight-ltl |
| 56 | OCEAN COFFEE TABLE 36" x 72" x 17" | 27902 | Ocean Coffee Table | 27912 | `FIN-OCN-COF-TAB-36X72` | `FIN-OCN-COF-TAB-36X72` | Make | 4435.00 | 256.97 | freight-ltl |
| 57 | OCEAN COFFEE TABLE 42" x 42" x 17" | 27902 | Ocean Coffee Table | 27904 | `FIN-OCN-COF-TAB-42X42` | `FIN-OCN-COF-TAB-42X42` | Make | 3600.00 | 188.04 | freight-ltl |
| 58 | OCEAN COFFEE TABLE 42" x 56" x 17" | 27902 | Ocean Coffee Table | 27916 | `FIN-OCN-COF-TAB-42X56` | `FIN-OCN-COF-TAB-42X56` | Make | 4020.00 | 235.90 | freight-ltl |
| 59 | OCEAN COFFEE TABLE 56" x 56" x 17" | 27902 | Ocean Coffee Table | 27920 | `FIN-OCN-COF-TAB-56X56` | `FIN-OCN-COF-TAB-56X56` | Make | 5265.00 | 298.06 | freight-ltl |
| 60 | OCEAN COFFEE TABLE 28" x 42" x 17" | 27902 | Ocean Coffee Table | 27914 | `FIN-OCN-COF-TAB-28X42` | `FIN-OCN-COF-TAB-28X42` | Make | 2910.00 | 140.17 | freight-ltl |
| 61 | FLY TABLE 34" X 12" | 27930 | Fly Table | 27932 | `FIN-OCN-TAB-34X12` | `FIN-OCN-TAB-34X12` | Make | 550.00 | 77.05 | freight-ltl |
| 62 | T TABLE 13" x 30" x 16" | 27948 | T Table | 27950 | `FIN-OCN-TAB-13X30` | `FIN-OCN-TAB-13X30` | Make | 550.00 | 74.67 | freight-ltl |
| 63 | STAR LEG TABLE (BAR HEIGHT) 36" x 36" x 42" | 28049 | Star Leg Table | 28055 | `FIN-BRK-BAR-TAB-36X36-BAR` | `FIN-BRK-BAR-TAB-36X36` | Make | 3465.00 | 158.55 | freight-ltl |
| 64 | STAR LEG TABLE (BAR HEIGHT) 42" x 42" x 42" | 28049 | Star Leg Table | 28061 | `FIN-BRK-BAR-TAB-42X42-BAR` | `FIN-BRK-BAR-TAB-42X42` | Make | 3600.00 | 196.95 | freight-ltl |
| 65 | STAR LEG TABLE (COUNTER HEIGHT) 36" x 36" x 36" | 28049 | Star Leg Table | 28053 | `FIN-BRK-CNT-TAB-36X36-CNT` | `FIN-BRK-CNT-TAB-36X36` | Make | 3395.00 | 156.41 | freight-ltl |
| 66 | STAR LEG TABLE (COUNTER HEIGHT) 42" x 42" x 36" | 28049 | Star Leg Table | 28065 | `FIN-BRK-CNT-TAB-42X42-CNT` | `FIN-BRK-CNT-TAB-42X42` | Make | 3535.00 | 194.81 | freight-ltl |
| 67 | STAR LEG TABLE (DINING HEIGHT) 36" x 36" x 30" | 28049 | Star Leg Table | 28051 | `FIN-BRK-DIN-TAB-36X36` | `FIN-BRK-DIN-TAB-36X36` | Make | 3328.00 | 154.27 | freight-ltl |
| 68 | STAR LEG TABLE (DINING HEIGHT) 42" x 42" x 30" | 28049 | Star Leg Table | 28063 | `FIN-BRK-DIN-TAB-42X42` | `FIN-BRK-DIN-TAB-42X42` | Make | 3465.00 | 192.67 | freight-ltl |
| 69 | DINING BENCH w/NO ARMS 72" x 22" x 18" SH | 28136 | Dining Bench w/ No Arms | 28138 | `FIN-WFT-DIN-BCH-72X22` | `FIN-WFT-DIN-BCH-72X22` | Make | 2250.00 | 88.76 | freight-ltl |
| 70 | DINING BENCH w/NO ARMS 96" x 22" x 18" SH | 28136 | Dining Bench w/ No Arms | 28140 | `FIN-WFT-DIN-BCH-96X22` | `FIN-WFT-DIN-BCH-96X22` | Make | 2772.00 | 104.63 | freight-ltl |
| 71 | FLY LEG BARSTOOL (BAR HEIGHT) 18" x 18" x 30" SH | 28141 | Fly Leg Barstool | 28145 | `FIN-WFT-FLY-BST-18X18-BAR` | `FIN-WFT-FLY-BST-18X18` | Make | 935.00 | 52.19 | freight-ltl |
| 72 | FLY LEG BARSTOOL (COUNTER HEIGHT) 18" x 18" x 24" SH | 28141 | Fly Leg Barstool | 28143 | `FIN-WFT-FLY-BST-18X18-CNT` | `FIN-WFT-FLY-BST-18X18` | Make | 902.00 | 52.19 | freight-ltl |
| 73 | FLY LEG BENCH (DINING HEIGHT) 42" x 18" x 18" SH | 28147 | Fly Leg Bench | 28149 | `FIN-WFT-BCH-42X18` | `FIN-WFT-BCH-42X18` | Make | 1525.00 | 64.66 | freight-ltl |
| 74 | FLY LEG CHAIR (DINING HEIGHT) 18" x 18" x 18" SH | 28147 | Fly Leg Bench | 28455 | `FIN-WFT-DIN-CHA-18X18` | `FIN-WFT-DIN-CHA-18X18` | Make | 865.00 | 51.98 | freight-ltl |
| 75 | HALF BACK BARSTOOL (BAR HEIGHT) 17" x 21" x 30" SH | 28157 | Half Back Barstool | 28163 | `FIN-WFT-FLY-BST-17X21-BAR` | `FIN-WFT-FLY-BST-17X21` | Make | 965.00 | 53.64 | freight-ltl |
| 76 | HALF BACK BARSTOOL (COUNTER HEIGHT) 17" x 21" x 24" SH | 28157 | Half Back Barstool | 28161 | `FIN-WFT-FLY-BST-17X21-CNT` | `FIN-WFT-FLY-BST-17X21` | Make | 925.00 | 53.64 | freight-ltl |
| 77 | TAYLOR BARSTOOL (BAR HEIGHT) 19" x 23" x 30" SH | 28164 | Taylor Barstool | 28168 | `FIN-TAY-BST-19X23-BAR` | `FIN-TAY-BST-19X23` | Make | 985.00 | 56.15 | freight-ltl |
| 78 | TAYLOR BARSTOOL (COUNTER HEIGHT) 19" x 23" x 24" SH | 28164 | Taylor Barstool | 28166 | `FIN-TAY-BST-19X23-CNT` | `FIN-TAY-BST-19X23` | Make | 955.00 | 56.15 | freight-ltl |
| 79 | TAYLOR BARSTOOL w/ARMS (BAR HEIGHT) 24" x 23" x 30" SH | 28164 | Taylor Barstool | 28494 | `FIN-TAY-BST-24X23-BAR` | `FIN-TAY-BST-24X23` | Make | 1095.00 | 59.08 | freight-ltl |
| 80 | TAYLOR CHAIR w/ARMS (DINING HEIGHT) 24" x 23" x 18" SH | 28199 | Taylor Chair w/ Arms | 28200 | `FIN-TAY-DIN-CHA-24X23` | `FIN-TAY-DIN-CHA-24X23` | Make | 1035.00 | 58.80 | freight-ltl |
| 81 | BRAVADA OTTOMAN 22" x 30" x 16" | 28206 | Bravada Ottoman | 28208 | `FIN-BRV-OTT-22X30` | `FIN-BRV-OTT-22X30` | Make | 865.00 | 61.84 | freight-ltl |
| 82 | BRAVADA OTTOMAN 22" x 42" x 16" | 28206 | Bravada Ottoman | 28210 | `FIN-BRV-OTT-22X42` | `FIN-BRV-OTT-22X42` | Make | 980.00 | 70.20 | freight-ltl |
| 83 | BRAVADA OTTOMAN 22" x 60" x 16" | 28206 | Bravada Ottoman | 28212 | `FIN-BRV-OTT-22X60` | `FIN-BRV-OTT-22X60` | Make | 1125.00 | 82.75 | freight-ltl |
| 84 | BRAVADA OTTOMAN 22" x 72" x 16" | 28206 | Bravada Ottoman | 28214 | `FIN-BRV-OTT-22X72` | `FIN-BRV-OTT-22X72` | Make | 1365.00 | 91.11 | freight-ltl |
| 85 | OCEAN OTTOMAN 30" x 22" x 16" | 28248 | Ocean Ottoman | 28250 | `FIN-OCN-OTT-30X22` | `FIN-OCN-OTT-30X22` | Make | 900.00 | 60.62 | freight-ltl |
| 86 | BRAVADA 60" ROUND SWING 72" x 12" SH | 28276 | Bravada Swing | 28438 | `FIN-BRV-SWG-72X12` | `FIN-BRV-SWG-72X12` | Make | 3600.00 | 77.35 | freight-ltl |
| 87 | BRAVADA SWING 66" x 42" x 23" BH | 28276 | Bravada Swing | 28278 | `FIN-BRV-SWG-66X42` | `FIN-BRV-SWG-66X42` | Make | 8410.00 | 107.86 | freight-ltl |
| 88 | BRAVADA SWING 72" x 42" x 23" BH | 28276 | Bravada Swing | 28280 | `FIN-BRV-SWG-72X42` | `FIN-BRV-SWG-72X42` | Make | 9515.00 | 113.38 | freight-ltl |
| 89 | BRAVADA SWING 96" x 32" x 23" BH | 28276 | Bravada Swing | 28284 | `FIN-BRV-SWG-96X32` | `FIN-BRV-SWG-96X32` | Make | 6235.00 | 120.43 | freight-ltl |
| 90 | SQUARE PILLOW 17" X 17" | 28296 | Pillow | 29022 | `FIN-CAB-MIS-17X17` | `FIN-CAB-MIS-17X17` | Make | 65.00 | 3.50 | parcel |
| 91 | SQUARE PILLOW 23" X 23" | 28296 | Pillow | 29023 | `FIN-CAB-MIS-23X23` | `FIN-CAB-MIS-23X23` | Make | 95.00 | 5.50 | parcel |
| 92 | LUMBAR PILLOW 12" X 24" | 28296 | Pillow | 29021 | `FIN-CAB-MIS-12X24` | `FIN-CAB-MIS-12X24` | Make | 65.00 | 4.00 | parcel |
| 93 | KINDLE LIVING HEATER (Allison) | 28311 | Kindle Living Heater (Allison) | 28311 | `FIN-KIN-MIS-HEATER` | `FIN-KIN-MIS` | Resale | 5695.00 | 45.00 | parcel |
| 94 | KINDLE LIVING LAMP (Allison) | 28315 | Kindle Living Lamp (Allison) | 28315 | `FIN-KIN-MIS-LAMP` | `FIN-KIN-MIS` | Resale | 5595.00 | 45.00 | parcel |
| 95 | LAYLO LOUNGER, NO RISERS | 28316 | Laylo Lounger | 28318 | `FIN-TJM-MIS-LAYLO-NORISER` | `FIN-TJM-MIS` | Resale | 599.99 | 28.00 | parcel |
| 96 | LAYLO LOUNGER W/4" RISERS | 28316 | Laylo Lounger | 28317 | `FIN-TJM-MIS-LAYLO-4RISER` | `FIN-TJM-MIS` | Resale | 729.99 | 28.00 | parcel |
| 97 | FREELO CHAIR SPLASH | 28325 | Freelo Chair Splash | 28325 | `FIN-TJM-CHA-FREELO` | `FIN-TJM-CHA` | Resale | 499.99 | 22.00 | parcel |
| 98 | TWO SHAYZ LOUNGERS FOR 5" DEPTH | 28326 | Two Shayz Loungers | 28328 | `FIN-TJM-MIS-SHAYZ-5` | `FIN-TJM-MIS` | Resale | 1599.99 | 28.00 | parcel |
| 99 | MOON CHAIR W/CUP HOLDERS | 28332 | Moon Chair w/Cup Holders | 28332 | `FIN-TJM-CHA-MOON` | `FIN-TJM-CHA` | Resale | 749.99 | 22.00 | parcel |
| 100 | TWO WOOSAH CHAIRS | 28334 | Two Woosah Chairs | 28334 | `FIN-TJM-MIS-WOOSAH` | `FIN-TJM-MIS` | Resale | 1759.99 | 28.00 | parcel |
| 101 | Ripple Table | 28335 | Ripple Table | 28335 | `FIN-TJM-TAB` | `FIN-TJM-TAB` | Resale | 464.99 | 18.00 | parcel |
| 102 | LIDO UMBRELLA | 28337 | Lido Umbrella (No Base) | (new) | `FIN-MLN-UMB` | `FIN-MLN-UMB` | Resale | 950.00 | 35.00 | parcel |
| 103 | CANTILEVER UMBRELLA w/BASE | 28343 | Cantilever Umbrella w/Base | 28343 | `FIN-CAN-UMB` | `FIN-CAN-UMB` | Resale | 5150.00 | 55.00 | freight-ltl |

### Shared-canonical alias notes

| Alias / Woo SKU | Canonical | When used |
| --- | --- | --- |
| `FIN-BRV-MIN-LOV-48X34-ARMLESS` | `FIN-BRV-MIN-LOV-48X34` | Armless mini under Armless Sofa parent |
| `FIN-BRV-DYB-84X84-RND` | `FIN-BRV-DYB-84X84` | Round daybed parent |
| `…-BAR` / `…-CNT` | matching barstool canonical | Bar vs Counter height |
| `FIN-KIN-MIS-HEATER` / `-LAMP` | `FIN-KIN-MIS` | Kindle heater vs lamp simples |
| `FIN-TJM-MIS-LAYLO-NORISER` / `-LAYLO-4RISER` | `FIN-TJM-MIS` | Laylo riser options |
| `FIN-TJM-MIS-SHAYZ-5` / `-WOOSAH` | `FIN-TJM-MIS` | Shayz / Woosah parents |
| `FIN-TJM-CHA-FREELO` / `-MOON` | `FIN-TJM-CHA` | Freelo / Moon simples |

## 4. Cart → Order Metadata PHP Hook (drop-in for PrimeView)

Paste into the child theme `functions.php` (or a small MU-plugin). This persists fabric / powder / frame and every checked ACF add-on onto the order line so WooCommerce webhooks include them in `line_items[].meta_data`.

```php
<?php
/**
 * CC Patio / Hub — persist configurator meta onto cart + order line items.
 * Target: ccpatiodev2.primeview.com
 */
add_filter('woocommerce_add_cart_item_data', function ($cart_item_data, $product_id, $variation_id) {
    $keys = [
        'fabric', 'fabric_sku', 'powder_coat', 'frame', 'frame_material',
        'ironwood', 'umbrella_cover', 'casters', 'wheels',
        'fly_tables', 'fly_table', 'fly_table_13_x_30',
        'fly_table_12_x_36_welded_on_back', 'fly_table_12_x_48_welded_on_back',
        'arms', 'arms_8_thick_textile-wrapped', 'dekton_sidearm', 'umbrella_holder',
        'coated_led_weight', 'pillow_for_loungers_w_pocket',
        'base_w_wheels', 'base_price', 'custom_welded_fly_table',
        'facing', 'select_facing',
    ];
    foreach ($keys as $key) {
        if (!isset($_REQUEST[$key])) continue;
        $val = wc_clean(wp_unslash($_REQUEST[$key]));
        if ($val === '' || $val === null) continue;
        $cart_item_data['ccp_' . $key] = $val;
    }
    return $cart_item_data;
}, 10, 3);

add_action('woocommerce_checkout_create_order_line_item', function ($item, $cart_item_key, $values, $order) {
    foreach ($values as $key => $val) {
        if (strpos($key, 'ccp_') !== 0) continue;
        $meta_key = substr($key, 4);
        $item->add_meta_data($meta_key, $val, true);
    }
}, 10, 4);
```

## 5. Checkout Webhook Contract + 16-key ACF map

`POST https://<vercel-app>/api/webhooks/woocommerce`

Headers:

- `X-WC-Webhook-Topic`: `order.created` or `order.updated`
- `X-WC-Webhook-Signature`: base64(HMAC-SHA256(secret, raw body))
- `X-WC-Webhook-Delivery-ID`: unique delivery id

Body: Woo order JSON. Every purchasable `line_items[].sku` must be the **Woo SKU** from §3 (canonical, facing `-LS`/`-RS`, or registered alias).

| Meta key | Hub behavior on `"1"` / `"yes"` / `"true"` |
| --- | --- |
| `fabric` / `fabric_sku` | finish slot → `FAB-*` |
| `powder_coat` | finish slot → `PWD-*` (Ready-Make hardcoded powder swap supported) |
| `frame` / `frame_material` | **Aluminum-only:** omit or `Aluminum` / `MET-ALUM` → `MET-ALUM`; `Steel` / `MET-STEEL` → quarantine `steel_discontinued_on_ecommerce` |
| `facing` / `select_facing` / `pa_select-facing` | **ignored** (facing already in variation SKU) |
| `ironwood` | `FIN-ESY-MIS-ADDIRONWOOD` (SO-only) |
| `umbrella_cover` | `FIN-ESY-MIS-WEATHERPROOFCO` (SO-only) |
| `casters` / `wheels` | `FIN-ESY-CHS` (SO-only) |
| `fly_tables` / `fly_table` | `FIN-OCN-TAB-34X12` (Make) |
| `fly_table_13_x_30` | `FIN-OCN-TAB-13X30` (Make) |
| `fly_table_12_x_36_welded_on_back` | `FIN-ESY-MIS-FLYTBL-12X36-WLD` (SO-only) |
| `fly_table_12_x_48_welded_on_back` | `FIN-ESY-MIS-FLYTBL-12X48-WLD` (SO-only) |
| `arms` | `FIN-ESY-MIS-ARMS` (SO-only) |
| `arms_8_thick_textile-wrapped` | `FIN-ESY-MIS-ARMS-8TEXTILE` (SO-only) |
| `dekton_sidearm` | `FIN-ESY-MIS-DKT-SIDEARM` (SO-only) |
| `umbrella_holder` | `FIN-ESY-MIS-UMBHOLDER` (SO-only) |
| `coated_led_weight` | `FIN-TJM-MIS-ONECOATED` (SO-only / Tenjam) |
| `pillow_for_loungers_w_pocket` | `FIN-TJM-MIS-PILLOWLOUNGERS` (SO-only / Tenjam) |
| `base_w_wheels` / `base_price` | `FIN-ESY-MIS-ZENBASE` (SO-only) |
| `custom_welded_fly_table` | **quarantine** `custom_quote_addon_requires_sales` (Contact Sales) |

Fulfillment routing (Hub authority):

- **Make** (no `third_party_sources`): Katana Sales Order **+** Manufacturing Order when `ORDER_PIPELINE_MODE=live`
- **Resale / SO-only add-ons** (`third_party_sources` present): Katana Sales Order **only** (MO skipped)

Phase 1 launch gate uses `ORDER_PIPELINE_MODE=log` (dry-run saga, zero Katana writes) until smoke passes.

## 6. Joint Test-Order Checklist (`ccpatiodev2` → Vercel)

- [ ] WP webhook URL = Vercel `/api/webhooks/woocommerce`; secret = Hub `WOOCOMMERCE_WEBHOOK_SECRET`
- [ ] NMI keys present in WP + Hub vault; test-mode charge succeeds
- [ ] Deposit percentage matches commercial terms; remainder captured on ship
- [ ] Paid order fires `order.updated` with `date_paid` set
- [ ] Place Corner Sofa with **Right-Side Facing** → line SKU ends in `-RS`; Hub resolves (alias → canonical)
- [ ] Place Club Chair with `ironwood=1` + fabric/powder/frame → 202, zero quarantine; add-on expands as SO-only
- [ ] Place Cantilever with `umbrella_cover=1` → cover SO line, no MO
- [ ] `custom_welded_fly_table=1` → quarantine with `custom_quote_addon_requires_sales`
- [ ] `ORDER_PIPELINE_MODE=log` dry-run completes; staged `live` flip only after Katana SO/MO spot-check
- [ ] Oh-Crap alert path verified on forced signature failure

---

*End of Phase 1 handoff for Yardi / PrimeView. Do not begin Phase 2 CSV until the Phase 2 gate in `docs/sop/CCP_PH1_PHASE_C_CLOSEOUT_PACKET.md`.*
