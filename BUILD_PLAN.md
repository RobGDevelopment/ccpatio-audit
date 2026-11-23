# BUILD_PLAN — `showroom-option-a-flagged-polish`

**Base:** `a269cda`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true

## Intent

Polish the curated `/embed/showroom` sales view (Option A) while preserving 100% of
Make-to-Order Catalog projection + Order Desk deep-link code behind feature flags
(default **off**). Do not touch Phase 1 `ecommerce_listings` (107/107),
`product_bom=3300`, `logistics_profiles=2781`, or `finished_goods_catalog=1317`.

## Workstreams

1. **Feature flags** — `getShowroomFeatureFlags()` with
   `NEXT_PUBLIC_SHOWROOM_MTO_CATALOG_ENABLED` / `NEXT_PUBLIC_SHOWROOM_ORDER_DESK_CTA_ENABLED`
   (default false). When true: MTO tab + Order Desk CTAs + `?from=showroom` back link.
2. **5-tab bar** — Fabrics (default) → Dekton Slabs → 3rd-Party Retail →
   Floor & Ready-to-Ship → Active Customer Holds (live count badge). MTO tab only when flagged.
3. **Catalog hygiene** — Exclude `FIN-JOB-*` / `JOB - *` / `FIN-SRV-*` / `FIN-CUS-*` /
   customer-fabric one-offs from Floor; strict Dekton slab materials only; retail image
   cross-fill from `finished_goods_catalog` / `product_assets` (never `ecommerce_listings`).
4. **Hold UX** — Disable Place Hold when `available <= 0` (`Fully Held` / `Out of Stock`);
   show real Katana UOM (slab/pcs/ea/yd) for Dekton holds.
5. **QA** — Dual-mode vitest (`flags=false` + `flags=true`) + `qa:lifecycle` + QCA CERTIFIED
   + commit/push + live proof (`0` FIN-JOB-*, `0` MET-*, `3` Dekton holds, `<1s`).

## Target test

```bash
npx vitest run tests/showroom-option-a-flags.test.ts
```
