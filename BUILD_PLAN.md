# BUILD_PLAN — mia-pdf-aluminum-ground-truth

**Phase ID:** `mia-pdf-aluminum-ground-truth`  
**Base ref:** `a7e6f15`  
**Target test:** `npx vitest run tests/mia-aluminum-pdf-pricing.test.ts tests/phase1-csv-and-smoke.test.ts`  
**Expected blast radius:** set to match final git diff file count before QCA

## Intent
Mia's Aluminum E-Commerce Price List PDF is the **authoritative website Regular price** (Oct 1, 2026 increased base + manual `$0`/`$5` rounding). Disregard storefront MSRP / formula-only `×1.10`. Commit a deterministic JSON fixture (never the 10 MB PDF), hydrate Phase 1 (`102` SOW / `107` Woo) + Phase 2 (`162`) + Hub library with zero-data-loss COALESCE, flag missing Milan ottomans + odd-dollar PDF rows for Mia spot-check, and align the GHL portal so **Website Price (Aluminum)** is the single prominent editable column.

## Allowed files
See `.cursor/phase.lock` `allowed_files`.

## Acceptance
1. Fixture `data_migration/Pricing/mia-aluminum-pricelist-2026-11-19.json` holds ~258 parsed PDF rows; `docs/AluminumUpdate/*.pdf` is gitignored.
2. Phase 1 Woo Regular prices match Mia PDF (`Bravada Club Chair` = `2530`, etc.); 4 Milan ottomans use nearest-`$5` formula + `missing_from_mia_pdf`; 6 odd-dollar PDF rows keep exact cents + `odd_dollar_in_pdf`.
3. Portal: Website Price (Aluminum) prominent; Steel MSRP secondary/tooltip; **Needs Mia Spot-Check (7)** filter + 1-click Round to Nearest `$5`; New Product wizard defaults to `Math.round((base * 1.10) / 5) * 5`.
4. `npm run qa:lifecycle` exit 0; QCA `verdict: CERTIFIED`, `audit_exit: 0`, `blastRadius.status: PASS`.
