# BUILD_PLAN — ecommerce-two-tab-and-sku-engine

**Phase ID:** `ecommerce-two-tab-and-sku-engine`  
**Base ref:** `c3627b3`  
**Target test:** `npx vitest run tests/phase2-hydration-and-sku-engine.test.ts`  
**Expected blast radius:** 15

## Intent
Zero-data-loss Phase 2 catalog hydration + clean 2-tab E-Commerce portal + Auto-SKU wizard + provisional Katana shell order path.

## Allowed files
See `.cursor/phase.lock` `allowed_files`.

## Acceptance
1. `hydrate-phase2-catalog.ts --apply` proves non-null column counts never regress.
2. Live tab defaults to `sync_to_woo` storefront rows (no Active Catalog All / $0 QBO noise).
3. Phase 2 tab surfaces SOW backlog + hub library with 5-badge readiness.
4. `provisional_shell` resolves without quarantine; full BOM unchanged.
5. QCA `verdict: CERTIFIED`, `audit_exit: 0`, `blastRadius.status: PASS`.
