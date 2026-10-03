# Katana Material Catalog Bloat Report

Generated: 2026-09-14T21:52:41.377Z

Source: `C:\Workspace\ccpatio-audit\docs\Katana Downloads\MaterialList-2026-09-14-14_46.csv`

## Executive verdict

The export contains **1025 material rows**. This catalog is bloated in three different ways: (1) **blank-SKU factory placeholders** sitting next to the reminted `RM-*` / `MET-*` twins, (2) **purchasing-cousin steel/aluminum SKUs** that describe the same extrusion as Hub `RM-MET-*` recipes, and (3) **492 sub-assemblies / finished goods** (`SA-*` / `FIN-*` / `ASM-*`) that should never have been materials.

The CSV **does not include a UoM column**, so UoM findings below are **inferred risk** from SKU prefix + name (metals/extrusions → ft, fabric → yd, powder → lb, hardware → ea). Katana's historical default for a new material is **pcs**.

| Metric | Count |
| --- | ---: |
| Material rows | 1025 |
| Blank Variant code / SKU | 13 |
| Rows with a SKU | 1012 |
| Exact SKU collisions | 0 SKUs |
| Exact name collisions (different SKUs) | 26 names |
| Tubing / tube / 2x2 cluster | 25 |
| Flatbar cluster | 10 |
| Fabric cluster | 401 |
| Sunbrella-named fabrics | 2 |
| SA-/FIN-/ASM-/CUT- parked as materials | 492 |
| UoM risk flags | 435 |

## 1. Exact SKU collisions

No non-blank Variant code / SKU appears on more than one row in this export. Collisions here are **name-level and blank-SKU**, not duplicate SKU strings.

## 2. Exact name collisions (same Name, different SKUs)

**26** names are reused across different SKUs (or blank SKU vs reminted SKU). Worst offenders are the original factory placeholders next to Hub `RM-*` rows.

| Name | n | SKU / barcode / price |
| --- | --- | --- |
| 1.5X3/4 TUBING | 2 | (blank) · barcode 10024 · $1; RM-MET-15X075-TUBING · barcode 12545 · $0 |
| 2X2 METAL CAP | 2 | (blank) · barcode 10702 · $0; RM-HRD-2X2-METAL-CAP · barcode 11187 · $0 |
| 2X2 TUBING | 2 | (blank) · barcode 10023 · $1.83; RM-MET-2X2-TUBING · barcode 11459 · $1.68 |
| BRAVADA CHAISE LOUNGE DOUBLE CUSHION | 2 | SA-BRA-CL-D-CUSH · barcode 12084 · $0; SA-BRA-CL-D-A-CUSH · barcode 12085 · $0 |
| BRAVADA CHAISE LOUNGE DOUBLE FRAME | 2 | SA-BRA-CL-D-FRAME · barcode 12155 · $0; SA-BRA-CL-D-A-FRAME · barcode 12086 · $0 |
| BRAVADA CHAISE LOUNGE SINGLE CUSHION | 2 | SA-BRA-CL-S-CUSH · barcode 12445 · $0; SA-BRA-CL-S-A-CUSH · barcode 12167 · $0 |
| BRAVADA CHAISE LOUNGE SINGLE FRAME | 2 | SA-BRA-CL-S-FRAME · barcode 12168 · $0; SA-BRA-CL-S-A-FRAME · barcode 12097 · $0 |
| BRAVADA OTTOMAN 60 X 34 CUSHION | 2 | SA-BRA-O-60X34-CUSH · barcode 12441 · $0; SA-BRA-ODT-60X34-CUSH · barcode 12273 · $0 |
| BRAVADA OTTOMAN 60 X 34 FRAME | 2 | SA-BRA-O-60X34-FRAME · barcode 12442 · $0; SA-BRA-ODT-60X34-FRAME · barcode 12443 · $0 |
| BRAVADA OTTOMAN 72 X 34 CUSHION | 2 | SA-BRA-O-72X34-CUSH · barcode 12094 · $0; SA-BRA-ODT-72X34-CUSH · barcode 12444 · $0 |
| BRAVADA OTTOMAN 72 X 34 FRAME | 2 | SA-BRA-O-72X34-FRAME · barcode 12366 · $0; SA-BRA-ODT-72X34-FRAME · barcode 12367 · $0 |
| BROOKLYN CHAISE 72 X 34 CUSHION | 2 | SA-BRO-C-72X34-LS-CUSH · barcode 12014 · $0; SA-BRO-C-72X34-RS-CUSH · barcode 12024 · $0 |
| BROOKLYN CHAISE 72 X 34 FRAME | 2 | SA-BRO-C-72X34-LS-FRAME · barcode 12338 · $0; SA-BRO-C-72X34-RS-FRAME · barcode 12228 · $0 |
| BROOKLYN CHAISE 72 X 42 CUSHION | 2 | SA-BRO-C-72X42-LS-CUSH · barcode 12015 · $0; SA-BRO-C-72X42-RS-CUSH · barcode 12054 · $0 |
| BROOKLYN CHAISE 72 X 42 FRAME | 2 | SA-BRO-C-72X42-LS-FRAME · barcode 12016 · $0; SA-BRO-C-72X42-RS-FRAME · barcode 12017 · $0 |
| BROOKLYN CHAISE 84 X 34 CUSHION | 2 | SA-BRO-C-84X34-LS-CUSH · barcode 12229 · $0; SA-BRO-C-84X34-RS-CUSH · barcode 12339 · $0 |
| BROOKLYN CHAISE 84 X 34 FRAME | 2 | SA-BRO-C-84X34-LS-FRAME · barcode 12025 · $0; SA-BRO-C-84X34-RS-FRAME · barcode 12230 · $0 |
| BROOKLYN CHAISE 84 X 42 CUSHION | 2 | SA-BRO-C-84X42-LS-CUSH · barcode 12340 · $0; SA-BRO-C-84X42-RS-CUSH · barcode 12055 · $0 |
| BROOKLYN CHAISE 84 X 42 FRAME | 2 | SA-BRO-C-84X42-LS-FRAME · barcode 12231 · $0; SA-BRO-C-84X42-RS-FRAME · barcode 12056 · $0 |
| BROOKLYN CORNER SOFA 72 CUSHION | 2 | SA-BRO-CS-72-LS-CUSH · barcode 12061 · $0; SA-BRO-CS-72-RS-CUSH · barcode 12235 · $0 |
| BROOKLYN CORNER SOFA 72 FRAME | 2 | SA-BRO-CS-72-LS-FRAME · barcode 12236 · $0; SA-BRO-CS-72-RS-FRAME · barcode 12062 · $0 |
| BROOKLYN CORNER SOFA 84 CUSHION | 2 | SA-BRO-CS-84-LS-CUSH · barcode 12063 · $0; SA-BRO-CS-84-RS-CUSH · barcode 12020 · $0 |
| BROOKLYN CORNER SOFA 84 FRAME | 2 | SA-BRO-CS-84-LS-FRAME · barcode 12064 · $0; SA-BRO-CS-84-RS-FRAME · barcode 12031 · $0 |
| BROOKLYN CORNER SOFA 96 CUSHION | 2 | SA-BRO-CS-96-LS-CUSH · barcode 12237 · $0; SA-BRO-CS-96-RS-CUSH · barcode 12021 · $0 |
| BROOKLYN CORNER SOFA 96 FRAME | 2 | SA-BRO-CS-96-LS-FRAME · barcode 12032 · $0; SA-BRO-CS-96-RS-FRAME · barcode 12033 · $0 |
| OCEAN SWIVEL CHAIR FRAME | 2 | SA-OCN-SWV-CHA-FRAME · barcode 12207 · $0; SA-OCE-SC-FRAME · barcode 12131 · $0 |

## 3. Blank SKUs (factory placeholders)

**13** materials have an empty Variant code / SKU. These are the original Katana cut-list placeholders. Several were later reminted with `RM-*` SKUs, leaving both copies live.

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 2x2 Tubing | (blank SKU) | 10023 | Metal | 1.83 |
| 1.5x3/4 Tubing | (blank SKU) | 10024 | Metal | 1 |
| Flatbar | (blank SKU) | 10025 | Metal | 0.48 |
| Iron Wood | (blank SKU) | 10026 | Wood | 10.42 |
| 2x1 Tubing / 20' | (blank SKU) | 10118 | Metal | 1.39 |
| 2x3/4 Tubing | (blank SKU) | 10119 | Metal | 2.14 |
| Foam | (blank SKU) | 10175 | (none) | 0.7 |
| Fabric | (blank SKU) | 10176 | (none) | 30 |
| Dekton | (blank SKU) | 10177 | Stone | 7.6 |
| Spacers | (blank SKU) | 10701 | (none) | 0 |
| 2x2 Metal Cap | (blank SKU) | 10702 | (none) | 0 |
| Umbrella Holder | (blank SKU) | 10703 | (none) | 0 |
| Metal ring | (blank SKU) | 10704 | (none) | 0 |

## 4. Fuzzy bloat — Tubing / Tube / 2x2

**25** rows mention tubing/tube/2x2 (hardware caps excluded). This is the densest physical-item collision: blank-SKU factory tube, Hub `RM-MET-*-TUBING`, and purchasing `MET-TB*` / `MET-SQT*` cousins for the same section.

### 2X2 (6)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 2x2 Tubing | (blank SKU) | 10023 | Metal | 1.83 |
| STEEL TUBE SQ 2 X 2 X .120 | MET-SQT20012 | 11189 | Metal | 3.29 |
| 2x2 Tubing | RM-MET-2X2-TUBING | 11459 | Metal | 1.68 |
| STEEL TUBE SQ 2 X 2 X 16 GA | MET-SQT20016 | 11488 | Metal | 1.77 |
| 2 X 2 X 16GA SQ TUBE | MET-TB22060 | 11495 | Metal | 2.2 |
| 2 X 2 X 11GA SQ TUBE | MET-TB22120 | 11496 | Metal | 4.24 |

### 2X1 (6)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 2x1 Tubing / 20' | (blank SKU) | 10118 | Metal | 1.39 |
| 2x1 Tubing | RM-MET-2X1-TUBING | 11458 | Metal | 1.44 |
| STEEL TUBE RECT 1/2 X 1-1/2 X 16 GA | MET-RT05015016 | 11483 | Metal | 0.91 |
| 1-1/2 X 1/2 X 16GA REC TUBE | MET-TB11212060 | 11491 | Metal | 0.94 |
| 2 X 1 X 16GA REC TUBE | MET-TB21060 | 11493 | Metal | 1.6 |
| 2 X 1 X 11GA REC TUBE | MET-TB21120 | 11494 | Metal | 3.32 |

### other-tube (4)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| STEEL TUBE RECT 3/4 X 1-1/2 X 16 GA | MET-RT07515016 | 11484 | Metal | 1.03 |
| STEEL TUBE RECT 1 X 2 X 16 GA | MET-RT10020016 | 11485 | Metal | 1.36 |
| STEEL TUBE SQ 1-1/4 X 1-1/4 X 16 GA | MET-SQT12516 | 11487 | Metal | 1.4 |
| 3/4 X 14GA RD TUBE | MET-TBR34083 | 11500 | Metal | 0.92 |

### 2X3/4 (3)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 2x3/4 Tubing | (blank SKU) | 10119 | Metal | 2.14 |
| 1-1/2 X 3/4 X 16GA REC TUBE | MET-TB11234060 | 11492 | Metal | 1.21 |
| 2 X 3/4 X 16GA REC TUBE | MET-TB234060 | 11497 | Metal | 2.14 |

### 1.5X3/4 (2)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 1.5x3/4 Tubing | (blank SKU) | 10024 | Metal | 1 |
| 1.5x3/4 Tubing | RM-MET-15X075-TUBING | 12545 | (none) | 0 |

### 3X3 (1)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| STEEL TUBE SQ 3 X 3 X 16 GA | MET-SQT30016 | 11489 | Metal | 2.71 |

### 1X1 (1)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 1 X 1 X 16GA SQ TUBE | MET-TB11060 | 11490 | Metal | 0.96 |

### 3X2 (1)

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| 3 X 2 X 16GA REC TUBE | MET-TB32060 | 11498 | Metal | 2.76 |

## 5. Fuzzy bloat — Flatbar / Flat bar

**10** rows look like flat bar (factory `Flatbar`, Hub `RM-MET-FLATBAR` if present, and purchasing `MET-FH*` / `MET-10019*` HR flats).

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| Flatbar | (blank SKU) | 10025 | Metal | 0.48 |
| HR STEEL FLAT 3/16 X 1-1/2 | MET-10019150 | 11468 | Metal | 1.15 |
| HR STEEL FLAT 3/16 X 2 | MET-10019200 | 11469 | Metal | 1.3 |
| HR STEEL FLAT 3/16 X 3 | MET-10019300 | 11470 | Metal | 1.78 |
| HR STEEL FLAT 1/4 X 2 | MET-10025200 | 11471 | Metal | 2.16 |
| HR STEEL FLAT 1/4 X 3 | MET-10025300 | 11472 | Metal | 4.03 |
| 1/4 X 1 HR FLAT BAR | MET-FH141 | 11476 | Metal | 0.88 |
| 1/8 X 1-1/2 HR FLAT BAR | MET-FH18112 | 11477 | Metal | 0.75 |
| 3/16 X 1-1/2 HR FLAT BAR | MET-FH316112 | 11478 | Metal | 1.06 |
| 3/16 X 2 HR FLAT BAR | MET-FH3162 | 11479 | Metal | 1.32 |

## 6. Fuzzy bloat — Fabric / Sunbrella / color twins

**401** fabric-like rows (2 with "Sunbrella" in the name). Most are legitimate `FAB-*` colorways at $20/yd. Bloat is the generic placeholders plus near-duplicate color names.

Exact fabric name collisions:

None after name normalization.

Near-duplicate fabric names (prefix / one-edit):

| Name A | SKU A | Name B | SKU B |
| --- | --- | --- | --- |
| CANVAS FAWN | FAB-CAN-FAW | CANVAS FERN | FAB-CAN-FER |
| CANVAS JAVA | FAB-CAN-JAV | CANVAS NAVY | FAB-CAN-NAV |
| CANVAS SMOKE | FAB-CAN-SMO | CANVAS STONE | FAB-CAN-STO |
| CAST SHALE | FAB-CAS-SHA | CAST SLATE | FAB-CAST-SLAT |
| GATEAWAY COAST | FAB-GATEA-COAST | GATEWAY COAST | FAB-GATEW-COAST |
| LINVILLE OYSTER | FAB-LIN-OYS | LYNVILLE OYSTER | FAB-LYN-OYS |
| PLAY ADOBE | FAB-PLAY-ADOB | PLAY ADOVE | FAB-PLAY-ADOV |
| PLAY CAMEL | FAB-PLAY-CAMEL | PLAY CAMEO | FAB-PLAY-CAMEO |
| SAVVY ONYX | FAB-SAVV-ONYX | SAVY ONYX | FAB-SAVY-ONYX |
| TROPIC JUNGLE | FAB-TROPIC-JUNGLE | TROPICS JUNGLE | FAB-TROPICS-JUNGLE |

Fabric placeholders vs colorways:

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| Fabric | (blank SKU) | 10176 | (none) | 30 |
| TEST FABRIC - RAW | RM-FAB-TEST-FABRIC-RAW | 11510 | Fabric | 20 |
| Fabric (generic placeholder) | RM-FAB-GENERIC | 12225 | (none) | 0 |

## 7. UoM inconsistencies (inferred — export has no UoM column)

Katana's material export used here only has Name / SKU / barcode / Category / supplier / price. **Actual UoM is not in the file.** Flags below are the items that *will be wrong* if they are still on Katana's default **pcs**, or if the MET-/PWD- prefix dictionary is applied blindly.

| Risk class | Count |
| --- | ---: |
| Metal / extrusion expected **ft** (not pcs) | 35 |
| Fabric expected **yd** (not pcs) | 397 |
| Prefix lies (PWD- non-powder, MET- hardware) | 3 |

### Metals / extrusions expected ft

| Name | SKU | Category | Price | Risk |
| --- | --- | --- | --- | --- |
| 2x2 Tubing | (blank SKU) | Metal | 1.83 | metal extrusion with blank SKU — Katana factory placeholders historically default to pcs; expected ft (blank-SKU metal extrusion (name)) |
| 1.5x3/4 Tubing | (blank SKU) | Metal | 1 | metal extrusion with blank SKU — Katana factory placeholders historically default to pcs; expected ft (blank-SKU metal extrusion (name)) |
| Flatbar | (blank SKU) | Metal | 0.48 | metal extrusion with blank SKU — Katana factory placeholders historically default to pcs; expected ft (blank-SKU metal extrusion (name)) |
| 2x1 Tubing / 20' | (blank SKU) | Metal | 1.39 | metal extrusion with blank SKU — Katana factory placeholders historically default to pcs; expected ft (blank-SKU metal extrusion (name)) |
| 2x3/4 Tubing | (blank SKU) | Metal | 2.14 | metal extrusion with blank SKU — Katana factory placeholders historically default to pcs; expected ft (blank-SKU metal extrusion (name)) |
| STEEL TUBE SQ 2 X 2 X .120 | MET-SQT20012 | Metal | 3.29 | linear metal SKU MET-SQT20012 — expected ft, not pcs |
| 2x1 Tubing | RM-MET-2X1-TUBING | Metal | 1.44 | linear metal SKU RM-MET-2X1-TUBING — expected ft, not pcs |
| 2x2 Tubing | RM-MET-2X2-TUBING | Metal | 1.68 | linear metal SKU RM-MET-2X2-TUBING — expected ft, not pcs |
| HR STEEL FLAT 3/16 X 1-1/2 | MET-10019150 | Metal | 1.15 | linear metal SKU MET-10019150 — expected ft, not pcs |
| HR STEEL FLAT 3/16 X 2 | MET-10019200 | Metal | 1.3 | linear metal SKU MET-10019200 — expected ft, not pcs |
| HR STEEL FLAT 3/16 X 3 | MET-10019300 | Metal | 1.78 | linear metal SKU MET-10019300 — expected ft, not pcs |
| HR STEEL FLAT 1/4 X 2 | MET-10025200 | Metal | 2.16 | linear metal SKU MET-10025200 — expected ft, not pcs |
| HR STEEL FLAT 1/4 X 3 | MET-10025300 | Metal | 4.03 | linear metal SKU MET-10025300 — expected ft, not pcs |
| 1/4 X 1 HR FLAT BAR | MET-FH141 | Metal | 0.88 | linear metal SKU MET-FH141 — expected ft, not pcs |
| 1/8 X 1-1/2 HR FLAT BAR | MET-FH18112 | Metal | 0.75 | linear metal SKU MET-FH18112 — expected ft, not pcs |
| 3/16 X 1-1/2 HR FLAT BAR | MET-FH316112 | Metal | 1.06 | linear metal SKU MET-FH316112 — expected ft, not pcs |
| 3/16 X 2 HR FLAT BAR | MET-FH3162 | Metal | 1.32 | linear metal SKU MET-FH3162 — expected ft, not pcs |
| STEEL TUBE RECT 1/2 X 1-1/2 X 16 GA | MET-RT05015016 | Metal | 0.91 | linear metal SKU MET-RT05015016 — expected ft, not pcs |
| STEEL TUBE RECT 3/4 X 1-1/2 X 16 GA | MET-RT07515016 | Metal | 1.03 | linear metal SKU MET-RT07515016 — expected ft, not pcs |
| STEEL TUBE RECT 1 X 2 X 16 GA | MET-RT10020016 | Metal | 1.36 | linear metal SKU MET-RT10020016 — expected ft, not pcs |
| STEEL TUBE SQ 1-1/4 X 1-1/4 X 16 GA | MET-SQT12516 | Metal | 1.4 | linear metal SKU MET-SQT12516 — expected ft, not pcs |
| STEEL TUBE SQ 2 X 2 X 16 GA | MET-SQT20016 | Metal | 1.77 | linear metal SKU MET-SQT20016 — expected ft, not pcs |
| STEEL TUBE SQ 3 X 3 X 16 GA | MET-SQT30016 | Metal | 2.71 | linear metal SKU MET-SQT30016 — expected ft, not pcs |
| 1 X 1 X 16GA SQ TUBE | MET-TB11060 | Metal | 0.96 | linear metal SKU MET-TB11060 — expected ft, not pcs |
| 1-1/2 X 1/2 X 16GA REC TUBE | MET-TB11212060 | Metal | 0.94 | linear metal SKU MET-TB11212060 — expected ft, not pcs |
| 1-1/2 X 3/4 X 16GA REC TUBE | MET-TB11234060 | Metal | 1.21 | linear metal SKU MET-TB11234060 — expected ft, not pcs |
| 2 X 1 X 16GA REC TUBE | MET-TB21060 | Metal | 1.6 | linear metal SKU MET-TB21060 — expected ft, not pcs |
| 2 X 1 X 11GA REC TUBE | MET-TB21120 | Metal | 3.32 | linear metal SKU MET-TB21120 — expected ft, not pcs |
| 2 X 2 X 16GA SQ TUBE | MET-TB22060 | Metal | 2.2 | linear metal SKU MET-TB22060 — expected ft, not pcs |
| 2 X 2 X 11GA SQ TUBE | MET-TB22120 | Metal | 4.24 | linear metal SKU MET-TB22120 — expected ft, not pcs |
| 2 X 3/4 X 16GA REC TUBE | MET-TB234060 | Metal | 2.14 | linear metal SKU MET-TB234060 — expected ft, not pcs |
| 3 X 2 X 16GA REC TUBE | MET-TB32060 | Metal | 2.76 | linear metal SKU MET-TB32060 — expected ft, not pcs |
| 4 X 2 X 16GA REC TUBE | MET-TB42060 | Metal | 3.3 | linear metal SKU MET-TB42060 — expected ft, not pcs |
| 3/4 X 14GA RD TUBE | MET-TBR34083 | Metal | 0.92 | linear metal SKU MET-TBR34083 — expected ft, not pcs |
| 1.5x3/4 Tubing | RM-MET-15X075-TUBING |  | 0 | linear metal SKU RM-MET-15X075-TUBING — expected ft, not pcs |

### Fabrics expected yd

All **397** fabric rows are expected **yd**. Worst offenders for a pcs trap are the blank-SKU generic `Fabric` and `RM-FAB-GENERIC` placeholder.

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| Fabric | (blank SKU) | 10176 | (none) | 30 |
| ACTION ASH | FAB-ACT-ASH | 10717 | Fabric | 20 |
| ACTION STONE | FAB-ACT-STO | 10721 | Fabric | 20 |
| ADAPTATION INDIGO | FAB-ADA-IND | 10722 | Fabric | 20 |
| ADAPTATION STONE | FAB-ADA-STO | 10723 | Fabric | 20 |
| ADENA CELESTE | FAB-ADE-CEL | 10724 | Fabric | 20 |
| AGRA INDIGO | FAB-AGR-IND | 10725 | Fabric | 20 |
| ARIANA DEW | FAB-ARI-DEW | 10726 | Fabric | 20 |

### Prefix dictionary would assign the wrong UoM

| Name | SKU | Category | Price | Risk |
| --- | --- | --- | --- | --- |
| METAL CUTTING BLADE | MET-102841 | Metal | 121.95 | MET-* prefix dictionary would assign ft, but this is hardware/consumable — expected ea/pcs |
| ALUMINUM CUTTING BLADE | MET-EVOLUTION14BLADEAL | Metal | 125 | MET-* prefix dictionary would assign ft, but this is hardware/consumable — expected ea/pcs |
| RAGS | MET-RAGWWK | Metal | 1.55 | MET-* prefix dictionary would assign ft, but this is hardware/consumable — expected ea/pcs |

## 8. Wrong item type — SA-/FIN-/ASM parked as materials

**492** rows use sub-assembly or finished-good SKUs inside the **Materials** export. These inflate the catalog, collide with product variants, and are the duplicate-SKU problem seen on the live tenant (two variant IDs per SA-FRAME). They are not raw materials.

| Prefix | Count |
| --- | --- |
| SA- | 492 |

Examples:

| Name | SKU | Barcode | Category | Price |
| --- | --- | --- | --- | --- |
| BROOKLYN TABLE (BAR HEIGHT) 28 X 120 FRAME | SA-BRK-BAR-TAB-120X28-FRAME | 12332 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 36 X 120 FRAME | SA-BRK-BAR-TAB-120X36-FRAME | 12333 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 28" x 120" x 42" FRAME | SA-BRK-BAR-TAB-28X120-FRAME | 12022 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 28" x 72" x 42" FRAME | SA-BRK-BAR-TAB-28X72-FRAME | 12334 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 28" x 96" x 42" FRAME | SA-BRK-BAR-TAB-28X96-FRAME | 12226 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 36" x 120" x 42" FRAME | SA-BRK-BAR-TAB-36X120-FRAME | 12335 | (none) | 0 |
| STAR LEG TABLE (BAR HEIGHT) 36" x 36" x 42" FRAME | SA-BRK-BAR-TAB-36X36-FRAME | 12050 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 36" x 72" x 42" FRAME | SA-BRK-BAR-TAB-36X72-FRAME | 12051 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 36" x 96" x 42" FRAME | SA-BRK-BAR-TAB-36X96-FRAME | 12023 | (none) | 0 |
| STAR LEG TABLE (BAR HEIGHT) 42" x 42" x 42" FRAME | SA-BRK-BAR-TAB-42X42-FRAME | 12052 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 28 X 72 FRAME | SA-BRK-BAR-TAB-72X28-FRAME | 12227 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 36 X 72 FRAME | SA-BRK-BAR-TAB-72X36-FRAME | 12053 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 36 X 96 FRAME | SA-BRK-BAR-TAB-96X36-FRAME | 12336 | (none) | 0 |
| BROOKLYN TABLE (BAR HEIGHT) 28 X 96 FRAME | SA-BRK-BAR-TAB-98X28-FRAME | 12337 | (none) | 0 |
| Brooklyn Chaise 72 x 34 Cushion | SA-BRO-C-72X34-LS-CUSH | 12014 | (none) | 0 |
| Brooklyn Chaise 72 x 34 Cushion | SA-BRO-C-72X34-RS-CUSH | 12024 | (none) | 0 |
| Brooklyn Chaise 72 x 34 Frame | SA-BRO-C-72X34-LS-FRAME | 12338 | (none) | 0 |
| Brooklyn Chaise 72 x 34 Frame | SA-BRO-C-72X34-RS-FRAME | 12228 | (none) | 0 |
| Brooklyn Chaise 72 x 42 Cushion | SA-BRO-C-72X42-LS-CUSH | 12015 | (none) | 0 |
| Brooklyn Chaise 72 x 42 Cushion | SA-BRO-C-72X42-RS-CUSH | 12054 | (none) | 0 |

_Showing 20 of 492._

## 9. Prefix and category mix

| SKU prefix | Count |
| --- | --- |
| SA- | 492 |
| FAB- | 396 |
| STN- | 70 |
| MET- | 34 |
| (blank SKU) | 13 |
| RM- | 11 |
| PWD- | 9 |

| Category | Count |
| --- | --- |
| (none) | 500 |
| Fabric | 397 |
| Dekton | 71 |
| Metal | 41 |
| Powder | 10 |
| Packaging | 3 |
| Wood | 1 |
| Stone | 1 |
| Hardware | 1 |

## Recommended next actions

1. **Do not POST duplicates.** The six missing Hub materials from `katana-material-sync` (`RM-HRD-SPACERS`, `RM-HRD-UMBRELLA-HOLDER`, `RM-MET-2X075-TUBING`, `RM-MET-FLATBAR`, `RM-RAW-FOAM`, `RM-RAW-IRON-WOOD`) must be created on the *blank-SKU placeholders if they still exist*, or as new SKUs — not as a third 2x2/foam/wood copy.
2. **Archive blank-SKU factory twins** once the `RM-*` remint is the recipe ingredient (e.g. blank `2x2 Tubing` barcode 10023 vs `RM-MET-2X2-TUBING`).
3. **Keep purchasing `MET-TB*` / `MET-SQT*` / `MET-FH*` as buy-side SKUs**; do not use them as BOM ingredients. Recipes stay on `RM-MET-*`.
4. **Move `SA-*` / `FIN-*` out of Materials** (convert or archive). They belong on Products.
5. **Fix UoM on remaining factory metals/fabrics to ft / yd** before the BOM re-import, especially blank-SKU tubing/flatbar/fabric.
6. **Rename or archive PWD- miskeys** (`PWD-HIGH-TEMP-SILICONE-TAPERED-MASKING-PLUGS`, `PWD-METAL-WIRE-FOR-HANGING-FRAMES`) — they are not powder and must not consume as lb.

