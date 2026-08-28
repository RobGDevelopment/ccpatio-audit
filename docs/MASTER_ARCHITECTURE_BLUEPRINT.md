# CC Patio — Master Architecture Blueprint

**Document ID:** `MASTER_ARCHITECTURE_BLUEPRINT`  
**Path:** `docs/MASTER_ARCHITECTURE_BLUEPRINT.md`  
**Status:** ACTIVE — Absolute single source of truth for the current build  
**Effective:** 2026-08-27  
**Owner:** Lead Systems Architect  
**Execution posture:** **ACTIVE** — Priority 3 authorized 2026-08-27 (UI + backend)  

---

## 0. How to use this document

### 0.1 Authority

This file is the **binding source of truth** for Cursor / agent work on the ERP middleware build from this date forward.

When older blueprints disagree with this file, **this file wins** for:

- Operational roles of GHL vs Katana vs Woo/VividWorks  
- Crawl trigger model (`status=won` + `line_items`)  
- What is already built in `/middleware`  
- What is Future / Paused vs Active Roadmap  

Older documents remain **historical reference** (do not delete):

| Legacy doc | Role after this consolidation |
|---|---|
| `docs/blueprints/CCPatio_Master_Architecture_Blueprint.md` | V8 enterprise freeze / Gate 1 Hybrid OR history |
| `docs/blueprints/Master_Architecture_Blueprint.md` | As-Is discovery snapshot |
| `docs/blueprints/MASTER_E2E_ROADMAP.md` | Earlier Katana→GHL→Woo→QBO sequence (superseded for Crawl) |
| `docs/blueprints/PRIORITY_2_IMPLEMENTATION_PLAN.md` | Detailed P2 sandbox / Oh-Crap appendix |
| `PROGRESS.md` | Session task checklist (keep updated; does not override this file) |
| Canvases under `.cursor/projects/.../canvases/` | Visual summaries only |

### 0.2 Tech stack (locked)

| Layer | Choice |
|---|---|
| App | Next.js App Router (`middleware/`) |
| Language | TypeScript strict |
| DB | Supabase PostgreSQL (`POSTGRES_URL`) |
| ORM | Drizzle (no Prisma) |
| Queues | Inngest |
| Hosting target | Vercel (middleware) |
| Manufacturing API | Katana MRP `https://api.katanamrp.com/v1` |
| CRM | GoHighLevel (LeadConnector) |

### 0.3 Conflict resolution note (Gate 1 vs Won)

Legacy V8 docs bind Katana MO creation to **Gate 1 stage enter** (AZ `07.S` / CA `07`) via Hybrid OR (QBO deposit move **or** manual drag).

**Crawl-phase executive decision (2026-08-27, Priority 1 approved):**

> Trigger = GHL opportunity `status` matches Won **and** `line_items` are present.  
> Stage UUID filtering may be added later; do not block Crawl on Gate 1 UUID filters.

Make-to-Order remains: **Sales Order first**, then Katana `POST /manufacturing_order_make_to_order` per `sales_order_row_id` (not “MO-only from GHL”).

---

## 1. Core Operational Rules (The Mandate)

### 1.1 Source of Truth — GoHighLevel

- GHL is the **absolute beginning and end** of the customer journey for showroom staff and executives.  
- Leads, quotes, Won opportunities, and change orders originate in GHL.  
- Staff operate in **GHL + QuickBooks Online (QBO)** only for CRM/finance UX.  
- Middleware must make GHL → factory automation **invisible** to non-technical users.

**Live GHL anchors (scraped):**

| Asset | ID |
|---|---|
| Location | `5N8TZzI6eW96vKo0ffED` |
| AZ Sales pipeline | `hu9VUgAxItleNsiZRIYn` |
| CA Sales pipeline | `PaPMUtPGBD9ZQMNNNDt3` |
| Manufacturing pipeline | `ZMhyCOpo9M8KxRhaoteN` |
| AZ Gate 1 stage (deferred for Crawl filter) | `a43ddce2-44e8-4f0a-b506-d927d50aee4a` |
| CA Gate 1 stage (deferred for Crawl filter) | `2975b751-a11d-480e-a2db-56f5ac36d976` |

### 1.2 Manufacturing Engine — Katana MRP

- Katana is **strictly manufacturing** (Shop Floor App / digital BOM + MOs).  
- Production staff must **never** need GHL.  
- Target factory path:

```
GHL Won (+ line_items)
  → Middleware validate dictionary
  → Katana Sales Order (POST /sales_orders)
  → Make-to-Order MO (POST /manufacturing_order_make_to_order) per SO row
  → Floor schedule via production_deadline_date / rerank (managers in Katana)
  → Katana webhooks (done / delivered) → Middleware → GHL “Shipped” writeback
```

### 1.3 Future Scope — WooCommerce & VividWorks

- **VividWorks 3D CPQ** and **WooCommerce** are **FUTURE phases**.  
- Do **not** actively engineer Woo/VividWorks consumers for Crawl/Walk.  
- Keep Inngest + webhook architecture **modular** so Woo can plug in later (`woo.order.validated` already exists as a dormant-capable path).  
- LocalWP / live WordPress hardening = Future / Paused (§3).

### 1.4 User Persona & failure mode

- Internal staff: **zero technical literacy**.  
- Integrations must be automated, or fail into Admin via **Oh-Crap protocol** (email + deep link to resolution UI).  
- Never invent SKUs or silently invent Katana IDs.

### 1.5 Franchise routing (preserved)

- AZ vs CA franchise must not silently default.  
- Contact field `contact.store_location` (`AZ` | `CA` | `Other`) remains the known routing signal.  
- Full dual-QBO entity separation still **unproven** — QBO writeback is later (§3 / Priority 4 Run+).

---

## 2. Completed Architecture (What Is Built & Tested)

Primary codebase: **`middleware/`** (Next.js). Topology / executive-presentation are visualization or demo — **not** production ERP ingress.

### 2.1 Data layer (Drizzle + Supabase Postgres)

| Table | Purpose |
|---|---|
| `sku_mappings` | Global E2E SKU hub + Katana/Woo/GHL display columns |
| `finished_goods_catalog` | PIM dims, MSRP, image, **`na_fields`** (N/A overrides) |
| `sku_aliases` | Deprecated SKU → canonical |
| `product_bom` | Finished good → component lines |
| `raw_materials_catalog` | Materials for BOM picker + Katana material sync |
| `incoming_webhooks` | Idempotent queue log (`woocommerce` \| `ghl`) |
| `quarantined_orders` | Zod-fail dead letter (Woo path) |
| `katana_mo_records` | MO external_ref idempotency index (service exists; Inngest MTO not wired) |

Migrations of note: `0002`–`0006` (aliases, BOM, raw materials, webhooks, `na_fields`). Remote sync often via `db:push` when `db:migrate` collides.

### 2.2 PIM / dictionary (Phases 1–2 product work)

- Admin: `/admin/dictionary` — SKU table, catalog edit, data health badges  
- Admin: `/admin/raw-materials` — CRUD  
- `BomEditor` + `RawMaterialCombobox` — searchable BOM lines from catalog  
- **Priority 2 UI (COMPLETE):** interactive **Missing Data / Complete** badge; mark fields **Not Applicable** (`arm_height`, `sit_height`, etc.) via `setCatalogFieldNotApplicable`  
- SKU engine: modular `[MODIFIER]-[NOUN]` finished-good codes; dictionary set size **911** (tests updated)

### 2.3 Katana outbound client (Phase 4–5)

File: `middleware/src/lib/katana.ts`

| Capability | Status |
|---|---|
| Auth Bearer (`KATANA_PERSONAL_ACCESS_TOKEN` / `KATANA_API_KEY`) | Built |
| 429 backoff + 422 logging | Built |
| Sync material / product / recipes | Built + admin Sync buttons |
| `createKatanaSalesOrder` → `POST /sales_orders` | Built |
| Resolve SKU → `variant_id` via `sku_mappings` / live lookup | Built |
| Customer find/create by email | Built |
| Make-to-Order `POST /manufacturing_order_make_to_order` | **Built** — `createMakeToOrderManufacturingOrders()`; gated by `ORDER_PIPELINE_MODE=live` |
| Katana inbound webhooks | **Not built** (Priority 4 Run) |

**Pipeline gate:** `ORDER_PIPELINE_MODE=log|approve|live` (default **log**). Only `live` POSTs Katana SO + MTO. Catalog sync still uses existing Sync buttons / token.

### 2.4 Inngest hub (Phase 3 + 5 base)

| Piece | Status |
|---|---|
| `src/inngest/client.ts` | Built |
| `src/inngest/functions.ts` | Built — Oh-Crap `onFailure` + mode gate + MTO |
| `GET/POST/PUT /api/inngest` | Built |
| Event `ghl/opportunity.sync` → `sync-ghl-opportunity` | Consumer + HMAC emitter |
| Event `woo.order.validated` → `process-woocommerce-order` | Built (future Woo; modular) |
| Idempotency via `incoming_webhooks` | Built |
| `POST /api/webhooks/ghl` HMAC | **Built** (`x-ghl-signature`) |

### 2.5 Priority 1 Intel (APPROVED)

- Mapped Won + line_items → Katana SO payload shape.  
- Identified missing Opportunity fields (must create in GHL before writeback).  
- Confirmed Katana MTO endpoint + reverse webhook event names.  
- Documented Contact vs Opportunity 1:1 tech debt.

### 2.6 Priority 2–3 (COMPLETE)

| Deliverable | Status |
|---|---|
| PIM N/A dimension overrides | **COMPLETE** |
| Enterprise dictionary UI (inline autosave, carbon/glass, audit) | **COMPLETE** |
| Realtime / poll multi-browser sync | **COMPLETE** (anon key → Realtime; else 4s poll) |
| Oh-Crap Resend alert module | **WIRED** — Inngest `onFailure` + catch paths |
| HMAC GHL ingress | **COMPLETE** |
| `ORDER_PIPELINE_MODE` + MTO | **COMPLETE** (Crawl = `log`) |
| GHL Opportunity field checklist | Documented in §4.2 |

### 2.7 Verification snapshot

- `npm run typecheck` — PASS (Priority 3)  
- `npm run test` — PASS (6/6)  
- Local `/admin/dictionary` — smoke verified (911 SKUs, Finished Good grid + inline MSRP)  
- `npm run lint` — known React hooks warnings remain non-blocking

---

## 3. The Backlog (Preserved Directives — Future / Paused)

Label: **Future / Paused**. Do not execute during Priority 3 Crawl unless Architect reopens.

### 3.1 WordPress / WooCommerce platform

- Legacy WordPress site instability from **heavy plugins + synchronous webhooks** — reason Inngest decoupling exists.  
- WooCommerce activation (HMAC `/api/webhooks/woocommerce` already scaffolded) — **future**; Global E2E SKUs on variations still a known WOO-H1 gap historically.  
- **LocalWP sandbox cloning** for Woo webhook soak — optional later; not Crawl.  
- Capture live `order.created` into `WooCommerce_Data_Schema.md` (still largely empty).

### 3.2 Edge / CDN (preserved ops note)

- **Cloudflare caching / WAF recommendations** for public web and (later) Woo — paused; middleware ERP path is Vercel + Inngest, not CF-dependent for Crawl.  
- Do not conflate public-site caching work with GHL→Katana factory automation.

### 3.3 VividWorks 3D CPQ

- Commercial Path A (configure → cart) — **future**. No active engineering.

### 3.4 Gate 1 Hybrid OR (legacy V8)

- Path A: QBO deposit → programmatic move to `07.S` / CA `07`.  
- Path B: Manual Clover / override drag to Gate 1.  
- **Deferred** behind Crawl `won` + `line_items`. Revisit when mapping stage UUIDs.

### 3.5 QBO

- Dual-company vs Classes/Locations still unproven.  
- Invoice / deposit webhooks — **after** factory Crawl/Walk trust.  
- Field `opportunity.qbo_invoice_id` — create in GHL when QBO sprint opens.

### 3.6 Topology / cinematic dashboard

- `/topology` is visualization (107-node census, Present/Engineer modes). Frozen for ERP coding; not ingress.

### 3.7 Open data quality punchlist (from PIM/SKU work)

- ~17 finished-good SKU migration collisions (height variants need distinct modifiers).  
- Image import: missing local JPGs / unmapped SKUs.  
- Seed description quality issues on some FIN-* rows.  
- Opportunity manufacturing fields still **MISSING** in live GHL (see §4.2).

### 3.8 Unwired / mock stacks (do not treat as production)

- `middleware/src/server/katana/katana.service.ts` — Create MO dry-run; not on Inngest path.  
- `topology/.../api/webhooks/ghl` — no HMAC; mock MO.  
- `executive-presentation` GHL/Katana mocks.

---

## 4. The Active Roadmap (Where We Go Next)

### 4.1 Halt condition

Priority 3 **authorized and implemented** (2026-08-27). Do not advance Priority 4 Walk (`ORDER_PIPELINE_MODE=approve|live` + Approve Sync UI) until explicit authorization.

### 4.2 Prerequisites before / during Crawl

**Create in GHL on Opportunity (not Contact):**

| Field | Suggested key | Purpose |
|---|---|---|
| Katana MO ID | `opportunity.katana_mo_id` | Writeback |
| Katana SO ID | `opportunity.katana_so_id` | Correlation |
| Katana Order No | `opportunity.katana_order_no` | Human `GHL-{id}` |
| Frame / Finish / Fabric | `opportunity.frame` / `finish` / `fabric` | BOM config |
| ERP Sync Status | `opportunity.erp_sync_status` | `pending\|logged\|approved\|synced\|failed` |
| ERP Sync Error | `opportunity.erp_sync_error` | Last Oh-Crap message |
| Production Deadline | `opportunity.production_deadline` | Optional → Katana deadline |

Confirm Manufacturing pipeline has a **Shipped / Delivered** stage for reverse updates.

### 4.3 Priority 3 — Sandbox Execution (COMPLETE)

1. **HMAC GHL ingress** — `POST /api/webhooks/ghl` using `GHL_WEBHOOK_SECRET`; emit `ghl/opportunity.sync`. ✅  
2. **Oh-Crap wiring** — `sendOhCrapAlert` from Inngest `onFailure` / validation / Katana catch; deep link `/admin/dictionary?sku=…`. ✅  
3. **Pipeline mode gate** — `ORDER_PIPELINE_MODE=log|approve|live` (Crawl = `log`). ✅  
4. **MTO generation** — after SO create, `POST /manufacturing_order_make_to_order` per row (bypassed unless `live`). ✅  
5. **Enterprise PIM UI** — inline autosave grid, audit trail, Realtime/poll. ✅  
6. **Local live-fire** — run Inngest CLI against `/api/inngest` (instructions in session summary).  
7. Optional stub: `POST /api/webhooks/katana` — still Priority 4.

### 4.4 Priority 4 — Phased Rollout

| Phase | Behavior |
|---|---|
| **Crawl** | Deploy middleware to Vercel. GHL webhooks on. Katana order mutations **log-only**. Passively verify mapping to BOMs/dictionary. Oh-Crap on failures. |
| **Walk** | Enable live SO (+ MTO) for **allowlisted** SKUs. Ops **Approve Sync** UI. Reverse GHL stage updates may log-only or limited. |
| **Run** | Remove manual approval. Full auto: GHL Won → Katana SO → MTO → Shop Floor; Katana done/delivered → GHL Shipped writeback. |

### 4.5 Target event flow (Run state)

```
GHL (Won + line_items)
  → HMAC /api/webhooks/ghl
  → Inngest ghl/opportunity.sync
  → Dictionary / Zod validate (fail → Oh-Crap + quarantine/log)
  → createKatanaSalesOrder
  → manufacturing_order_make_to_order (each row)
  → persist so_id / mo_id on Opportunity fields
  → Katana webhook done|delivered
  → Inngest sync-ghl-shipped
  → GHL Manufacturing stage + note
```

Woo remains a **parallel future ingress** on the same Inngest hub, not part of Crawl.

### 4.6 Local sandbox commands (reference)

```bash
cd middleware
npm run dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
# Inngest UI http://localhost:8288 → send ghl/opportunity.sync
```

Env keys of record: `POSTGRES_URL`, `KATANA_*`, `GHL_WEBHOOK_SECRET`, `INNGEST_EVENT_KEY`, `DOWNSTREAM_MUTATIONS`, `OH_CRAP_ADMIN_EMAIL`, `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, (P3) `ORDER_PIPELINE_MODE`.

---

## 5. Key file index (current middleware)

| Area | Path |
|---|---|
| Schema | `middleware/src/server/db/schema.ts` |
| Katana client | `middleware/src/lib/katana.ts` |
| Inngest functions | `middleware/src/inngest/functions.ts` |
| Inngest serve | `middleware/src/app/api/inngest/route.ts` |
| Dictionary UI | `middleware/src/app/admin/dictionary/SkuTable.tsx` |
| Oh-Crap (draft) | `middleware/src/server/alerts/oh-crap.ts` |
| Session progress | `PROGRESS.md` |
| This SoT | `docs/MASTER_ARCHITECTURE_BLUEPRINT.md` |

---

## 6. Agent conduct under System Halt

1. **Do not** implement Priority 3 code until explicitly authorized.  
2. Prefer updating this blueprint + `PROGRESS.md` over inventing parallel “v9” docs.  
3. Fail closed on unknown SKUs; never invent Katana variant/material IDs.  
4. Treat Woo/VividWorks/LocalWP/Cloudflare/QBO as Future / Paused unless the Architect reopens them.  
5. Staff-facing surfaces stay GHL + QBO + Katana Shop Floor; middleware Admin is for ops/PIM only.

---

**End of Master Architecture Blueprint**  
*Awaiting explicit authorization before Priority 3 Sandbox Execution.*
