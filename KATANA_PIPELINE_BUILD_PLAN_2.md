# Packet 4.5 — Factory Polish (`airlock-1.5-factory-polish`)

**Phase:** `step-5.3-katana-blueprint-factory-polish`
**Parent blueprint:** `KATANA_PIPELINE_BUILD_PLAN.md` §1.5 (heuristic extraction) and execution order row 4.5.
**This packet writes no application code.** The next migration after `0049_free_stellaris` is `0050`.

**Outcome:** The GLB pass speaks to the designer when names fail, and when names pass it drafts the unbilled floor consumables, the LTL skid package, and the cushion fulfillment swap. Pure math stays in `src/lib/sketchup-cutlist/derived-heuristics.ts`. `src/lib/cad-upload/process-job.ts` remains the only writer. This packet does not call `syncBOMToKatana`, does not Approve, and does not add a Katana resource.

Depends on `airlock-1.5-ingest`. That job already deletes `source = sketchup_geometry` rows before insert, merges `weight_breakdown.aluminum` without clearing sibling keys, and leaves `est_weight_lbs` alone when `overrides.weightLbs` is a finite number (`process-job.ts` conflict `CASE`). Polish extends that job. It does not open a second Inngest event.

## Files the implementation packet may touch

- `src/lib/sketchup-cutlist/component-hygiene.ts` (`formatGeomHygieneMessage` only)
- `src/lib/sketchup-cutlist/derived-heuristics.ts`
- `src/lib/sketchup-cutlist/parse-glb-weldment.ts` (global footprint union and the new pure calls)
- `src/lib/cad-upload/process-job.ts`
- `src/lib/secondary-extraction/run.ts` (preserve rule in the freight section only)
- `src/server/db/schema.ts`
- the next SQL migration after `0049_free_stellaris` (`0050`)
- `src/server/db/migrations/meta/_journal.json`
- `src/server/db/migrations/meta/0050_snapshot.json`
- `tests/derived-heuristics.test.ts`
- `.cursor/phase.lock`

`expected_blast_radius` for that later packet is `11`. `override_blast_cap` is true. Target test: `npm run typecheck`. The `.dae` critic path is unchanged. Freight, consumables, and the cushion swap run on the GLB hygiene-pass branch only.

`geometry_snapshot.derived` gains the objects below. Keys already written on a pass (`powder`, `weight`, `joinery`) stay. `derived` remains `null` on hygiene fail, which `parse-glb-weldment.ts` already returns.

```ts
consumables: {
  argon: { jointCount: number; cubicFeet: number; drafted: boolean }
  sand: { surfaceFt2: number; pounds: number; excludedNames: string[]; drafted: boolean }
  caps: { lines: Array<{ profile: string; sku: string; ea: number }>; drafted: boolean }
} | null
freight: {
  aabb: { min: [number, number, number]; max: [number, number, number] }
  lIn: number
  wIn: number
  hIn: number
  skidBoardFt: number
  skidLumberLbs: number
  strapFt: number
  shrinkSqft: number
  grossFreightLbs: number
  dimWeightLbs: number | null
  reason: null | "degenerate_aabb" | "oversize_no_single_skid"
} | null
fulfillment: {
  mode: "standard" | "vacuum_compressed"
  applied: boolean
  reason: null | "no_cushion_geometry" | "labor_locked"
}
```

`drafted` is a writer fact. The pure functions do not set it. `process-job.ts` sets it after `insertGeometryLine` returns.

## 1. Actionable designer instruction

`GEOM_HYGIENE:` stays the prefix. Step 2 Continue, the manual path, and the release gate all key off that prefix. Polish replaces the body.

Today the fail branch in `processCadUploadJob` does three things, and the third is the defect:

1. Delete `product_bom_draft` rows for this parent where `source = sketchup_geometry`.
2. Build `snapshot.failures.map(f => name + " (" + reason + ")").join(", ")`.
3. Store `"GEOM_HYGIENE: " + that string` on `cad_uploads.error_message` and return it.

`parse-glb-weldment.ts` only pushes a failure for a structural node `evaluateComponentHygiene` rejects. Reasons already produced, and copied through unchanged, are:

- `Missing required ROLE-MATERIAL-PROFILE tokens`
- `Invalid role: ${role}`
- `Invalid material: ${material}`
- `Invalid profile: ${profileToken}`
- `Name must match ROLE-MATERIAL-PROFILE[-LENGTH][-ENDA-ENDB]`
- `Invalid length token: ${lenStr}`
- `Invalid end token: ${ea|eb}`
- The synthetic file row `{ name: "File", reason: "Zero structural nodes" }` when no structural mesh survives

`formatGeomHygieneMessage(failures)` lives in `component-hygiene.ts`. It does not import Katana. `process-job.ts` calls it on the GLB fail branch and stores the result in `cad_uploads.error_message`. The snapshot `failures` array stays the machine list. The sentence is only the column.

Group rows that share a `reason`. A structural node with an empty name prints `(unnamed node)`. When two rows share a name, append ` #2`, ` #3`, in file order. List at most 12 names. When more remain, end with `and N more. The geometry snapshot has the full list.` Cap the stored string at 2000 characters by dropping names from the tail, never by cutting the instruction off mid-word.

`inferred_override` is not a failure. A stated length that lost to the box still passes hygiene and must not appear here. Decorative meshes never enter `failures`: `isStructuralNode` is false unless the first token is a role (`FRM`, `LEG`, `ARM`, `SEAT`, `BACK`, `TOP`, `RAIL`) or any token is a profile code (`2X2`, `2X1`, `15X075`, `FB125`). A cushion or hardware mesh with none of those tokens is ignored, not scolded.

| `failures` | Body after the prefix |
|---|---|
| One row `name = "File"` and `reason = "Zero structural nodes"` | `No structural components were found. Group each frame member and rename it ROLE-MATERIAL-PROFILE (example: FRM-ALUM-2X2). Decorative meshes stay outside that grammar and are ignored.` |
| Any other fail list | `The following components failed the lengthless naming standard. Please group these meshes and rename using the ROLE-MATERIAL-PROFILE format (example: FRM-ALUM-2X2). Do not put inches in the name. The parser owns the cut length.` Then one bullet per listed node: `name — reason`. |

A zero-structural file must not tell the designer to rename a node called `File`. The formatter does not invent a second reason vocabulary and does not append stack text.

Hygiene fail still writes no drafts, no weight merge, no freight column, and no labor row. The geometry delete in the fail branch stays, so a re-upload that regresses does not leave the previous pass's consumable or skid lines behind.

## 2. Consumables matrix

These run only after hygiene passes, on the same passing metal components §1.5.6 already uses. Parent SKU is the frame parent the cut lines use (`data.globalSku`). `source = sketchup_geometry`. `status = draft_pending_review`. `scrapFactor = 1`. `cut_list` is empty. Quantity is rounded with the existing `round4` (4 decimal places). A rounded quantity of `0` writes no line. A missing live child SKU leaves the number on `derived.consumables` and sets that object's `drafted` to false. Argon and sand have no fallback list. Constants live in `derived-heuristics.ts` next to `ALUMINUM_DENSITY_LB_PER_IN3` and `TIG_WIRE_LB_PER_IN`.

| SKU | Driver | Formula | UOM |
|---|---|---|---|
| `RM-CONS-ARGON` | `joinery.jointCount` | `cubicFeet = jointCount × ARGON_CF_PER_JOINT` with `ARGON_CF_PER_JOINT = 0.15` | `cf` |
| `RM-CONS-SAND` | Powder surface | `pounds = surfaceFt2 × SAND_LB_PER_SQFT` with `SAND_LB_PER_SQFT = 0.15` | `lb` |
| Plastic end caps | `LEG` endpoints that meet zero joints | Profile table below. `joinery.capEa` remains the sum | `ea` |

New pure exports:

- `calculateArgon(jointCount)` returns `{ jointCount, cubicFeet }`.
- `calculateSand(components)` returns `{ surfaceFt2, pounds, excludedNames }`.
- `calculateJoinery` grows a `caps` array. `capEa` stays the sum so the existing weld-wire and fastener returns do not move.

`0.15` cubic feet per joint is the shop arc: 20 CFH for 27 seconds on one TIG joint. Joint identity is unchanged: expand each structural metal AABB (`ALUM` or `STL`) by `0.125` in, count an unordered pair once when the boxes intersect and the long axes differ. Parallel overlapping boxes are one member split in the model. They add no joint and no argon. A joint count of `0` writes no argon line and still records `cubicFeet: 0`.

`0.15` lb of blast media per square foot is a light aluminum prep. Sand uses the developed area `calculatePowder` already sums: `OUTSIDE_PERIMETERS[profile] × lengthIn × qty / 144`. It does not divide by `coverageSqftPerLb` and it does not use a `lb_per_ft` fallback. A metal component whose profile has no perimeter is skipped, named on `sand.excludedNames`, and the rest still draft. When every metal component is excluded, sand writes no line. Non-`ALUM` and non-`STL` names are omitted from sand the same way `calculateWeight` omits them from aluminum. They are not sand exclusions. Sand exclusions are metal members the perimeter table cannot price.

Caps stay one pass inside `calculateJoinery`. Today every dead `LEG` end is drafted as a single `RM_PLASTIC_CAP_2X2` quantity (`joinery.capEa`) through `CAP_LIVE_FALLBACKS`. Polish stops that. The writer emits one geometry line per SKU in `consumables.caps.lines`. A `LEG` endpoint is a dead end when that endpoint's joint tally is `0`, which the function already tracks as index `0` (min on the long axis) and `1` (max). Flat bar is not a tube and adds no cap. A missing per-profile SKU writes no line for that profile and still records `{ profile, sku, ea }` with `drafted: false` for that line.

| Profile | Cap SKU | Fallbacks |
|---|---|---|
| `SQ2-16` | `RM-PLASTIC-CAP-2X2` | existing `CAP_LIVE_FALLBACKS` |
| `SQ2x1-16` | `RM-PLASTIC-CAP-2X1` | none |
| `RT1.5x0.75-16` | `RM-PLASTIC-CAP-15X075` | none |
| `FB0.125x1.5` | none | none |

`onConflictDoNothing` on `(parent_sku, child_sku)` still applies. The geometry delete runs first, so a prior geometry cap line is replaced. A `source = manager` row for the same child SKU survives, the insert no-ops, and the snapshot keeps the calculated quantity with `drafted: false`.

Argon and sand are consumed on the floor. They are excluded from `est_weight_lbs` and from `gross_freight_weight_lbs`. Cap mass is not added to either figure. This packet has no cap density.

`cf` is not in `UNIT_OPTIONS` in `src/app/admin/factory-bom/factory-bom-ui.ts` (`ea`, `ft`, `yd`, `lb`, `lbs`, `boardft`, `slab`, `sqft`, `in`). The later `airlock-2-zod` packet adds `cf` so an argon line can release. This packet does not edit the Zod module or `UNIT_OPTIONS`. The draft insert may store `cf` before that packet lands. Release stays blocked until `cf` is legal.

`parse-glb-weldment.ts` calls the three functions only on the hygiene-pass return, beside the existing `calculatePowder`, `calculateWeight`, and `calculateJoinery` calls. The fail return stays `derived: null`.

## 3. LTL freight and the custom skid

The shipping footprint is the axis-aligned union of every meshed node in the GLB, including decorative nodes the cut parser ignores. Today `parse-glb-weldment.ts` `continue`s when `isStructuralNode(name)` is false, so cushions, slings, and decor never enter an AABB. The walker must accumulate a second union before that continue. A node with no `POSITION` accessor is skipped for the union the same way a structural node with no positions is skipped (`min[0] === Infinity`). World positions stay in inches via `METER_TO_INCH` (`39.37007874`) and `transformPoint`. Structural hygiene and the cut list still ignore decorative names.

Sort the three union extents so `lIn ≥ wIn ≥ hIn`. Length is the longest side of the shipping cube. It is not the glTF up axis. A zero or negative extent, or a union that never saw a position, sets `freight.reason = "degenerate_aabb"`, leaves `carton_lwh_in` and `gross_freight_weight_lbs` unchanged, and writes no packaging line. Hygiene can still pass. Consumables still draft.

`calculateFreight` is pure. Inputs are the union AABB and `aluminumLbs` from `calculateWeight` (the `0.098` lb/in³ volume figure). It does not read `aluminum_plf` and it does not read `overrides.weightLbs`.

Skid constants, nominal inches, board-feet as `(thickness × width × length) / 144`:

| Constant | Value |
|---|---|
| `SKID_OVERHANG_IN` | `3` per side |
| `SKID_RUNNER_COUNT` | `3` runners along `footL` |
| Runner section | `4 × 4` |
| Deck section | `2 × 4` |
| `SKID_DECK_SPACING_IN` | `12` on center |
| `SKID_HEIGHT_IN` | `6` (runner plus deck, the strap path) |
| `SKID_LUMBER_LB_PER_BF` | `2.5` (softwood at 30 lb/ft³; one board-foot is 1/12 ft³) |
| `SKID_MAX_SIDE_IN` | `192` |
| `STRAP_BANDS_GIRTH` | `2` |
| `STRAP_BANDS_LENGTH` | `2` |
| `STRAP_SEAL_ALLOWANCE_IN` | `12` per band |
| `SHRINK_OVERLAP` | `1.25` |
| `LTL_DIM_DIVISOR` | `139` (same divisor as `DIM_DIVISOR` in secondary extraction; the pure module does not import that package) |

```text
footL = lIn + 2 × SKID_OVERHANG_IN
footW = wIn + 2 × SKID_OVERHANG_IN
deckCount = max(2, ceil(footL / SKID_DECK_SPACING_IN) + 1)
skidBoardFt = 3 × (4 × 4 × footL) / 144 + deckCount × (2 × 4 × footW) / 144
skidLumberLbs = skidBoardFt × 2.5
girthFt = (2 × (footW + hIn + 6) + 12) / 12
lengthFt = (2 × (footL + hIn + 6) + 12) / 12
strapFt = 2 × girthFt + 2 × lengthFt
loadH = hIn + 6
shrinkSqft = 2 × (footL×footW + footL×loadH + footW×loadH) × 1.25 / 144
grossFreightLbs = aluminumLbs + skidLumberLbs
dimWeightLbs = ceil((footL × footW × loadH) / 139)
```

A manager lock on `est_weight_lbs` still leaves gross freight on the geometry aluminum figure. Net aluminum and skid lumber are the only addends. Powder, weld wire, fasteners, argon, sand, caps, foam, and fabric stay out.

When `footL` or `footW` is greater than `192`, set `reason = "oversize_no_single_skid"`, set `skidBoardFt`, `strapFt`, and `shrinkSqft` to `0`, and set `grossFreightLbs` to `aluminumLbs` alone. `dimWeightLbs` is still computed on that oversized cube so the operator can see the cube. This packet does not split a load across skids and writes no packaging line in that state.

Draft lines, same parent and source rules as consumables, rounded to 4 decimal places, no line when the quantity rounds to `0`:

| SKU | Quantity | UOM |
|---|---|---|
| `RM-PKG-SKID-LUMBER` | `skidBoardFt` | `boardft` |
| `RM-PKG-PET-STRAP` | `strapFt` | `ft` |
| `RM-PKG-SHRINK` | `shrinkSqft` | `sqft` |

`boardft`, `ft`, and `sqft` are already in `UNIT_OPTIONS`. This job does not draft `RM-PKG-STRETCH`, `RM-PKG-CORRUGATE`, or `RM-PKG-EDGE-BOARD`. Those remain the catalog-envelope lines from `computePackaging`.

Schema, on `recipe_estimates_draft`, beside `est_weight_lbs`:

```ts
gross_freight_weight_lbs: numeric("gross_freight_weight_lbs", { precision: 12, scale: 4 })
```

Nullable. No default. Existing rows stay null until a GLB pass writes them. `est_weight_lbs` is unchanged in type: `numeric(12, 4)`, still the net figure, still skipped on conflict when `overrides.weightLbs` is a JSON number.

The geometry upsert writes `gross_freight_weight_lbs` on insert and on conflict, including when the weight lock preserves `est_weight_lbs`. It `jsonb_set`s `weight_breakdown.skid_lumber` to `skidLumberLbs` and does not replace the breakdown object (the aluminum `jsonb_set` already uses this shape). It writes `carton_lwh_in` as `{ l: footL, w: footW, h: loadH }` and `est_dim_weight_lbs` from `dimWeightLbs` only when `overrides.dimWeightLbs` is not a finite number. It merges `packaging_bom.geometryFreight` (`lIn`, `wIn`, `hIn`, `skidBoardFt`, `strapFt`, `shrinkSqft`, `reason`) and leaves every other packaging key in place. On `degenerate_aabb` the upsert does not touch those four columns.

`runSecondaryExtraction` rebuilds `packaging_bom` and `carton_lwh_in` today. When the newest `.glb` row for that root has `geometry_snapshot.hygiene = "pass"` and `derived.freight.reason` is null, that rebuild keeps the existing `gross_freight_weight_lbs`, `carton_lwh_in`, `est_dim_weight_lbs`, and `packaging_bom.geometryFreight`. Catalog envelope lines may still refresh beside that key. A later GLB fail does not clear `gross_freight_weight_lbs`. The column stays at the last successful footprint until the next pass.

## 4. Vacuum compression toggle

Add a Postgres enum and a column on `recipe_estimates_draft`:

```ts
export const cushionFulfillmentModeEnum = pgEnum("cushion_fulfillment_mode", [
  "standard",
  "vacuum_compressed",
]);

cushion_fulfillment_mode: cushionFulfillmentModeEnum("cushion_fulfillment_mode")
  .notNull()
  .default("standard")
```

`standard` is an oversized corrugated box. `vacuum_compressed` is a 1.5 in dunnage board plus shrink wrap. The GLB job reads the stored mode and does not reset it on conflict. A new estimate row defaults to `standard`. The weight insert in `process-job.ts` must include the column only by omitting it, so the database default applies, and the conflict `set` must not assign `cushion_fulfillment_mode`.

Export `applyCushionFulfillmentMode(rootSku, mode)` from `process-job.ts` so Step 3 can call it later. This packet does not add the wizard control. `airlock-3-steps` owns that button. The function writes the column first, then applies the swap rules below. The GLB pass calls the same function with the mode it just read, so a re-upload does not clobber an operator's choice and still refreshes quantities from the new cushion box.

The mode is a no-op on the recipe when the upload root has no cushion geometry and no child SKU ending in `-CUSH`. Store the mode, set `fulfillment.applied` false and `reason` to `no_cushion_geometry`, and leave packaging lines and operations untouched. A root whose own SKU ends in `-CUSH` is the cushion parent. Otherwise the cushion parent is the child SKU in `product_bom` or `product_bom_draft` that ends in `-CUSH`. When several match, apply the swap to each. Do not create a cushion SKU.

Cushion footprint is the AABB union of nodes whose names contain `CUSH`, accumulated in the same walker as the global union, before the structural `continue`. When none exist, use the global footprint only if the root SKU itself ends in `-CUSH`. Otherwise skip the packaging write.

| Mode | Draft SKU | Quantity | UOM | Labor on the cushion parent |
|---|---|---|---|---|
| `standard` | `RM-PKG-CORRUGATE-OS` | `1` per cushion parent | `ea` | Sequence `30`, resource `Cushion Stuffing`, setup `0`, run `cushionStuffingMin` (`4.0` from `cushionSmvSplit`), notes `CUSHION_MODE:standard` |
| `vacuum_compressed` | `RM-PKG-DUNNAGE-15` | `(1.5 × cushionL × cushionW) / 144` | `boardft` | Sequence `30`, resource `Cushion Stuffing`, setup `VACUUM_COMPRESS_SETUP_MIN = 2`, run `VACUUM_COMPRESS_RUN_MIN = 6`, notes `CUSHION_MODE:vacuum_compressed` |
| `vacuum_compressed` | `RM-PKG-SHRINK` | Shrink area of the compressed cushion | `sqft` | Same sequence `30` row. One operation, two material lines |

The locked cushion track in `src/lib/factory-routing/resources.ts` is unchanged: sequence `10` Fabric Cutting, `20` Fabric Sewing, `30` Cushion Stuffing, `40` Quality Control. Polish edits sequence `30` only.

Compressed height is `max(VACUUM_MIN_HEIGHT_IN, cushionH × VACUUM_HEIGHT_FACTOR)` with `VACUUM_MIN_HEIGHT_IN = 2` and `VACUUM_HEIGHT_FACTOR = 0.35`. Shrink square footage uses the freight overlap formula on that cushion box (`SHRINK_OVERLAP = 1.25`), with no skid height added. Dunnage thickness is `1.5` in. `boardft` is already in `UNIT_OPTIONS`. A compressed box with a zero face sets `applied` false, writes no cushion packaging line, and leaves sequence `30` alone.

Switching mode deletes only this packet's geometry packaging rows for those SKUs on the cushion parent (`RM-PKG-CORRUGATE-OS`, `RM-PKG-DUNNAGE-15`, and a `RM-PKG-SHRINK` row whose notes say `cushion`), then inserts the active pair. The frame-level `RM-PKG-SHRINK` skid line stays. Notes on the cushion shrink line are `cushion`, so the two shrink rows do not share a delete. A manager row for the same child SKU is left in place (`onConflictDoNothing`).

Labor mutation touches sequence `30` on the cushion parent only. Sequences `10`, `20`, and `40` stay on the locked cushion track. The resource stays `Cushion Stuffing`, so the cushion track still sees that resource at sequence `30`. Extra sequences are not inserted. `KATANA_RESOURCES` does not gain a vacuum cell. Katana's operation name stays the resource name. The floor tells the modes apart by `notes` and the run minutes. `2` and `6` minutes are shop placeholders, the same class of unstudied number as the sandblast step. They are not a change to `smv-baselines.ts`.

Skip the labor write when that sequence `30` row has `source = manager` or `status = edited`. Set `fulfillment.reason = "labor_locked"` and still swap the packaging lines. When the row is absent, insert it with `source = sketchup_geometry`. When the row exists and is polish-owned (`notes` starts with `CUSHION_MODE:` or `source = sketchup_geometry`), update setup, run, and notes in place.

`applyStandardTrack(..., "cushion", "replace")` remains the manager hammer and may wipe the sequence `30` notes. The mode column is the source of truth. The next `applyCushionFulfillmentMode` call, or the next passing GLB job, puts sequence `30` back. This packet does not change `applyStandardTrack`.

## 5. Heuristic engine expansion

`derived-heuristics.ts` today exports `calculatePowder`, `calculateWeight`, and `calculateJoinery`, plus `ALUMINUM_DENSITY_LB_PER_IN3` and `TIG_WIRE_LB_PER_IN`. Packet 4.5 adds constants and functions in that file only. No I/O.

| Export | Reads | Returns |
|---|---|---|
| `calculateArgon` | `jointCount` from `calculateJoinery` | `{ jointCount, cubicFeet }` |
| `calculateSand` | Same component list powder uses, `OUTSIDE_PERIMETERS` | `{ surfaceFt2, pounds, excludedNames }` |
| `calculateJoinery` (extended) | Existing AABB pair loop | Existing fields plus `caps: Array<{ profile, ea }>` |
| `calculateFreight` | Union AABB, `aluminumLbs` | The `freight` object without `reason` bookkeeping the parser adds for a missing union |
| `calculateCushionPackage` | Mode, cushion AABB | `{ lines, labor: { setup, run, notes }, compressed: { l, w, h } }` |

`parse-glb-weldment.ts` owns the two unions (global mesh, `CUSH` mesh) and calls the pure functions on the pass path. `process-job.ts` owns live-SKU resolution, draft inserts, the estimate upsert, and `applyCushionFulfillmentMode`.

Edge cases the tests in `tests/derived-heuristics.test.ts` must pin:

- Zero joints yield argon `0` and no implied line.
- Parallel overlapping boxes yield no argon.
- A metal profile missing from `OUTSIDE_PERIMETERS` is a sand exclusion. The other members still produce a pound figure.
- `FB0.125x1.5` dead ends add no cap. `SQ2-16` dead ends add one `ea` on `RM-PLASTIC-CAP-2X2`.
- A degenerate union returns `degenerate_aabb` and does not invent a skid.
- `footL > 192` returns `oversize_no_single_skid`, packaging quantities `0`, and `grossFreightLbs === aluminumLbs`.
- Gross freight equals volume aluminum plus skid lumber, and does not change when a caller passes a different PLF weight.
- `standard` emits one corrugate each and labor `0 / 4.0`. `vacuum_compressed` emits dunnage board-feet and shrink square feet, labor `2 / 6`, and a compressed height of at least `2` in.
- `formatGeomHygieneMessage` on `[{ name: "File", reason: "Zero structural nodes" }]` does not contain the token `File`. A two-name list contains the instruction sentence and both `name — reason` bullets.

## 6. What this blueprint phase does not do

No edit to `schema.ts`, `derived-heuristics.ts`, or `process-job.ts` in this phase. No Katana HTTP. No change to `smv-baselines.ts`. No wizard control. `cf` waits for `airlock-2-zod`. The parent document's execution-order row 4.5 is the implementation packet that applies this section.
