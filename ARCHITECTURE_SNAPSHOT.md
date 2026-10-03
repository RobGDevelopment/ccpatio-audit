# ARCHITECTURE_SNAPSHOT

## 1. Vercel & Infrastructure Linkage

**Vercel Configuration:**
- **Project Name:** `ccpatio-audit`
- **Project ID:** `prj_O6Az2ETZzyFuGhgkOwxK5IsY0M5o`
- **Org ID:** `team_dXYdwjNwr0iUcymanpn6SNJu`
- **Region:** `sfo1`
- **Framework Preset:** `nextjs`
- **Build/Install Commands:** standard `npm install` and `npm run build`

**Git Repository Topology:**
- **Origin URL:** `https://github.com/RobGDevelopment/ccpatio-audit.git`

**Detected Environment Configuration (Keys Only):**
- Database/ORM: `POSTGRES_URL`, `DATABASE_URL`
- Supabase (Implied via dependencies): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Integrations (Webhook/API Secrets):
  - `KATANA_API_KEY`
  - `KATANA_WEBHOOK_SECRET`
  - `GHL_API_KEY`
  - `GHL_WEBHOOK_SECRET`
  - `WOOCOMMERCE_KEY`
  - `WOOCOMMERCE_SECRET`
- Background / Queue (Inngest):
  - `INNGEST_EVENT_KEY`
  - `INNGEST_SIGNING_KEY`

---

## 2. Core Framework & Runtime Dependencies

**Framework & Runtime:**
- **Next.js:** Version `16.3.2` using the **App Router** (as evidenced by routes resolving to `src/app/` in build logs, e.g., `/admin/*`, `/api/*`, `/embed/*`).
- **React/ReactDOM:** Version `19.2.8`

**TypeScript & Module Configuration:**
- Strict mode is enabled (`strict: true`).
- Path aliasing is mapped via `"@/*": ["./src/*"]`.

**Database & ORM:**
- **Driver:** `postgres` (`3.4.9`)
- **ORM:** `drizzle-orm` (`0.45.2`) and `drizzle-kit` (`0.31.10`) for schema migration/generation.

**Queueing & Background Processing:**
- **Inngest:** Native integration via `inngest` (`4.18.1`) for persistent workflows and asynchronous execution logic.
- Background endpoints sit natively under `src/app/api/inngest/route.ts`.

**Other Notable Tooling:**
- Zod (`4.4.3`) for strict payload schema validation.
- TailwindCSS (`4.3.3`) for styling using PostCSS.
- Excel manipulation libraries (`exceljs`, `xlsx`) for catalog parsing.

---

## 3. Database Schema & Data Models

The system architecture utilizes a strict **Global SKU Master Architecture**.

**Core Schema Paradigms (Drizzle):**
- **`sku_mappings` (SSOT Core):**
  - Primary Key: `global_sku` (`varchar` or `text`) acts as the SSOT UUID.
  - Katana Bindings: Handled via `katana_variant_id` and `katana_material_id` (both strictly `integer` fields because Katana emits numeric internal IDs).
  - WooCommerce Bindings: Handled via `woo_product_id` (`varchar` to accommodate UUID payloads).
- **`finished_goods_catalog` & `raw_materials_catalog`:** Tables enforcing separation of concerns between raw materials (e.g., fabric, aluminum) and finished goods. Items resolve their hierarchy through `sku_mappings`.
- **`quarantine_catalog`:** A staging queue designed to ingest loosely structured or unstructured data via uploads/webhooks until matched against a `global_sku`.
- **`product_bom` & `product_bom_draft`:** Highly structured relational BOMs using `parent_sku` to `child_sku` graphs to form Katana-ready manufacturing recipes.
- **`product_intake` & `order_intake`:** Gateway tables capturing webhook payloads (e.g. from GHL or SketchUp) using Zod validation before generating holds or sales orders.

---

## 4. Existing Integrations & Webhook Ingestion Routes

**Active Webhooks & Routing:**
All webhooks route through Next.js App Router API handlers.
- **GHL (`/api/webhooks/ghl`):** Processes `Produce Factory Order` stages, voiding open quotes, parsing opportunity pipelines, and inserting into `order_intake` tracking table.
- **Katana (`/api/webhooks/katana`):** Listens to `variant.updated` and heavily heals discrepancies via `healKatanaVariantSku`. Sales orders are acknowledged.
- **WooCommerce (`/api/webhooks/woocommerce`):** E-commerce catalog/order routing.
- **SketchUp (`/api/webhooks/sketchup`):** 3D model processing into `product_intake`.

**Payload Verification Mechanism:**
- Verification wrappers live in `/src/server/{integration}/ingress.ts` or directly on the webhook.
- E.g., `verifyKatanaWebhookSignature(rawBody, signature, secret)` utilizes HMAC-SHA256 evaluation matching `x-sha2-signature` headers.

**Background Execution Pattern:**
- Some immediate routing is executed synchronously directly in the HTTP request cycle for speed (e.g., healing a simple Katana variant and updating DB state).
- More extensive state mutations—such as dragging and dropping a Factory BOM—fire off background Inngest events which process heavily computational tasks (BOM explosion, CAD parsing) asynchronously. 

---

## 5. Architectural Injection Points for Clover & QBO

To cleanly introduce Clover (POS) and Intuit Quickbooks Online (QBO) within the existing architecture:

**1. Webhook Listeners (Inbound Synchronization):**
- `src/app/api/webhooks/clover/route.ts`
- `src/app/api/webhooks/qbo/route.ts`

**2. OAuth Callbacks (Token Hydration):**
- `src/app/api/auth/clover/callback/route.ts`
- `src/app/api/auth/qbo/callback/route.ts`

**3. Client SDKs / Domain Services:**
- Create `src/server/integrations/clover/` for REST wrappers (e.g. `clover-client.ts`, `clover-catalog-sync.ts`).
- Create `src/server/integrations/qbo/` to manage token lifecycles and invoice synchronization.

**4. State Persistence (Database Migrations):**
- Add mapping columns to `sku_mappings` (e.g., `clover_item_id: varchar`, `qbo_item_id: varchar`) in `src/server/db/schema.ts`.
- Run `npm run db:generate` to output new migrations into `src/server/db/migrations/`.

**5. Background Workers (Translation & Queues):**
- Map long-running workflows (like deep bi-directional syncing) inside `src/inngest/functions.ts`.
- E.g., `export const syncCloverOrders = inngest.createFunction({ id: "clover-order-sync" }, { event: "clover/order.created" }, async ({ event }) => {...})`
