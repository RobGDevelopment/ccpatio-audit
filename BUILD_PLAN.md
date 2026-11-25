# BUILD_PLAN — `ecc-compact-stack-highrez-lightbox-polish`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 18 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts`

## Intent

Upload all 32 high-res `2048×2048` & `512×512` finish assets to Supabase Storage + Hub DB, add a Full-Resolution Lightbox inspector (Fit / 1:1 Zoom / 3×3 Tile / Replace), collapse Stack Health into a compact 7-pill single-row strip with live diagnostic drawers, unblock read-only Katana inventory pulls under `DOWNSTREAM_MUTATIONS=false`, and fix all 18 GHL walkthrough UX/data/sync/image bugs across `/embed/admin/master-catalog` and `/embed/showroom`.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`).

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `scripts/`, `src/app/embed/`, `src/app/api/`, `src/app/partner/primeview-handoff/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Workstreams

### 1. Apply All 32 High-Res Swatches to Supabase & Fix Seeder Persistence

**Files:** `scripts/ops/upload-highrez-finishes.ts`, `scripts/`, `src/lib/`, `src/server/`, `src/app/embed/`, `src/app/partner/primeview-handoff/`

- Inspect staging `manifest.json` + upload script; confirm Dekton / powder-coat SKU↔file mapping (`DKT-NILIUM` / `DKT-AURA` / `DKT-STRATO`, `PWD-BLACK` vs `PWD-WHITE`).
- Ensure upload writes public Storage URLs, SHA-256, `2048×2048` dims, and `source_type` (`studio_photo` + raw filename vs `synthetic_fallback`) to the exact columns Tab 1 / Woo ACF / PrimeView handoff read.
- Idempotent 32-finish seeder must never overwrite valid Supabase URLs with legacy `*_LOW.jpg` 404 paths; add `onError` image fallback chips.
- Execute `npm run finishes:upload -- --apply`; verify 32/32 HTTP 200 + `2048px Ready`; surface FAB/DKT URLs on `/embed/showroom` inventory cards.

### 2. Full-Resolution Click-to-Inspect Lightbox Modal

**Files:** `src/components/`, `src/app/embed/`

- Clicking any swatch thumb, `2048px Ready` / `Needs 2048px` badge, or product/showroom photo opens a dark Full-Res Image & Line-Item Verification Modal.
- Loads true `2048×2048` texture URL; verifies `naturalWidth × naturalHeight`; Fit / 1:1 Loupe / 3×3 Tile modes.
- Sidebar: Canonical SKU, Display Name, Category & APF Group, Source Provenance, Repeat/Scale, SHA-256.
- Actions: Open Full-Res in New Tab · Replace Swatch / 2048px Image.

### 3. Compact Single-Row 7-Pill Stack Strip + Actionable Drawers

**Files:** `src/components/`, `src/app/embed/`, `src/app/api/`, `src/server/`, `src/lib/`

- Collapse 2-column 7-card wall into one horizontal pill bar (`height < 90px` collapsed): Supabase · Katana MRP · QuickBooks · WooCommerce · GHL CRM · FedEx LTL · Inngest.
- Each pill toggles a single Service Diagnostic & Action Drawer underneath.
- **Katana:** Unblock inbound read-only GET inventory pulls when `DOWNSTREAM_MUTATIONS=false` (still block outbound writes); fix ECC + showroom staleness badges (`<30m` Green / `30m–2h` Amber / `>2h` Red).
- **QBO:** Always show Reconnect + Verify Live Token; probe CompanyInfo so expired tokens are Amber/Red.
- **Woo:** Strip HTML/JSON into plain English; Re-Test, Copy Diagnostic, Held Orders.
- **Inngest/DLQ:** List open DLQ rows with Retry + Resolve/Archive.
- **FedEx:** Amber (not Red) when creds present + missing dims; 1-click jump to Tab 2 `Missing Dims`.
- **Supabase / GHL:** Connection telemetry drawers with Re-Probe.

### 4. KPI Tab-Switching, Storefront Add-Ons & Tab 1 Polish

**Files:** `src/app/embed/admin/master-catalog/`, `src/components/`, `src/lib/`, `src/server/`

- KPI chips navigate: Parents/Variations/Simple/Purchasable → Tab 2 + filter; Active Finishes → Tab 1.
- Operator pill + Aluminum-Only banner → dark info popovers.
- Sub-filter counts on all Tab 1 pills; wire `Storefront Add-Ons` to Add-Ons Editor (not finishes table).
- Widen `APF GROUP` with clean badges; fix Pattern Repeat inputs; scrub mistaken `54"` bolt-width from solid Sunbrellas; N/A placeholders for Dekton/Powder; dark upload buttons; Mia storefront powder names (Gray / Beige / Bronze).

### 5. Verification

**Files:** `tests/`, `e2e/`, `.cursor/aar.json`

- Vitest + Playwright: compact stack bar, drawers, inbound Katana sync, 32 URLs, APF labels, zero `54"` bugs, lightbox, KPI→Tab2, Storefront Add-Ons view.
- `npm run qa:lifecycle` → exit 0.
- Sync `expected_blast_radius` (tolerance 0, exclude `.cursor/aar.json`); emit AAR; QCA → `CERTIFIED` (`audit_exit: 0`).

## Guardrails

- Keep all outbound `*_MODE` / `DOWNSTREAM_MUTATIONS` at `log` / `false`.
- Staging media stays outside git (`ccpatio-media-staging`).
- No `drizzle-kit push`, no table drops, additive schema only if needed.
- Never overwrite live Supabase Storage URLs with legacy low-res paths.
