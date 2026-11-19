# BUILD_PLAN — alu-10pct-and-two-tab-portal

**Phase ID:** `alu-10pct-and-two-tab-portal`  
**Base ref:** `8f5f0a5`  
**Target test:** `npx vitest run tests/alu10-pricing-and-two-tab.test.ts tests/phase1-csv-and-smoke.test.ts`  
**Expected blast radius:** 23 (set to match final git diff file count before QCA)

## Intent
Site-wide Aluminum-only storefront with **+10%** baked into Woo Regular price (Steel base preserved as `sow_base_steel_msrp` / `steel_msrp`), zero-data-loss Phase 1+2 COALESCE hydration, inbound resolver defaults to `MET-ALUM` (Steel quarantines), Katana SO/MO weld stamp, and Mia's 2-tab E-Commerce command center with recalculate / round-`.50` / exports.

## Allowed files
See `.cursor/phase.lock` `allowed_files`.

## Acceptance
1. Metal-framed Phase 1 Woo prices = `round(steel * 1.10, 2)`; Cabana pillows + resale stay `1.00x`.
2. Missing `frame_material` on metal Make → `MET-ALUM`; explicit Steel → `steel_discontinued_on_ecommerce`.
3. Pre/post Hub non-null snapshots never regress (`product_bom`, `logistics_profiles`, `finished_goods_catalog`).
4. Portal shows Aluminum-Only +10% policy banner, Live / Phase 2 tabs, Mia exports.
5. QCA `verdict: CERTIFIED`, `audit_exit: 0`, `blastRadius.status: PASS`.
