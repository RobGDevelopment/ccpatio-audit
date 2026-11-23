# BUILD_PLAN — `phase1-final-10gate-greenlight`

**Base:** `27efe1d`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true (expected = 26)

## Intent

Close the five remaining cold-start QA findings with zero regressions
(`product_bom=3300`, `logistics_profiles=2781`, `finished_goods_catalog=1317`,
Mia Aluminum prices, `Published=1` on all 107 Phase 1 purchasables).

## Workstreams

1. **Gate 10 / P0** — Hub Postgres `katana_showroom_snapshot` + `katana_sync_meta`;
   SSR + `GET/POST /api/katana/showroom-inventory` read Hub only (&lt;300ms);
   seed script with 429 backoff; dual embed auth (header + cookie); proxy must
   not strip `x-ccpatio-embed-token` on `/api/*`.
2. **Gate 6 / P1** — `/api/embed/refresh-token` header path returns 200;
   `EmbedSessionProvider` mutable ref + `getEmbedHeaders()`.
3. **Gate 4b / P1** — Delete `FIN-BRV-ARM-SOF-72X34` null orphan; backfill 14
   facing/BAR/CNT `woo_sku` rows; remappoint 8 OCN/DYB shells onto Phase 1
   canons → **107/107** distinct `woo_sku`.
4. **Gate 2+5 / P2** — Prefix `Meta: acf_fabric_swatches_json`; dual umbrella
   cover (Lido $100 + Cantilever $150) checkout test.
5. **QA** — `tests/showroom-snapshot-and-refresh.test.ts`, full vitest,
   `qa:lifecycle`, QCA CERTIFIED, commit/push, live hub.ccpatio.com probes.

## Target test

```bash
npx vitest run tests/showroom-snapshot-and-refresh.test.ts tests/phase1-csv-and-smoke.test.ts tests/swatch-and-3d-asset-studio.test.ts tests/ghl-inventory-and-woo-sync.test.ts tests/phase1-p0-remediation.test.ts
```
