# Architectural Audit: CC Patio PIM & Katana Sync

Per your request, here is the comprehensive architectural audit of the Next.js codebase tracing the data lifecycle for the Supabase PIM and Katana sync pipeline.

## 1. Production Database Wiring & Environment

**Finding:** The portal is securely wired, but relies heavily on Vercel environment variables that must be verified.

- **Supabase Client:** The codebase initializes the Supabase client in two places. The browser client (`src/lib/supabase-browser.ts`) uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` primarily for realtime subscriptions. There is also a server-side `getSupabaseAdmin()` utilizing `SUPABASE_SERVICE_ROLE_KEY`, but this is *strictly* used for uploading product images to the `product-images` storage bucket.
- **Drizzle ORM (Primary DB):** The actual database connection for all data mutations (BOMs, catalogs, ops) does NOT use the Supabase REST API. Instead, it uses Drizzle ORM (`src/server/db/client.ts`) connecting directly via a standard Postgres connection string (`POSTGRES_URL`).
- **Environment Risk:** The checked-in `.env` file does not contain `POSTGRES_URL` or the Supabase keys (it only holds tokens for GHL, QBO, Katana, WC). There is no hardcoded fallback to a staging/local database in the code. You must check the Vercel Production Environment Variables dashboard to guarantee `POSTGRES_URL` is pointing to the live production Supabase instance (typically the pooler URL on port 6543).

## 2. Data Mutation & Write Verification

**Finding:** Writes are correctly persisted to the database. There are no "memory traps" failing to trigger backend writes.

- **Frontend State:** In components like `ProductDetailModal.tsx`, edits are held in a local React state (`drafts`). However, when the user clicks "Save", the `handleSave` function iterates over all changed fields and actively fires off Server Actions (`patchMappingField`, `patchCatalogField`, `patchAttributeField`). 
- **Backend Handlers:** The Server Actions in `src/app/admin/dictionary/actions.ts` correctly execute `UPDATE` and `INSERT` commands to the strict Supabase tables (`finished_goods_catalog`, `product_bom`, `item_operations`) using Drizzle. Many of these (like `saveCatalogDraft`) use database transactions to ensure `sku_mappings` and the catalog tables stay atomically in sync.
- **Result:** You can trust that when the team sees a "Saved" toast on the frontend, the data is genuinely written to the Postgres database.

## 3. Row Level Security (RLS) & Auth

**Finding:** RLS 403 errors are impossible here because the application bypasses RLS entirely.

- **Auth Flow:** The staff logs in using a custom JWT session cookie (`PIM_SESSION_COOKIE`). This session is checked server-side (`resolvePimOperator` in `src/lib/pim-audit.ts`) to attach their email to the `updated_by` columns and log their actions in the `pim_audit_log` table.
- **RLS Bypass:** Because all database writes go through Drizzle using the `POSTGRES_URL` connection string (which acts as the postgres superuser or database owner), the queries execute with elevated privileges. They do not pass the JWT to the database.
- **Result:** Staff user roles do not need specific Postgres `INSERT/UPDATE` RLS policies for these tables. Their writes will not silently fail with 403s in the background.

## 4. The Katana Sync Pipeline (⚠️ Action Required)

**Finding:** The Katana sync pipeline is **disconnected** from the primary "Save" action.

- **Disconnected Pipes:** When a user clicks "Save" in the portal (e.g., in `ProductDetailModal.tsx` or via `saveCatalogDraft`), it ONLY writes to Supabase. It **does not** trigger `syncBOMToKatana` or `syncFinishedGoodToKatana` downstream automatically.
- **Manual Trigger:** The Katana sync functions are exposed as standalone Server Actions (`syncFinishedGoodToKatanaAction`, `syncBOMToKatanaAction`). This means syncing to Katana currently requires the staff to click a distinct, separate "Sync to Katana" button on the UI after saving their changes.
- **Rate Limiting:** When the Katana sync *is* triggered, the pipeline (`src/lib/katana.ts`) is highly robust. It uses a `katanaRequestPacer` and intercepts HTTP 429 responses to read the `X-Ratelimit-Reset` header, effectively honoring the token bucket rate-limiting and preventing API backoff.

### Immediate Recommendations for the Team
1. **Pause Katana Expectations:** Inform the data entry team that clicking "Save" only updates the internal database. If they expect Katana to update immediately, they must trigger the Katana sync manually (if the button exists in the UI).
2. **Verify Vercel Env:** Double-check the Vercel dashboard to ensure `POSTGRES_URL` is definitively pointing to production.
3. **Future Fix:** We should likely wire `syncFinishedGoodToKatanaAction` into the `handleSave` promise chain in `ProductDetailModal.tsx` or inside the `actions.ts` transaction if automatic Katana syncing is desired on every save.
