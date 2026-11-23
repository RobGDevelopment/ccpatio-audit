# BUILD_PLAN — `showroom-sales-restore-and-ci-seal`

**Base:** `a272e7b`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true (expected = 29)

## Intent

Restore sales-curated `/embed/showroom` over Hub `katana_showroom_snapshot` +
`inventory_holds` (`<300ms`, zero live Katana on page load, zero
`ecommerce_listings` coupling). Move raw `katana-ops` dump to
`/embed/ops-inventory`. Seal Phase 1 CI (`pim-dictionary`) and Gate-1 Mia
spot-check = exact `7`. Preserve `product_bom=3300`,
`logistics_profiles=2781`, `finished_goods_catalog=1317`, `107/107`
`ecommerce_listings`.

## Workstreams

1. **Sales projection** — `projectShowroomSalesView()`: shop-floor exclusion,
   1 card/SKU warehouse rollup, 6 tabs (Floor RTS / 3rd-Party / Fabrics /
   Dekton / MTO / Active Holds), hold badge without double-subtract,
   Order Desk MTO deep-link with embed token.
2. **Ops move** — `/embed/ops-inventory` (+ `/admin/ops-inventory`) keeps
   `inventoryMode="katana-ops"`; `/embed/showroom` is sales-only.
3. **Holds** — re-enable Place/Release/Lifecycle; all hold + GHL search
   actions accept embed token header OR cookie; refresh snapshot variant
   after hold mutate (no double-subtract of already-synced HOLD-*).
4. **CI seal** — Postgres service + env secrets in
   `.github/workflows/middleware.yml`; regenerate Phase 1 CSV/handoff;
   scope Fly Leg odd-dollar to `FIN-WFT-FLY-BST-18X18-CNT` only.
5. **QA** — unit + E2E, `qa:lifecycle`, QCA CERTIFIED, commit/push, live
   + Actions green.

## Target test

```bash
npx vitest run tests/showroom-sales-projection.test.ts tests/showroom-snapshot-and-refresh.test.ts tests/phase1-csv-and-smoke.test.ts tests/mia-aluminum-pdf-pricing.test.ts
```
