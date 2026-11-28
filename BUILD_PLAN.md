# BUILD_PLAN — `woo-shipping-bridge-and-taxjar`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 16 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/woo-shipping-bridge-and-taxjar.test.ts`

## Intent

Ship Hub-native FedEx LTL / palletized checkout quotes (`POST /api/shipping/quote`), a self-contained WordPress `WC_Shipping_Method` bridge ZIP for PrimeView, TaxJar penny-exact tax/shipping pass-through into the Woo → Hub → QBO ledger path (no QBO recalculation, no TaxJar↔QBO direct link), and partner/GHL Tab-4 consoles that download the plugin + simulate live checkout quotes — while preserving Certified 32-finish / 107-SKU SSOT parity and all production mutation locks.

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `src/app/api/`, `src/app/partner/primeview-handoff/`, `src/app/embed/admin/master-catalog/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Live production guardrails

| Guard | Rule |
|-------|------|
| Mia data | Never reset/wipe/overwrite `finish_intake` photoshoot rows or customized `display_name` |
| Outbound locks | Leave `DOWNSTREAM_MUTATIONS=false` and all `*_LEDGER_MODE=log` untouched |
| Packages | Zero external installs; ZIP via Node `zlib` + CRC32 PKZIP only |
| Schema | Additive / non-destructive only; isolated fixtures / `QA-TEST-*` cleanup |
| Env | Do not modify `package.json` or `.env*` |
| TaxJar | Woo checkout taxes only; Hub passes exact TaxJar amounts to QBO — never recalculate |

## Workstreams

### 1. `POST /api/shipping/quote` — LTL palletizer, FedEx live/fallback, showroom pickup

**Files (expected):**  
`src/app/api/shipping/quote/route.ts`, `src/server/shipping/woo-checkout-quote.ts`

- Auth: `X-CCPatio-Shipping-Secret` (constant-time vs `WOO_SHIPPING_QUOTE_SECRET` \|\| `WOOCOMMERCE_WEBHOOK_SECRET`) **or** GHL embed / PrimeView partner token → else `401`.
- Resolve cart SKUs (FIN-*, -LS/-RS, RTL-*, `sku_aliases`) against Hub dims; category fallback dims when missing (`usedFallbackDims: true`).
- Consolidate into `90" × 40" × 45"` pallets (+ 45 lb tare); parcel/lightweight accessories consolidate without spawning full pallets.
- FedEx LTL from Phoenix `85043` (configurable) with Residential + Liftgate, `AbortSignal.timeout(4500)`; deterministic zone/pallet fallback when unconfigured/error/timeout.
- Rates: taxable FedEx LTL curbside + `$0` Scottsdale & Solana Beach showroom pickup.

### 2. WordPress bridge plugin ZIP generator

**Files (expected):**  
`src/server/shipping/woo-shipping-plugin-zip.ts`, `src/app/api/partner/primeview-handoff/shipping-plugin/route.ts`

- Pure Node `deflateRawSync` + CRC32 PKZIP → `ccpatio-hub-shipping.zip` (`Cache-Control: no-store`).
- PHP 7.4–8.3 safe `WC_CCPatio_Hub_Shipping_Method` posting to Hub quote API with session/transient cache, TaxJar-friendly `taxes` flags, emergency fallback rate, `_ccpatio_*` meta.

### 3. TaxJar pass-through in Woo webhook + QBO ledger mappers

**Files (expected):**  
`src/server/woocommerce/taxjar-passthrough.ts`, `src/server/woocommerce/ingress.schema.ts` (additive), webhook/ledger call sites as needed

- Extract/persist `total_tax`, `cart_tax`, `shipping_total`, `shipping_tax`, `tax_lines[]`, exemption meta, `shipping_lines[]` (+ `_ccpatio_*` quote meta).
- QBO Invoice/SalesReceipt builder uses exact TaxJar totals (`GlobalTaxCalculation: NotApplicable` + explicit tax lines); assert `items - discounts + shipping + tax === total`.
- `buildTaxExemptionSyncPayload(customer)` for Woo meta + TaxJar `/v2/customers`.

### 4. Partner handoff SSOT parity + Tab 4 Shipping & TaxJar console

**Files (expected):**  
`src/app/partner/primeview-handoff/*`, `src/components/` shared console, `EcommerceCertificationPortal.tsx` Tab 4

- Keep `force-dynamic` / `revalidate = 0`; live 32-finish (`6/6` powder) + 107 Title-Case SSOT; no admin mutation leaks.
- Dark **Shipping Bridge & TaxJar Checkout Integration** panel on partner handoff + GHL Tab 4: 1-click ZIP download, setup steps, live Quote Simulator.

### 5. Verification

**Files (expected):**  
`tests/woo-shipping-bridge-and-taxjar.test.ts`, `tests/e2e/woo-shipping-bridge-and-taxjar.spec.ts` (or under `e2e/`), `.cursor/phase.lock` blast sync

1. Vitest + Playwright prove auth, pallet math, ZIP PK signature, TaxJar penny reconciliation, SSOT + simulator UI.
2. `npx vitest run tests/woo-shipping-bridge-and-taxjar.test.ts` → PASS.
3. `npm run qa:lifecycle` → `exit_code: 0`.
4. Sync `expected_blast_radius` (`tolerance: 0`, excluding `.cursor/aar.json`).
5. `emit.mjs` + `qca.mjs` → **CERTIFIED** (`audit_exit: 0`); paste verbatim QCA JSON.

## Acceptance criteria

- Checkout never blocks: live FedEx or deterministic fallback + showroom pickup always returned.
- Bridge ZIP installs as a valid WC shipping method talking to Hub with shared secret.
- Woo → Hub → QBO preserves exact TaxJar cart + shipping tax (no recalculation).
- Partner + GHL Tab 4 expose ZIP download + working quote simulator on Certified SSOT.
- Target Vitest + `qa:lifecycle` green; QCA `CERTIFIED`.
