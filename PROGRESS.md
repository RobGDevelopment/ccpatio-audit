> HISTORICAL — V8 TRANSACTIONAL BUS. DO NOT IMPLEMENT.
>
> Binding SoT: `docs/MDM_MASTER_BLUEPRINT.md`

# CC Patio MDM Hub — Build Progress

Last updated: 2026-09-13

> **Sole source of truth:** [`docs/MDM_MASTER_BLUEPRINT.md`](docs/MDM_MASTER_BLUEPRINT.md) (§5 / §5A–§5C)  
> **Execution posture:** MDM Phases 0–5 **COMPLETE**. Factory BOM lane (Cut Cards, CAD, PR-C ops/Standard Track) **SHIPPED**. Remaining completeness = blueprint **§5B Tier 1** (Resource SSOT → single Katana writer → `payload_hash`).  
> Pre-MDM V8/order-pipeline notes below are **archive only**. Do not implement Woo/GHL → Katana sales orders.

## MDM phases

| Phase | Status | Notes |
|------|--------|-------|
| 0 Repo governance & exorcism | COMPLETE | Historical banners on all §0.1 docs; order Inngest consumers unregistered; Woo/GHL order webhooks `410`; launchpad marked demo |
| 1 SketchUp gateway & recursive BOM | COMPLETE | `product_intake`, `channel_sync`, SEO cols, RM FK, `bom_explosion` view + `queries/bom.ts`, Zod ingest, `POST /api/webhooks/sketchup` |
| 2 Quarantine UI | COMPLETE | `/admin/quarantine`, Approve/Reject actions, `product.approved` enqueue (no sync HTTP in Server Action) |
| 3 Hardcoded mappers | COMPLETE | `src/mappers/{katana,woocommerce,clover}.ts`; orchestrator deleted; unit tests on Ocean Sofa fixture — **Factory `syncBOMToKatana` still a second writer (§5B Tier 1.2)** |
| 4 Inngest `product.approved` fan-out | COMPLETE | Saga + parallel channel steps; `channel_sync` idempotency; concurrency 1/`globalSku`; `onFailure` Oh-Crap — **`payload_hash` still open (§5B Tier 1.3)** |
| 5 Exit protocol | COMPLETE | `system.health.ping` cron `0 6 * * *`; `/api/health` liveness; `docs/IT_RUNBOOK.md` |

## Factory BOM companion lane

| Item | Status | Notes |
|------|--------|-------|
| Draft → Approve → live `product_bom` | COMPLETE | `/admin/factory-bom`; `product_bom_draft` / `item_operations_draft` |
| Cut Cards + `cut_list` jsonb | COMPLETE | PR-A/B; `notes-codec`; tablet notes on Approve/sync |
| CAD DAE upload → drafts | COMPLETE | `cad_uploads` + Inngest `processCadUpload` |
| Secondary extraction estimates | COMPLETE | `recipe_estimates_draft` + labor helpers |
| Ops Katana grid + Aluminum Standard Track | COMPLETE | PR-C; `src/lib/factory-routing/resources.ts`; Approve ops upsert (`0022`) |
| Resource SSOT across labor/heuristic/CAD | COMPLETE | Tier 1.1 — locked catalog + legacy aliases |
| Cushion Standard Track | COMPLETE | `STANDARD_TRACKS.cushion` + Apply Cushion Routing |
| Single Katana manufacturing writer | PARTIAL | Shared Resource normalize + Factory `channel_sync`; Path A mapper still posts recipes |
| Catalog publish gate rename | COMPLETE | `CATALOG_PUBLISH_MODE` (+ ORDER_PIPELINE_MODE=live fallback) |
| `channel_sync.payload_hash` | COMPLETE | Tier 1.3 — skip when success + hash match |

Binding Factory UX plan: [`docs/FACTORY_BOM_KATANA_UX_PLAN.md`](docs/FACTORY_BOM_KATANA_UX_PLAN.md).

## Phase 0 verification

| Item | Result |
|------|--------|
| §0.2 banner on 9 superseded documents | DONE |
| `processWooCommerceOrder` / `syncGhlOpportunity` not in Inngest `serve()` | DONE |
| Woo + GHL order routes return 410 | DONE |
| Inngest still serves staff digest + variant archive | DONE |

PIM dictionary, raw materials, and multi-level `product_bom` remain live catalog tools. Dictionary Save does not fan out to Katana/Woo/Clover (Approve / Factory Publish are explicit).

### Next optional code

Full collapse of Path A recipe/ops HTTP into `syncBOMToKatana` only. MDM §5B Tier 2 security polish (Katana webhook HMAC/410, hub RLS).

---

## Archive — pre-MDM PIM work (do not treat as architecture)

The following records dictionary/BOM work completed before the MDM pivot. Transactional Woo/GHL → Katana SO/MTO items are **retired**, not complete.

### PIM / dictionary (still in use)

| Item | Status | Notes |
|------|--------|-------|
| Universal columns + Zod attrs | COMPLETE | `item_type`, UOMs, `attributes`, `version` on `sku_mappings` |
| TanStack dynamic columns | COMPLETE | Category tab column factory; attribute JSONB patches + OCC |
| Multi-level BOM schema `0009` | COMPLETE | Adjacency `parent_sku` / `child_sku` |
| Raw materials catalog | COMPLETE | `/admin/raw-materials` |
| Katana material/product/recipe sync helpers | COMPLETE | Master-data only; not Approve fan-out |

### Retired V8 order pipeline (do not re-enable)

| Item | Status |
|------|--------|
| `process-woocommerce-order` → Katana SO + MTO | UNREGISTERED |
| `sync-ghl-opportunity` → Katana SO + MTO | UNREGISTERED |
| Woo/GHL order webhook enqueue | `410 Gone` |
