# BUILD_PLAN — `primeview-handoff-portal-ssot-parity`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 10 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/primeview-handoff-ssot-parity.test.ts`

## Intent

Bring `/partner/primeview-handoff` and `/api/partner/primeview-handoff/download` into **live Certified SSOT parity** with the GHL Executive Control Center (Tabs 2–4): dark-slate/gold partner portal, 32 finishes, 107 Title-Case Aluminum SKUs, staging probe + `CCP-DIAG-WOO-*` diagnostics, and Certified-only exports — while preserving the existing `?token=` URL and a strict read-only partner boundary (no intake drafts, Katana/QBO/GHL pills, or mutation controls).

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `src/app/partner/primeview-handoff/`, `src/app/api/partner/primeview-handoff/`, `src/app/embed/admin/master-catalog/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Live production guardrails

| Guard | Rule |
|-------|------|
| Partner URL | Keep `/partner/primeview-handoff?token=` auth behavior identical |
| Read-only boundary | No intake drafts, stock/cost, QBO/GHL/Inngest pills, edit/save/delete/upload |
| Mia data | Never overwrite `finish_intake` or customized `display_name` |
| Env flags | Do not touch `.env*`; leave `DOWNSTREAM_MUTATIONS=false` / `*_LEDGER_MODE=log` |
| Schema | Additive only; no drops/wipes |
| Tests | Isolated fixtures / `QA-TEST-*` only |

## Workstreams

### 1. Force Zero-Cache Live SSOT Data Parity

**Files (expected):**  
`src/app/partner/primeview-handoff/page.tsx`, `src/app/api/partner/primeview-handoff/download/route.ts`, `src/server/ecommerce/primeview-handoff-ssot.ts`

- Export `dynamic = "force-dynamic"` and `revalidate = 0` on partner page + download route.
- Download responses: `Cache-Control: no-store, must-revalidate`.
- Replace legacy static arrays / unfiltered `listFinishAssets` / bogus heater `-LS/-RS` with Certified SSOT loaders shared with GHL Tabs 2–4 (`filterActiveEcommerceFinishes`, `getPhase1PortalRows` / handoff bundle, roster helpers).

### 2. Rebuild Partner Portal UI (3 Tabs · Dark-Slate/Gold)

**Files (expected):**  
`src/app/partner/primeview-handoff/PartnerHandoffClient.tsx`, `src/app/partner/primeview-handoff/actions.ts`, reuse `FullResImageLightbox.tsx` (no `onReplace`)

1. Header + live `ccpatiodev2.primeview.com` staging banner (Re-Test + Copy `CCP-DIAG-WOO-*`) + clickable KPI strip.
2. Tab 1 — Certified Finishes & Add-Ons (32): family pills, square swatches, APF badges, texture scale, 2048 lightbox (Fit / 1:1 / 3×3 / Prev-Next), Storefront Add-Ons matrix.
3. Tab 2 — Certified Aluminum Products (107): filters, Title-Case titles, accurate Simple vs facing badges, freight/media badges, read-only product drawer.
4. Tab 3 — Woo payloads & Certified downloads (JSON/CSV finishes, products, add-ons/APF). Remove legacy “Full 38 Finishes” / upload mutation UI.

### 3. Verification + QCA

**Files (expected):**  
`tests/primeview-handoff-ssot-parity.test.ts`, `tests/e2e/primeview-handoff-ssot-parity.spec.ts`, `.cursor/phase.lock` blast sync

1. Vitest + Playwright prove force-dynamic, 32/107/102 parity, lightbox modes, no internal leaks, staging banner + diagnostic, Certified-only downloads with `Cache-Control: no-store`.
2. `npx vitest run tests/primeview-handoff-ssot-parity.test.ts` → PASS.
3. `npm run qa:lifecycle` → `exit_code: 0`.
4. Sync `expected_blast_radius` (`tolerance: 0`, excluding `.cursor/aar.json`).
5. `emit.mjs` + `qca.mjs` → **CERTIFIED** (`audit_exit: 0`); paste verbatim QCA JSON.

## Acceptance criteria

- Partner refresh shows Mia’s latest Certified SSOT (zero Next.js cache).
- UI matches GHL dark-slate/gold parity for finishes/products/sync surfaces (read-only).
- Staging probe + diagnostic work live on the call.
- Downloads are Certified 32 / 107 only (no legacy 38).
- Target Vitest + `qa:lifecycle` green; QCA `CERTIFIED`.
