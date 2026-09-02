# Katana ↔ Local PIM Gap Analysis

_Generated: 2026-09-01T01:01:30.540Z_  
_Katana pull timestamp: 2026-09-01T01:00:23.665Z_  
_Local comparison source: live Supabase (POSTGRES_URL)_

## Pull summary

| Endpoint | Status | Records | Pages | Notes |
|----------|--------|---------|-------|-------|
| `/products` | OK | 153 | 1 |  |
| `/variants` | OK | 854 | 4 | SKU matching key |
| `/materials` | OK | 13 | 1 | |
| `/recipes` | OK | 934 | 4 | BOM/recipe rows |
| `/product_operation_rows` | OK | 1512 | 7 | standard product operations |
| `/operations` | FAIL | 0 | 1 | HTTP 404 Not Found |

## A) SKU overlap — Katana vs local

| Metric | Count |
|--------|------:|
| Katana variants (with SKU) | 839 |
| Local `sku_mappings` | 912 |
| Seed file (`sku-seed-data.json`) | 911 |
| **Matching SKUs** (in both Katana + local) | **0** |
| **Local-only** (in DB/seed, not in Katana) | **912** |
| **Katana-only** (in Katana, not in local) | **839** |
| Seed matches Katana | 0 |
| Seed missing from Katana | 911 |
| `finished_goods_catalog` rows (DB) | 223 |

### SKU namespace mismatch (root cause of 0 exact matches)

Katana and the local PIM use **different SKU taxonomies**. Katana carries legacy factory configurables (`BRA-*`, `DBT-*`, `D-*` Dekton); local `sku_mappings` uses Global E2E prefixes (`FIN-*`, `FAB-*`, `STN-DKT-*`, `FRP-*`, etc.).

**Katana variant prefix distribution (top):**

```json
{
  "BRA": 371,
  "OCE": 198,
  "D": 132,
  "BRO": 132,
  "DBT": 6
}
```

**Local sku_mappings prefix distribution (top):**

```json
{
  "FAB": 396,
  "FIN": 211,
  "FUR": 146,
  "STN": 70,
  "MET": 34,
  "FRP": 24,
  "SHD": 21,
  "PWD": 9,
  "RM": 1
}
```

Exact string matching cannot link these namespaces without an explicit **alias / crosswalk table** (e.g. `sku_aliases` or a regenerated mapping from factory Base SKU → Global E2E SKU).

### Katana-only SKUs (first 50)

- BRA-AL-60-BE
- BRA-AL-60-BL
- BRA-AL-60-BO
- BRA-AL-60-BR
- BRA-AL-60-GR
- BRA-AL-60-WH
- BRA-AS-72-BE
- BRA-AS-72-BL
- BRA-AS-72-BO
- BRA-AS-72-BR
- BRA-AS-72-GR
- BRA-AS-72-WH
- BRA-AS-84-BE
- BRA-AS-84-BL
- BRA-AS-84-BO
- BRA-AS-84-BR
- BRA-AS-84-GR
- BRA-AS-84-WH
- BRA-AS-96-BE
- BRA-AS-96-BL
- BRA-AS-96-BO
- BRA-AS-96-BR
- BRA-AS-96-GR
- BRA-AS-96-WH
- BRA-C-34X72-BL
- BRA-C-34X72-LS-BE
- BRA-C-34X72-LS-BO
- BRA-C-34X72-LS-BR
- BRA-C-34X72-LS-GR
- BRA-C-34X72-LS-WH
- BRA-C-34X72-RS-BE
- BRA-C-34X72-RS-BL
- BRA-C-34X72-RS-BO
- BRA-C-34X72-RS-BR
- BRA-C-34X72-RS-GR
- BRA-C-34X72-RS-WH
- BRA-C-34X84-LS-BE
- BRA-C-34X84-LS-BL
- BRA-C-34X84-LS-BR
- BRA-C-34X84-LS-GR
- BRA-C-34X84-LS-WH
- BRA-C-34X84-RS-BE
- BRA-C-34X84-RS-BL
- BRA-C-34X84-RS-BR
- BRA-C-34X84-RS-GR
- BRA-C-34X84LS-BO
- BRA-C-34X84RS-BO
- BRA-C-34X84RS-WH
- BRA-C-42X72-LS-BE
- BRA-C-42X72-LS-BL
- _…and 789 more_


### Local-only SKUs (first 50)

- FAB-ACT-ASH
- FAB-ACT-STO
- FAB-ADA-IND
- FAB-ADA-STO
- FAB-ADE-CEL
- FAB-AGR-IND
- FAB-ARI-DEW
- FAB-ARR-CAL
- FAB-ARR-CAR
- FAB-ARR-DUN
- FAB-ASC-SPA
- FAB-ASC-TRO
- FAB-ASS-IITEA
- FAB-ASS-SAN
- FAB-AUT-PEB
- FAB-BEA-BEA
- FAB-BEA-ULT
- FAB-BER-TUX
- FAB-BLE-IND
- FAB-BLE-LIN
- FAB-BLE-MIS
- FAB-BLE-SAN
- FAB-BLI-ALO
- FAB-BLI-ASP
- FAB-BLI-CLA
- FAB-BLI-DEW
- FAB-BLI-GUA
- FAB-BLI-LEM
- FAB-BLI-LIN
- FAB-BLI-SAN
- FAB-BLI-SMO
- FAB-BOR-IND
- FAB-BRA-RED
- FAB-BRA-WHI
- FAB-BUN-ULT
- FAB-CAB-CLA
- FAB-CAL-LAU
- FAB-CAN-ABB
- FAB-CAN-AIRBLU
- FAB-CAN-ANTBEI
- FAB-CAN-BIREYE
- FAB-CAN-BLA
- FAB-CAN-CAN
- FAB-CAN-CAP
- FAB-CAN-CHA
- FAB-CAN-CHE
- FAB-CAN-CLO
- FAB-CAN-COA
- FAB-CAN-COC
- FAB-CAN-FAW
- _…and 862 more_


## B) Products without BOM/Recipe

| Metric | Count |
|--------|------:|
| Katana product variants (has `product_id`) | 841 |
| Product variants with ≥1 recipe row | 207 |
| **Product variants lacking recipe/BOM** | **634** |

### Product variants without recipes (first 40)

-  (variant_id=41110300)
- BRA-AL-60-BE (variant_id=41069095)
- BRA-AL-60-BO (variant_id=41069096)
- BRA-AL-60-BR (variant_id=41069094)
- BRA-AL-60-GR (variant_id=41069097)
- BRA-AL-60-WH (variant_id=41069093)
- BRA-AS-72-BE (variant_id=41069102)
- BRA-AS-72-BO (variant_id=41069103)
- BRA-AS-72-BR (variant_id=41069101)
- BRA-AS-72-GR (variant_id=41069104)
- BRA-AS-72-WH (variant_id=41069100)
- BRA-AS-84-BE (variant_id=41069110)
- BRA-AS-84-BO (variant_id=41069111)
- BRA-AS-84-BR (variant_id=41069109)
- BRA-AS-84-GR (variant_id=41069112)
- BRA-AS-84-WH (variant_id=41069108)
- BRA-AS-96-BE (variant_id=41069118)
- BRA-AS-96-BO (variant_id=41069119)
- BRA-AS-96-BR (variant_id=41069117)
- BRA-AS-96-GR (variant_id=41069120)
- BRA-AS-96-WH (variant_id=41069116)
- BRA-C-34X72-LS-BE (variant_id=41069224)
- BRA-C-34X72-LS-BO (variant_id=41069225)
- BRA-C-34X72-LS-BR (variant_id=41069223)
- BRA-C-34X72-LS-GR (variant_id=41069226)
- BRA-C-34X72-LS-WH (variant_id=41069222)
- BRA-C-34X72-RS-BE (variant_id=41069230)
- BRA-C-34X72-RS-BL (variant_id=41069227)
- BRA-C-34X72-RS-BO (variant_id=41069231)
- BRA-C-34X72-RS-BR (variant_id=41069229)
- BRA-C-34X72-RS-GR (variant_id=41069232)
- BRA-C-34X72-RS-WH (variant_id=41069228)
- BRA-C-34X84-LS-BE (variant_id=41069373)
- BRA-C-34X84-LS-BR (variant_id=41069372)
- BRA-C-34X84-LS-GR (variant_id=41069375)
- BRA-C-34X84-LS-WH (variant_id=41069371)
- BRA-C-34X84-RS-BE (variant_id=41069379)
- BRA-C-34X84-RS-BL (variant_id=41069376)
- BRA-C-34X84-RS-BR (variant_id=41069378)
- BRA-C-34X84-RS-GR (variant_id=41069381)
- _…and 594 more_


## C) Standard operations in Katana

_Source: `/product_operation_rows` (1512 rows)_

| Operation name | Row count |
|----------------|----------:|
| Building & Welding | 168 |
| Cushion Stuffing | 108 |
| Dekton Cutting | 60 |
| Dekton Grinding | 60 |
| Dekton Polishing | 60 |
| Fabric Cutting | 108 |
| Fabric Sewing | 108 |
| Material Handling | 60 |
| Metal Cutting | 168 |
| Metal Grinding | 168 |
| Metal Powder Coating | 168 |
| Metal Sandblasting | 168 |
| Quality Check | 108 |

## D) Katana ID mapping vs `sku_mappings`

| Metric | Count |
|--------|------:|
| Local rows with matching Katana SKU (exact) | 0 |
| Local rows with any `katana_variant_id` or `katana_material_id` set | 0 |
| Stored Katana variant IDs not found in live pull | 0 |
| Local rows with **no** Katana IDs but exact SKU exists in Katana | 0 |
| Local IDs **match** Katana variant_id (exact SKU) | 0 |
| Local IDs **mismatch** Katana (exact SKU) | 0 |
| Stale / partial ID issues | 0 |

**Recommendation:** SKU-string backfill (`db:backfill-katana`) cannot work until a crosswalk maps Global E2E SKUs → Katana legacy SKUs. Build aliases from Website Product Info Base SKU / finished-good rules, then backfill IDs from `docs/katana_live_state/variants.json`.

### ID mismatch samples

_None._


## Engineering next steps

1. **Build SKU crosswalk** — 0 exact SKU matches because Katana uses legacy factory codes vs Global E2E dictionary. Priority: map `FIN-*` / Base SKU ↔ `BRA-*` / `DBT-*` before any sync.
2. **Reconcile orphans** — 839 Katana SKUs absent from PIM; 912 PIM SKUs absent from Katana (mostly fabrics/Dekton not yet pushed).
3. **BOM gap** — 634 of 841 Katana product variants have no recipe rows (75%).
4. **ID backfill** — 0 local rows have Katana IDs stored; 0 stored IDs are stale vs live pull. String-match backfill is blocked until crosswalk exists.
5. **Operations parity** — Katana has 13 distinct standard operations on 1512 `product_operation_rows`; seed into local `item_operations` or treat Katana as SoT for routing.
6. **Push vs pull strategy** — Spreadsheets built the PIM; Katana holds production configurables. Decide per category: import Katana FG into PIM vs push PIM materials into Katana.

