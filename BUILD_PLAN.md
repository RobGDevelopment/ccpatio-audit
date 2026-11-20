# BUILD_PLAN — phase1-redteam-closeout

**Phase ID:** `phase1-redteam-closeout`  
**Intent:** Close all 7 independent red-team HOLD findings with zero data loss (`product_bom=3300`, `logistics_profiles=2781`, `finished_goods_catalog=1317`).

## Allowed files

See `.cursor/phase.lock` `allowed_files`.

## Acceptance (must prove)

1. **FIX 1:** `ecommerce_listings` 1:1 by `woo_sku`; live CSV Regular prices match Mia PDF 100% on all 107 purchasable SKUs (Kindle Heater=5695, Lamp=5595, Round Daybed=8415, Freelo=599.99, Moon=749.99, etc.). Portal MSRP edits never write steel-only or mutate sibling SKUs.
2. **FIX 2:** Phase 1 parents/simples/variations `Published=1` unless explicitly `is_web_visible=false`; Hub FGC + listings flags set for Phase 1.
3. **FIX 3:** `SELECT COUNT(*) FROM … WHERE sow_phase=2 AND sync_to_woo=true` → **0**.
4. **FIX 4:** Woo PUT omits `description`/`short_description` by default; store units fetched once; parent+variation batch with concurrency 4; `maxDuration=60` on sync route.
5. **FIX 5:** APF `(+$X.XX)` stripped; `display_key`/`display_value` honored; unit tests green.
6. **FIX 6:** `/api/embed/refresh-token` + 45-min silent refresh in embed provider.
7. **FIX 7:** Full `npx vitest run` exit 0; regenerate tmp artifacts; `npm run qa:lifecycle` exit 0; QCA `CERTIFIED`; live HTTP zero Regular-price / Published diffs vs tmp + Mia.

## Target test

```bash
npx vitest run tests/phase1-redteam-closeout.test.ts tests/woo-finish-keys.test.ts tests/woo-line-specs.test.ts tests/woo-sku-resolver.test.ts tests/phase1-bom-restore.test.ts tests/ghl-inventory-and-woo-sync.test.ts tests/phase1-csv-and-smoke.test.ts
```
