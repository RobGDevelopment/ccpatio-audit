# CC Patio ERP/PIM — Autonomous Build Progress

Last updated: 2026-08-27

> **Source of truth:** [`docs/MASTER_ARCHITECTURE_BLUEPRINT.md`](docs/MASTER_ARCHITECTURE_BLUEPRINT.md)  
> **Execution posture:** Phase 1–2 PIM (schema + dynamic TanStack dictionary) COMPLETE. Phase 3 Multi-Level BOM **blocked** pending authorization.

## Priority 1–3 + PIM Evolution

| Item | Status | Notes |
|------|--------|-------|
| P3 Sandbox / HMAC / Oh-Crap / pipeline | COMPLETE | Crawl = `ORDER_PIPELINE_MODE=log` |
| Drizzle journal hygiene | COMPLETE | noop `0005_grey_ben_urich`; registered `0006`–`0008` |
| Phase 1 universal columns + Zod attrs | COMPLETE | `item_type`, UOMs, `attributes`, `version` on `sku_mappings` |
| Phase 2 TanStack dynamic columns | COMPLETE | Category tab column factory; attribute JSONB patches + OCC |
| Phase 3 Multi-Level BOM | BLOCKED | Awaiting explicit authorization |

## Phase 2–5 (middleware build — complete)

### Phase 2: Raw Materials Catalog & BOM Linkage

| Task | Status | Notes |
|------|--------|-------|
| 2.1 Database — `raw_materials_catalog` | COMPLETE | Migration `0004_raw_materials_catalog.sql` |
| 2.2 PIM UI — `/admin/raw-materials` CRUD | COMPLETE | `actions.ts`, `RawMaterialsTable.tsx`, `page.tsx` |
| 2.3 BOM Editor — searchable material combobox | COMPLETE | `RawMaterialCombobox.tsx`, catalog validation on upsert |

## Phase 3: Inngest Integration Hub

| Task | Status | Notes |
|------|--------|-------|
| 3.1 Inngest client + functions scaffold | COMPLETE | `src/inngest/client.ts`, `src/inngest/functions.ts` |
| 3.2 WooCommerce & GHL queues + API route | COMPLETE | `incoming_webhooks` table, `/api/inngest`, functions wired |

## Phase 4: Katana MRP API Bridge & Sync Engine

| Task | Status | Notes |
|------|--------|-------|
| 4.1 Katana API client (`src/lib/katana.ts`) | COMPLETE | Bearer auth, 429 retry, 422 logging |
| 4.2 Sync functions — material, product, BOM | COMPLETE | `/materials`, `/products`, `/recipes` |
| 4.3 Server Actions + UI sync buttons | COMPLETE | `KatanaSyncButton`, dictionary + raw-materials |

## Phase 5: Order Pipeline & Katana Sales Orders

| Task | Status | Notes |
|------|--------|-------|
| 5.1 `createKatanaSalesOrder()` | COMPLETE | POST `/sales_orders`, SKU→variant_id, customer upsert |
| 5.2 WooCommerce Inngest queue wiring | COMPLETE | `process-woocommerce-order` pushes SO, updates webhook status |
| 5.3 GHL Won opportunity → Katana SO | COMPLETE | `sync-ghl-opportunity` when Won + `line_items` present |

## Verification Log

| Step | Result |
|------|--------|
| 2.1 migration + typecheck | PASS |
| 2.2 typecheck | PASS |
| 2.3 typecheck | PASS |
| 3.x migration `0005_incoming_webhooks.sql` | PASS |
| 3.x typecheck | PASS |
| 3.x `npm run build` | PASS |
| 4.x typecheck | PASS |
| 4.x `npm run build` | PASS |
| 5.x typecheck | PASS |

## New Routes

- `/admin/raw-materials` — Raw materials CRUD
- `/api/inngest` — Inngest serve endpoint

## Katana Sync (Phase 4)

| Function | Endpoint | UI trigger |
|----------|----------|------------|
| `syncRawMaterialToKatana` | POST/PATCH `/materials` | Raw Materials expanded row |
| `syncFinishedGoodToKatana` | POST/PATCH `/products` | SKU Dictionary expanded row |
| `syncBOMToKatana` | POST `/recipes` | BOM editor header |
| `createKatanaSalesOrder` | POST `/sales_orders` | Inngest Woo/GHL queues |

**Env:** `KATANA_PERSONAL_ACCESS_TOKEN` (preferred) or `KATANA_API_KEY`

## Migrations to Apply (if not already run)

```bash
cd middleware
npm run db:migrate
```

Applied in this session: `0004_raw_materials_catalog`, `0005_incoming_webhooks`

## Inngest Events

| Event | Function | Purpose |
|-------|----------|---------|
| `woo.order.validated` | `process-woocommerce-order` | Log + create Katana sales order |
| `ghl/opportunity.sync` | `sync-ghl-opportunity` | Won opportunities with line items → Katana SO |

## Files Added/Modified (Phase 4–5)

- `middleware/src/lib/katana.ts` — HTTP client, sync engine, sales order pipeline
- `middleware/src/inngest/functions.ts` — Katana SO creation on Woo/GHL events
- `middleware/src/components/KatanaSyncButton.tsx` — spinner + toast UI
- `middleware/src/app/admin/dictionary/actions.ts` — finished good + BOM sync actions
- `middleware/src/app/admin/raw-materials/actions.ts` — raw material sync action
- `middleware/src/app/admin/dictionary/SkuTable.tsx` — Sync to Katana button
- `middleware/src/components/BomEditor.tsx` — Sync BOM button
- `middleware/src/app/admin/raw-materials/RawMaterialsTable.tsx` — Sync button
