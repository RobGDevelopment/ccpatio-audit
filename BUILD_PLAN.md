# BUILD_PLAN — `ghl-ecommerce-32-finish-portal`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 14

## Intent

Unify the GHL `E-Commerce` tab into a Handoff & Certification portal scoped to the exact
32 e-commerce finishes (19932.jpg), with locked auto-generated SKUs, `+`/`−` finish rows
for Mia / Kian / Superadmin, Aluminum-only frame exports, and Vitest coverage. Do not flip
any `*_MODE` / `DOWNSTREAM_MUTATIONS` flags. High-res media staging lives outside the repo
(`C:\Workspace\ccpatio-media-staging\`); `docs/HighRezImages/` must not remain in-tree.

## Workstreams

1. **Exact 32-finish roster** — `src/server/ecommerce/ecommerce-32-finish-roster.ts`
   (Sunbrella 16 + Ultraleather 4 + Dekton 6 `DKT-*` + Powder 6). Filter showroom extras
   from e-commerce views / Woo manifests. Aluminum-only frame export strips steel / +10%.
2. **Portal + roles** — Certification strip on master-catalog E-Commerce tab; access for
   Mia, Kian, Superadmin (and GHL embed); Superadmin link to Mission Control.
3. **Locked SKUs + `+`/`−`** — Auto-mint FAB-/PWD-/DKT- on add; SKU read-only; soft-disable
   via `uploaded_by=ecommerce:disabled`; aliases recorded on roster definitions.
4. **Vitest** — `tests/ghl-ecommerce-32-finish-portal.test.ts`.

## Allowed files

1. `.cursor/phase.lock`
2. `.cursor/session-stamp.json`
3. `.cursor/aar.json`
4. `BUILD_PLAN.md`
5. `src/app/embed/admin/master-catalog/actions.ts`
6. `src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx`
7. `src/app/embed/admin/master-catalog/ecommerce/SwatchesFinishesDrawer.tsx`
8. `src/app/embed/admin/master-catalog/page.tsx`
9. `src/app/partner/primeview-handoff/PartnerHandoffClient.tsx`
10. `src/lib/ecommerce-roster.ts`
11. `src/server/assets/finish-assets.ts`
12. `src/server/ecommerce/auto-sku-engine.ts`
13. `src/server/ecommerce/ecommerce-32-finish-roster.ts`
14. `src/server/ecommerce/phase1-portal.ts`
15. `tests/ghl-ecommerce-32-finish-portal.test.ts`

## Target test

```bash
npx vitest run tests/ghl-ecommerce-32-finish-portal.test.ts
```
