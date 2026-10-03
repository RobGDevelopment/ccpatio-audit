# BOM Enrichment Plan (Hub → Katana)

**Status:** ✅ Executed 2026-09-14 — live + draft written; XLSX re-exported (634 rows)  
**Script:** `scripts/ops/enrich-frame-finish-bom.ts` (`npm run ops:enrich-frame-finish-bom:confirm`)

## Headline findings

| Metric | Value |
|--------|------:|
| `SA-*-FRAME` parents in live `product_bom` | 67 |
| Frames with MET tubing | 66 |
| Frames with any powder (`RM-PWD-*` / `PWD-*`) | **0** |
| Frames with primer | **0** |
| Need powder + primer inject | **66** |
| Avg / min / max tubing LF | 66.4 / 17 / 151 |
| Live `RM-DKT-GENERIC-SLAB` rows | 22 |
| Live `RM-FAB-GENERIC` rows | 13 |
| Live `RM-PWD-GENERIC` rows (not on `*-FRAME`) | 4 |
| Draft `RM-PWD-GENERIC` rows | 133 |

**Important:** There is **no `RM-PRM-*` namespace** in Hub. Primer is `PWD-GRAY-ZINC-EPOXY-PRIMER`.

## Recommended baseline SKUs (discovered, not invented)

| Role | SKU | Proposed use |
|------|-----|----------------|
| Powder (default finish) | `PWD-BLACK` | Inject on `SA-*-FRAME`; MTO swaps to other `PWD-*` |
| Primer (factory consumable) | `PWD-GRAY-ZINC-EPOXY-PRIMER` | Inject on frames (not a sellable finish) |
| Powder placeholder | `RM-PWD-GENERIC` | Optional migrate → `PWD-BLACK` |
| Fabric placeholder | `RM-FAB-GENERIC` | **Keep** — do not swap to `FAB-*` |
| Dekton placeholder | `RM-DKT-GENERIC-SLAB` | **Keep** — do not swap to `STN-DKT-*` |

Sellable powders synced yesterday: `PWD-BLACK`, `PWD-BONE`, `PWD-FANUC-GRAY`, `PWD-LITE-BEIGE`, `PWD-OIL-RUB-BRONZE`, `PWD-WILD-RICE`.

## Do not blindly swap FAB / DKT generics

MDM / Capital Stack treat `RM-FAB-GENERIC` and `RM-DKT-GENERIC-SLAB` as intentional MTO placeholders. Colorways (`FAB-*`, `STN-DKT-*`) are swapped at order time. Putting them on standard recipes breaks catalog guard.

## Math — tubing LF → powder / primer lb

Prefer Hub heuristic in `src/lib/heuristic-bom.ts` → `powderPounds()`:

```
LF = Σ (quantity × scrap_factor)
    for child_sku matching RM-MET-%TUBING% or MET-%TUBING%
    (exclude RM-MET-FLATBAR)

powder_lb = max(0.1, 0.08 × LF)

# Cost 2025: powder $0.21/sqft · primer $0.23/sqft
primer_lb = max(0.1, powder_lb × (0.23 / 0.21))
```

Worked example @ avg 66.42 LF → powder ≈ 5.31 lb · primer ≈ 5.82 lb.

## Proposed actions (after approval)

1. **FAB/DKT:** no-op (generics stay).
2. **Optional:** remap 4× live (+ draft) `RM-PWD-GENERIC` → `PWD-BLACK`.
3. **Inject** `PWD-BLACK` + `PWD-GRAY-ZINC-EPOXY-PRIMER` on 66 frames lacking finish; mirror `product_bom_draft`.
4. Dry-run → `--confirm` → re-run `export-katana-bom-template.ts`.

### Consumable insert shape

```ts
const POWDER_SKU = "PWD-BLACK";
const PRIMER_SKU = "PWD-GRAY-ZINC-EPOXY-PRIMER";

await db.insert(product_bom).values({
  parent_sku: frameSku,
  child_sku: POWDER_SKU,
  quantity: powderLb(lf).toFixed(4),
  scrap_factor: "1.0000",
  unit_of_measure: "lb",
  notes: "Enrichment: powder from tubing LF × 0.08",
  cut_list: [],
}).onConflictDoUpdate({
  target: [product_bom.parent_sku, product_bom.child_sku],
  set: {
    quantity: sql`excluded.quantity`,
    unit_of_measure: sql`excluded.unit_of_measure`,
    notes: sql`excluded.notes`,
    updated_at: sql`now()`,
  },
});
// same for PRIMER_SKU with primerLb(...)
```

## Decision checklist

1. Powder inject SKU = `PWD-BLACK` (vs `RM-PWD-GENERIC`)?
2. Primer = `PWD-GRAY-ZINC-EPOXY-PRIMER`?
3. FAB/DKT generics stay (no colorway swap)?
4. Formula = `0.08 × tubing LF`?
5. Also patch `product_bom_draft`?

## Sources

`sku_mappings` · `product_bom` · `product_bom_draft` · `tmp/katana-material-cost-updates.csv` · `docs/CAPITAL_STACK_VENDOR_HANDOFF.md` · `src/lib/heuristic-bom.ts` · `scripts/ops/update-katana-material-costs.ts`
