# Production Operations (SMV) Integration Plan

**Status:** Architecture only — no implementation in this document  
**Source research:** [`docs/Research Files/Build_Time_Estimates.md`](./Research%20Files/Build_Time_Estimates.md)  
**Binding architecture:** [`docs/MDM_MASTER_BLUEPRINT.md`](./MDM_MASTER_BLUEPRINT.md) §5A.4 / §5B / §6.1  
**Related UX plan:** [`docs/FACTORY_BOM_KATANA_UX_PLAN.md`](./FACTORY_BOM_KATANA_UX_PLAN.md)

---

## 1. Executive verdict

We already have the right **Hub shape** for routings: `item_operations` (+ draft), locked Katana Resources, and `STANDARD_TRACKS` in `src/lib/factory-routing/resources.ts`. The research file supplies calibrated **Standard Allowed Minutes (SAM/SMV)** that should **replace the placeholder minutes** on those tracks — not invent a parallel `katana-operations.ts` dictionary or a new schema table for v1.

Katana bulk ops land via a **separate** “Add new product operations” import (not the 6-column recipes CSV). We will add a sibling exporter and keep the existing API path (`POST /product_operation_rows` via `syncBOMToKatana`) as the long-term Hub→Katana writer.

---

## 2. What the research gives us (canonical SMVs)

Baseline product models in the study:

| Model | Scope |
| --- | --- |
| Club chair frame ~34×34 | Metal cut / weld / grind / powder |
| Box cushion ~24×24 | Upholstery sequence |
| Dekton top ~72×36 | Stone CNC + handling |

### 2.1 Consolidated Industry Standard Times (PF&D included)

| IE Work Center | Operation | SMV (min) | PF&D | Notes for Hub |
| --- | --- | --- | --- | --- |
| Metal Cutting | Cold Saw Fabrication | **6.9** (0.86 / cut × 8) | 15% | Parametric: **0.86 min/cut** |
| Welding | TIG Welding & Fixturing | **55.9** | 20% | Parametric: **~0.16 min/in** + 3.0 SMED fixture; operating factor ~22% |
| Grinding/Prep | Mechanical Flush Grinding | **20.4** | 20% | Parametric: **1.25 min/joint** + 2.0 handling |
| Powder Coating | Prep, Spray (active labor) | **13.8** | 15% | **Exclude** 20 min oven from labor SMV; oven is machine time |
| Upholstery | Box Cushion Fabrication | **20.7** | 15% | Cut 2.5 + piping 4.5 + zipper 2.5 + sew 5.0 + stuff 3.5 (= 18.0 × 1.15) |
| Stone Fab. | Dekton CNC Route & Polish | **34.5** | 15% | Handling 10.0 + CNC ~20.0 |

Allowances to encode as constants (not free text):

- General / sewing / powder / CNC: **1.15**
- Heavy fab (weld, grind): **1.20**

### 2.2 Critical reconciliation with Hub lean Resources

Blueprint law: **never invent Katana Resource names** outside `src/lib/factory-routing/resources.ts`. The live lean lock **collapses** IE centers into physical cells:

| Research IE center | Hub / Katana Resource (locked) | How SMVs enter the Hub |
| --- | --- | --- |
| Metal Cutting | `FAB POD A` | Fold into consolidated fab run (or keep as parametric contributor) |
| Welding | `FAB POD A` (`operation_name` = `Fabrication & Welding`) | Primary contributor to fab pod run |
| Grinding/Prep | `FAB POD A` (lean removed discrete grind taps) | Fold into fab pod run |
| Powder (active) | `Powder Coating Booth` (+ separate `Curing Oven` for passive) | Split: labor SMV on booth; cure minutes on oven |
| Upholstery | `Fabric Cutting` / `Fabric Sewing` / `Cushion Stuffing` | Split the 20.7 SAM across the three cushion cells |
| Stone | `Dekton Fabrication` | New `dekton_top` Standard Track |

**Do not** re-introduce discrete Katana Resources named “Metal Cutting”, “Welding Station”, “Grinding Station” for this rollout — those are already legacy-aliased → `FAB POD A`.

---

## 3. Data storage recommendation

### 3.1 Decision

| Layer | Location | Role |
| --- | --- | --- |
| **SSOT for Resources + default tracks** | Extend `src/lib/factory-routing/resources.ts` | Locked `KATANA_RESOURCES`, `STANDARD_TRACKS`, aliases |
| **IE parametric SMV library** | **New** `src/lib/factory-routing/smv-baselines.ts` | Pure constants + pure functions (per-cut, per-inch, per-joint, allowances) sourced from the research file |
| **Per-SKU runtime rows** | Existing Postgres `item_operations` / `item_operations_draft` | What Factory UI edits and what we publish/export |
| **Not for v1** | New `src/lib/katana-operations.ts` | Avoids a second SSOT that drifts from Resources |
| **Not for v1** | New DB table for SMVs | Baselines are code-versioned industrial standards; calibration later can write back into track defaults or `material_physics_factors` / estimates drafts |

### 3.2 Why code library + DB rows (not seed-only)

- **Baselines** change when IE revises the study → commit to git, unit-test the arithmetic.  
- **Assigned operations** are product-specific and already live in `item_operations` (Approve → Katana).  
- Factory already calls `applyStandardTrack()`; recalibrating track minutes automatically upgrades the Apply button without a migration.

### 3.3 Proposed shape of `smv-baselines.ts` (design only)

```ts
// Conceptual — not implementing yet
export const PF_AND_D = { general: 1.15, heavyFab: 1.20 } as const;

export const SMV = {
  coldSawMinPerCut: 0.86,          // includes 15% PF&D
  weldMinPerLinearInch: 0.16,      // clock-time derived; research total for club chair = 55.9
  weldFixtureSetupMin: 3.0,        // SMED normal; rolled into heavy allowance in totals
  grindMinPerJoint: 1.25,
  grindHandlingMin: 2.0,
  powderActiveLaborMin: 13.8,      // booth labor only
  powderCurePassiveMin: 20.0,      // oven — not labor
  cushion: { cut: 2.5, piping: 4.5, zipper: 2.5, sew: 5.0, stuff: 3.5 },
  dektonHandlingMin: 10.0,
  // CNC feed rates for perimeter-driven stone (m/min) ...
} as const;

export function clubChairFrameFabPodRunMin(cuts: number, weldInches: number, joints: number): number;
export function splitCushionSamToTrackSteps(): { cutting; sewing; stuffing }; // × 1.15
```

`STANDARD_TRACKS` then **imports** these functions / rolled totals instead of hard-coded `60` / `22` placeholders.

### 3.4 Recommended recalibrated track targets (v1 roll-up)

These are the numbers Standard Tracks should converge to for the **baseline club chair / box cushion / Dekton top**. Exact sequence split is an implementation detail; totals must match research.

**Aluminum frame (`aluminum_frame`) — lean cells**

| Seq | Resource | Floor label | Suggested setup | Suggested run (SMV-aligned) | Rationale |
| --- | --- | --- | --- | --- | --- |
| 10 | `FAB POD A` | Fabrication & Welding | 3.0 (SMED fixture) | **~83.2** | 6.9 cut + 55.9 weld + 20.4 grind |
| 20 | `Sandblasting` | Sandblast | keep/calibrate | *(research silent — retain current or mark TBD)* | Not in IE study |
| 30–60 | Powder booth + curing oven | Primer / cures / final coat | small setups | **Booth labor Σ ≈ 13.8**; oven rows hold **passive 20+** | Split active vs passive per research |
| 70–80 | QC / Pack | Final Check / Pack | 0 / small | retain or modest IE later | Not in IE study |

**Cushion (`cushion`)**

| Resource | Suggested run | Split of 20.7 SAM |
| --- | --- | --- |
| `Fabric Cutting` | ~2.9 | 2.5 × 1.15 |
| `Fabric Sewing` | ~13.8 | (4.5+2.5+5.0) × 1.15 |
| `Cushion Stuffing` | ~4.0 | 3.5 × 1.15 |
| `Quality Control` | retain | Not in IE study |

**New track: `dekton_top`**

| Resource | Suggested run |
| --- | --- |
| `Dekton Fabrication` | **34.5** (handling + CNC + polish, PF&D in) |

Sandblast / pack / FG assembly minutes outside the study stay as **explicit TBD** — do not invent fake IE precision.

---

## 4. Mapping logic (SKU → operations)

### 4.1 Family resolver (new pure module)

**Create:** `src/lib/factory-routing/assign-track.ts` (name flexible)

Input: Hub SKU (+ optional `item_type`, display name, BOM children).  
Output: `StandardTrackId | null` and confidence.

| Pattern | Track | Notes |
| --- | --- | --- |
| `ASM-*-FRAME` / `SA-*-FRAME` | `aluminum_frame` | Primary metal weldment parents |
| `ASM-*-CUSH` / `SA-*-CUSH` / `*-CUSHION*` | `cushion` | Soft-goods parents |
| `ASM-*` / `SA-*` with stone role / `DKT` / Dekton in name | `dekton_top` | Table tops / stone SAs |
| `FIN-*` that is frame-only FG | Optional: only QC + Pack **or** no ops if children own fab | Prefer ops on **producible SA/ASM**, not duplicated on FIN |
| `FIN-*` with FRAME + CUSH children | **No full fab track on FIN** | FIN gets Assembly & Packaging (+ QC) only, if anything |
| `RM-*`, `MET-*`, `FAB-*`, `PWD-*`, `STN-*`, `CUT-*` | **null** | Materials / cut identity — never receive production operations |

Reuse existing helpers where possible:

- `src/lib/raw-material-sku.ts` — refuse materials  
- `src/lib/ocean-bom.ts` / `collection-catalog.ts` role hints (`frame` \| `cushion`)  
- `resourceLane()` already buckets Resources by lane

### 4.2 Assignment modes

1. **Interactive (shipped path):** Factory UI `applyStandardTrack({ trackId, mode: "replace" \| "fill_gaps" })` — keep; wire cushion + dekton buttons.  
2. **Bulk seed (new ops script):** `scripts/ops/apply-standard-tracks.ts`  
   - Select producible SKUs from `sku_mappings` (and/or Phase 1–2 SOW list)  
   - Resolve track via `assign-track`  
   - Upsert into `item_operations_draft` or live `item_operations` behind `--confirm`  
   - Default `--dry-run` → CSV of planned rows  
3. **Parametric override (phase 2):** When `cut_list` exists on a FRAME, recompute fab-pod run from cut count / weld inches instead of club-chair constants. Research already exposes the drivers (0.86/cut, ~0.16/in, 1.25/joint).

### 4.3 Idempotency & uniqueness

Respect existing unique key `(item_sku, work_center, sequence)` (migration `0022`). Bulk apply must use the same `fill_gaps` / `replace` semantics as the UI action so Factory and CLI cannot diverge.

---

## 5. Export pipeline (Katana Production operations)

### 5.1 Important split from recipes

| Artifact | Katana importer | Hub exporter today |
| --- | --- | --- |
| BOM ingredients | **Add new recipes** | `scripts/ops/export-katana-bom-template.ts` → `Add-new-recipes.csv` |
| Routings / SMVs | **Add new product operations** | **Missing** — API-only via `syncBOMToKatana` |

Do **not** extend the 6 recipe columns with work-center fields. Katana will reject or ignore them; ops have their own template.

### 5.2 Official ops import columns (Katana)

From Katana “Add new product operations” / bulk update docs:

1. `Product variant code / SKU (required)` — must already exist as a product  
2. `Product operation name (required)`  
3. `Resource` — must match locked Hub Resources (or Katana will **create** stray cells — guard this)  
4. `Cost parameter` — $/hr (Hub may leave blank or map later from shop rates)  
5. `Hours` / `Minutes` / `Seconds` — planned time (minutes may exceed 60; Katana normalizes)  
6. `Operation type` — present if Manufacturing add-on enabled (`setup` \| `process` etc.)

Import behavior in Katana UI: **Replace existing operations** (preferred for SOW cutover) vs **Add to existing**.

### 5.3 New Hub exporter (proposed)

| File | Purpose |
| --- | --- |
| `src/lib/katana-operations-csv.ts` | Types, header constants, RFC 4180 writer, minutes→H/M/S split, setup/process row expansion |
| `scripts/ops/export-katana-operations-template.ts` | Read live `item_operations` (optionally draft), emit CSV/XLSX-compatible CSV |
| `tests/katana-operations-csv.test.ts` | Header order, time split, Resource ⊆ `KATANA_RESOURCES` |
| npm | `ops:export-katana-operations-template` |

**Row expansion (match API writer):** For each Hub op with `setup_time_mins > 0`, emit:

1. `{operation_name} Setup`, type `setup`, time = setup  
2. `{operation_name}`, type `process`, time = run  

Where `operation_name = resolveKatanaOperationName(work_center)` and `Resource = normalizeKatanaResource(work_center)`.

**Output path (suggested):**  
`docs/Katana Downloads/Add-new-product-operations.csv`

### 5.4 Dual delivery paths (keep both)

```
item_operations (Hub SSOT)
        │
        ├─► export-katana-operations-template.ts  →  Katana Data Import (bulk SOW)
        │
        └─► publishApprovedRecipeToKatana /
            syncBOMToKatana                      →  POST /product_operation_rows (ongoing)
```

Bulk CSV is for **initial sterilization / mass cutover** (same pattern as recipes). API publish remains the **approved Factory** path. Both must call the same Resource normalizer and time conversion (minutes → seconds in API; H/M/S in CSV).

### 5.5 Pre-flight guards before import

1. Every `Resource` ∈ `KATANA_RESOURCES` (fail export if not).  
2. Every SKU exists as a Katana **product** (reuse material/product sync patterns / post-missing products).  
3. No ops rows for `RM-*` / colorways / `CUT-*`.  
4. Dry-run report: `tmp/katana-operations-export-[stamp].csv` with sku, track, resource, setup, run, source.

---

## 6. Step-by-step implementation build plan

### Phase 0 — Align numbers (½ day)

1. Encode research constants in `smv-baselines.ts` with unit tests that assert the club-chair / cushion / Dekton totals (6.9, 55.9, 20.4, 13.8, 20.7, 34.5).  
2. Document sandblast / pack / QC as **out-of-study** in comments.  
3. Diff proposed track minutes vs current `STANDARD_TRACKS` placeholders; get ops sign-off on fab-pod roll-up (~83.2 vs today’s 60).

### Phase 1 — Calibrate Standard Tracks (1 day)

1. Update `STANDARD_TRACKS.aluminum_frame` and `.cushion` to consume SMV baselines.  
2. Add `StandardTrackId = "dekton_top"` + track steps on `Dekton Fabrication`.  
3. Extend Factory UI: Apply Cushion Routing + Apply Dekton Routing (mirror aluminum).  
4. Unit tests: every track Resource ⊆ catalog; totals within tolerance of research.

### Phase 2 — Programmatic SKU assignment (1–2 days)

1. Implement `assign-track.ts` rules (§4.1).  
2. Add `scripts/ops/apply-standard-tracks.ts` with `--dry-run` / `--confirm`, SOW filter optional (`Add-new-recipes.csv` parents or `Phase1_and_2_SKUs.csv`).  
3. Write dry-run CSV under `tmp/`; require human confirm for live DB writes.  
4. Optionally call from Factory bulk action later — not required for v1.

### Phase 3 — Katana ops CSV exporter (1 day)

1. Implement `katana-operations-csv.ts` + export script (§5.3).  
2. Guard Resources; expand setup/process rows.  
3. Manual Katana import: **Replace existing operations** for SOW SKUs only.  
4. Spot-check 3 SKUs in Katana Production operations tab (one FRAME, one CUSH, one Dekton).

### Phase 4 — Publish path parity (½–1 day)

1. Confirm `syncBOMToKatana` already posts setup/process with `planned_time_parameter` in seconds — no behavior change beyond track minutes.  
2. Add a small ops-only sync dry-run report if missing (sku, resource, setupSec, runSec).  
3. Do **not** implement V8 bus; do **not** change recipe CSV headers.

### Phase 5 — Parametric calibration (optional follow-on)

1. Drive fab-pod run from `cut_list` cut counts + estimated weld inches.  
2. Drive Dekton run from perimeter meters using research feed rates (0.8 / 0.6 m/min).  
3. Feed actual MO times back into baselines (Blueprint §5C) — out of scope for first cutover.

---

## 7. Files to create or modify

### Create

| Path | Why |
| --- | --- |
| `src/lib/factory-routing/smv-baselines.ts` | IE constants + pure SMV math from research |
| `src/lib/factory-routing/assign-track.ts` | SKU → Standard Track resolver |
| `src/lib/katana-operations-csv.ts` | Katana ops import CSV codec |
| `scripts/ops/export-katana-operations-template.ts` | Bulk ops export |
| `scripts/ops/apply-standard-tracks.ts` | Bulk assign tracks to Hub SKUs |
| `tests/factory-routing-smv-baselines.test.ts` | Lock research arithmetic |
| `tests/factory-routing-assign-track.test.ts` | SKU family rules |
| `tests/katana-operations-csv.test.ts` | Headers / time split / Resource guard |
| `docs/Katana Downloads/Add-new-product-operations.csv` | Generated artifact (gitignored or committed like recipes — team choice) |

### Modify

| Path | Why |
| --- | --- |
| `src/lib/factory-routing/resources.ts` | Recalibrate `STANDARD_TRACKS`; add `dekton_top`; keep Resource lock |
| `src/app/admin/factory-bom/actions.ts` | Expose new tracks through `applyStandardTrack` (already generic on `trackId`) |
| `BomOperationsPanel` (Factory UI) | Apply Cushion / Dekton buttons |
| `package.json` | `ops:export-katana-operations-template`, `ops:apply-standard-tracks` (+ `:confirm`) |
| `tests/factory-routing-resources.test.ts` | Assert new track totals / Resources |
| `docs/FACTORY_BOM_KATANA_UX_PLAN.md` | Mark cushion/dekton + ops CSV as planned/shipped when done |

### Explicit non-touches

- `export-katana-bom-template.ts` recipe headers — **unchanged**  
- V8 transactional bus — **forbidden**  
- Inventing new Katana Resources from IE names — **forbidden**  
- Writing ops onto `RM-*` / `CUT-*` — **forbidden**

---

## 8. Acceptance criteria (when we implement)

1. Unit tests reproduce research totals within **±0.1 min** for the six published SMVs.  
2. `assign-track` maps FRAME → aluminum, CUSH → cushion, Dekton SA → dekton_top; materials → null.  
3. Ops CSV opens in Katana Data Import without column remap; Resources do not create unknown cells.  
4. Dry-run apply script lists every SOW parent that would receive ops; `--confirm` writes Hub rows with unique `(sku, work_center, sequence)`.  
5. Spot-check: FRAME shows fab pod run ≈ cut+weld+grind roll-up; CUSH shows split sewing SAM; Dekton shows 34.5.  
6. Recipe export and ops export remain **two files / two importers**.

---

## 9. Suggested operator commands (post-implementation)

```bash
# Recalculate / preview Hub assignments
npm run ops:apply-standard-tracks
npm run ops:apply-standard-tracks:confirm

# Emit Katana Production operations bulk file
npm run ops:export-katana-operations-template

# Ongoing Factory path (unchanged conceptually)
# Approve draft in /admin/factory-bom → publishApprovedRecipeToKatana
```

Then in Katana: **Settings → Data import → Production operations → Upload** → choose **Replace existing operations** for the SOW set.

---

## 10. Open decisions (need ops sign-off before coding)

1. **Fab pod roll-up:** Accept **~83.2 min** consolidated run on `FAB POD A`, or keep IE cut/weld/grind as **notes-only breakdown** with a different agreed total?  
2. **Powder split:** Keep Hub’s multi-step primer/final/cure topology and allocate the **13.8** active minutes across booth steps, or collapse to a single booth process + oven passive rows?  
3. **FIN-* ops:** Assembly/Pack only vs none (children own all fab)?  
4. **Cost parameter:** Leave blank in CSV v1, or supply a shop $/hr rate card?  
5. **Commit generated ops CSV** next to `Add-new-recipes.csv`, or only write under `tmp/` until import succeeds?

---

*End of plan — implementation starts only after review of §10 and Phase 0 number sign-off.*
