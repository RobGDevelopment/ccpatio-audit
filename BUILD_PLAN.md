# BUILD_PLAN — `3d-glb-and-hires-swatch-studio`

## Phase
- **phase_id:** `3d-glb-and-hires-swatch-studio`
- **base_ref:** `7c3946c`
- **target_test:** `npx vitest run tests/swatch-and-3d-asset-studio.test.ts tests/phase1-csv-and-smoke.test.ts tests/ghl-inventory-and-woo-sync.test.ts tests/primeview-handoff-portal.test.ts`

## Goal
High-Res Swatch & native `.glb` 3D Asset Pipeline across Supabase CDN, Hub Postgres, GHL master-catalog, PrimeView partner portal, Woo CSV/handoff spec, and `woo-catalog-sync.ts`.

## Allowed blast (see `.cursor/phase.lock`)
Schema + buckets + finish assets + dual-auth presign/commit APIs + GHL drawers + Partner Upload Studio + Woo meta/CSV enrichment + unit/E2E + QCA artifacts.

## Invariants (zero regression)
- 107/107 Phase 1 Mia Aluminum prices (`0` diffs), Published=1
- `sow_phase=2 AND sync_to_woo=true` = 0
- product_bom=3300, logistics_profiles=2781, finished_goods_catalog=1317
- Existing 24/24 `FAB-*` swatch URLs remain HTTP 200 until explicitly replaced
- Never put `.glb`/`.usdz` in Woo `images[]`; push 3D only via `meta_data`; omit null 3D keys on PUT
