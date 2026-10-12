# SketchUp Design Team Workspace — Completion Plan

**Status:** Blueprint only. No application code in this document.  
**Date:** 2026-10-12  
**Audience:** Lead Systems Architect  
**Binding source of truth:** `docs/MDM_MASTER_BLUEPRINT.md`  
**Companion already executed:** `BUILD_PLAN.md` (Airlock Phase 5 packets). This plan finishes what those packets left open. It does not reopen MDM Phases 0–5 and it does not implement the V8 transactional bus.

**Process gate:** `.cursor/phase.lock` is still `mdm-harden-phase-3` (`src/inngest/functions.ts`, `src/inngest/seo-suggest.ts`, `tests/seo-saga-isolation.test.ts`). SketchUp Phase 1 cannot start until that lock is replaced by `write-lock.mjs` for the packet being built. `node .cursor/skills/qca/scripts/qca.mjs` is the only certification authority. Exit code 2 stays `DEFECT_REJECTED`.

**Director gates that stay locked** (from `BUILD_PLAN.md` §6):

1. `.skp` geometry stays fail-closed with `SKP_CONVERT_UNAVAILABLE`. Thumbnail extraction stays. A SketchUp SDK reader is a later decision, not a hidden `trimesh` path.
2. Custom manufacturing orders stay `POST /manufacturing_orders` after a clean release. They are not make-to-order and they are not a second sales order.
3. Catalog promotion ends at a `FIN-*` dictionary row. `sync_to_woo` and `sync_to_clover` stay false. WooCommerce readiness is a human dictionary step, surfaced here as a checklist, never flipped by CAD math.
4. Python, Blender, and `trimesh` convert bytes. They do not write `product_bom_draft`.

---

## Section 1: Current State

Two lanes already exist. They must stay separate.

| Lane | Entry | What it writes | Katana / Woo |
|---|---|---|---|
| Designer JSON | `POST /api/webhooks/sketchup` with HMAC `X-CCPatio-Signature` and Zod `src/server/sketchup/ingest.schema.ts` (depth 12, `export_id` UUID) | `product_intake` status `quarantined`. Invalid payloads return `400` and insert nothing. | Quarantine Approve fans out through Inngest. Woo skips when `sync_to_woo` is false. **MDM Phases 0–5 are complete.** |
| Design-team geometry | `/embed/factory-bom` Airlock, plus `/admin/factory-bom` | `cad_uploads` then `product_bom_draft` / `item_operations_draft` / `recipe_estimates_draft`. Live `product_bom` changes only on Approve. | Factory Publish calls `syncBOMToKatana`. Custom release calls `executeReleaseCustomBuild`. Neither path sets Woo or Clover flags. |

### 1.1 Design-team surfaces that are built

- **Airlock wizard** at `/embed/factory-bom`: file-first `IntakeDropzone`, custom-versus-catalog `FunnelFork`, PDF line match in `PacketLines`, then steps Identity & CAD, Cut List, Operations, Release.
- **Identity:** `custom_build_jobs` (migration `0052_custom_build_jobs.sql`), `mintCustomJob` (`JOB-*`, `product_origin` null, both sync flags false), `promoteToCatalog` (rename to `FIN-*`, flags stay false).
- **Release:** `Step4Release` calls `publishApprovedRecipeToKatana` and `releaseCustomJobAction`. Inngest `releaseCustomJob` is registered. Cut cards live at `/factory/cut-cards/[token]` (HMAC, unframeable, no session).
- **Admin workbench** stays a separate sidebar at `/admin/factory-bom` (`CadUploadDropzone`, draft tree, estimates, Approve, Publish).
- **Commerce vault** at the master-catalog embed can drop CAD through the same `requestCadUpload` action. Its file picker is narrower than the airlock (`.dae` / `.skp` only).

### 1.2 Geometry engines that are built

| Input | Runtime | Result today |
|---|---|---|
| Named `.glb` | `parseGlbWeldment` (`@gltf-transform`). Meters converted with `METER_TO_INCH`. Nodes must match `ROLE-MATERIAL-PROFILE` in `component-hygiene.ts`. | On hygiene pass, `processCadUploadJob` writes draft metal, powder, weld wire, fasteners, caps, argon, sand, and freight lines, plus cushion packaging. On hygiene fail, drafts for `source = sketchup_geometry` are deleted and the job is `failed` with `GEOM_HYGIENE`. Step 1 still allows Continue so a person can type the cut list. |
| `.dae` | `parseDaeWeldmentFromXml` then `instantiateDraftsFromDae` | Measured sticks are forced through **one of two family templates**: Waterfall dining table when the hint matches `WFT` / `WATERFALL`, otherwise **Bravada club chair**. Vision critic can refuse the write. Secondary extract runs. One draft operation is inserted: `FAB POD A`, sequence 20, 15 minutes. |
| `.blend` | `services/cad-convert` (FastAPI + Blender `export_blend.py` + a `trimesh.load` that only proves the GLB opens) then the GLB branch | Worker code exists. `convertBlendToGlb` is called from `processCadUploadJob`. Inngest preserves `blend`. The **upload gateway rejects `.blend`** before a row is queued. |
| `.skp` | `extractSkpThumbnail` | PNG may update `finished_goods_catalog.image_url`. Geometry status is `failed` / `SKP_CONVERT_UNAVAILABLE`. Converter returns HTTP 415 for `.skp`. |
| Legacy SketchUp `.obj` | `src/lib/obj-cutlist/parse-obj-weldment.ts` plus `profile-crosswalk.ts` | Pure function and unit tests. **Not called by any upload, Inngest job, or UI.** |
| SketchUp Ruby walker | `scripts/sketchup/export_cutlist_walker.rb` | Emits `WalkerExport` JSON for the HMAC webhook lane. It is not the GLB parser. |

### 1.3 Heuristics, schemas, and tests already in place

- Cut cards and Katana ingredient notes: `src/lib/sketchup-cutlist/notes-codec.ts` (255-character tablet dialect).
- Long-point / miter math: `long-point.ts`.
- Derived consumables: `derived-heuristics.ts` (powder, weight, joinery, argon, sand, freight, cushion package).
- Airlock Zod: `src/server/factory-bom/airlock.schema.ts` (`dae | glb` only on the dossier CAD node).
- SketchUp ingest Zod: `src/server/sketchup/ingest.schema.ts`.
- Unit coverage: `sketchup-cutlist`, `dae-weldment`, `component-hygiene`, `derived-heuristics`, `notes-codec`, `cad-upload-pipeline` (extension allow-list and DAE buffer parse), `cad-convert-client` (mocked HTTP), `obj-cutlist`, `custom-build-job`, `factory-order-packet`, `factory-cut-card-token`, `airlock-dossier`.
- E2E: `tests/e2e/factory-bom-lifecycle.spec.ts` deep-links `?sku=`.

### 1.4 What “working” means, and where it stops

A designer can drop a **named** `.glb` or a **Waterfall/Bravada** `.dae` on an existing SKU, get draft rows, walk the airlock, and release a Katana recipe under `CATALOG_PUBLISH_MODE` (example env is `log`, so publish stays a dry run until that flag is changed on purpose).

A designer cannot yet treat an arbitrary legacy SketchUp model as a Katana-ready recipe. Unnamed meshes fail hygiene or get the Bravada template. `.blend` never enters the queue. GLB metal lines omit the 1.08 scrap factor and omit Katana cut-card notes. GLB jobs do not stamp the aluminum Standard Track. Woo stays correctly dark, and the airlock does not show that commerce checklist.

---

## Section 2: Remaining Tasks

- **Upload gateway rejects `.blend`.** `requestCadUpload` allows only `dae`, `glb`, and `skp`. `CadUploadDropzone` and `IntakeDropzone` `accept` lists match that. Inngest and `processCadUploadJob` already know `blend`. The heavy lane is dead at the door.
- **Master-catalog CAD picker omits `.glb`.** `AssetVaultDropzone` accepts `.dae,.skp` and the hint says `.dae / .skp`. A GLB dropped there never starts the fast lane.
- **`.blend` is absent from the Airlock dossier enum.** `AirlockDossierSchema` CAD `ext` is `dae | glb`. After conversion the stored object should be the sibling `.glb`. The dossier and Step 1 continue rule must keep requiring `dae` or `glb` on the parsed row, and the UI must say when the original file was `.blend`.
- **`trimesh` inch check is a load, not a check.** `services/cad-convert/app.py` loads the GLB and returns it. glTF is meters by spec. Inch conversion already lives in `parseGlbWeldment` (`METER_TO_INCH`). The converter must not grow a second BOM writer and must not reject a metric GLB.
- **`CAD_CONVERT_URL` is undocumented.** `convert-client.ts` defaults to `http://localhost:8000/convert`. `.env.example` has no `CAD_CONVERT_URL`. A deployed Inngest worker will call localhost.
- **Named-node GLB is the only automatic mesh.** `isStructuralNode` requires a role token (`FRM`, `LEG`, `ARM`, `SEAT`, `BACK`, `TOP`, `RAIL`) or a profile token (`2X2`, `2X1`, `15X075`, `FB125`). Legacy SketchUp names (`Mesh12`, `Group15`) produce `Zero structural nodes`, wipe geometry drafts, and stop. That is correct for a bad name, and it is the wrong outcome for a 6-face stick the OBJ walker already knows how to measure.
- **World-axis AABB is the GLB ruler.** `parseGlbWeldment` takes the longest axis of the node bounds. Rotated mitred tube (the Ocean sofa case in `docs/AUTOMATED_BOM_EXTRACTION_PLAN.md`) stores the miter face as if it were a profile. Edge-length long-point math already exists in `long-point.ts` and `parse-obj-weldment.ts`. It is not applied to GLB primitives.
- **Fused meshes have no explicit quarantine status.** The OBJ plan’s `fused_mesh` outcome (one blob, no per-tube group) is not a `cad_uploads` result. Those files collapse into the same `GEOM_HYGIENE` / zero-node failure as a misnamed stick.
- **DAE instantiator has two families and a dangerous default.** `buildPlan` in `instantiate-from-dae.ts` returns `instantiateBravadaClubChair` for every non-Waterfall file. A dining chair DAE can be written as a club-chair recipe when the critic does not refuse it.
- **GLB draft rows are not Katana cut cards.** Metal notes are `` `${cuts.length} pieces from ${rmSku}` ``. `scrap_factor` is `"1"`. `formatKatanaIngredientNote` / `DEFAULT_TUBE_SCRAP_FACTOR` (1.08) are not used on this path. Publish would send net feet without kerf and without the tablet note.
- **GLB does not stamp routing.** The only operation insert in `process-job.ts` is cushion sequence 30 (`Cushion Stuffing`) inside `applyCushionFulfillmentMode`. Metal Standard Track (`KATANA_RESOURCES` / `applyStandardTrack`) never runs from a GLB job. DAE writes a single `FAB POD A` row at sequence 20, not the aluminum track.
- **OBJ corpus is a side library.** `parseObjWeldment` is not an upload extension and is not a fallback inside `parseGlbWeldment`. Website SketchUp OBJs cannot become drafts without a new CLI.
- **No GLB fixture proof.** Tests assert that Inngest keeps the `glb` extension. Nothing feeds a real GLB buffer through `parseGlbWeldment` and asserts profile, long-point inches, scrap, and note text.
- **WooCommerce readiness is invisible on the airlock.** Flags stay false by design. Step 4 does not show image, SEO, `sync_to_woo`, or `channel_sync` absence. A designer can believe Release made the SKU sellable on the web.
- **`.skp` geometry remains unsolved on purpose.** Do not schedule a reader in these phases.

---

## Section 3: Phased Execution

Each phase is one fresh lock, at most 8 `allowed_files`, `expected_blast_radius` equal to the diff count below, one target test, then `qca.mjs`. Do not start the next phase in the same chat. Do not let a phase edit the parser and the iframe at once unless the packet says so.

Out of every phase: V8 bus, Woo order webhooks, `syncGhlOpportunity`, Python BOM rows, auto-Approve, auto-`sync_to_woo`, `.skp` mesh reading, and a rewrite of `/admin/factory-bom` into the funnel.

### Phase 1 — Intake accepts the heavy lane

**Intent:** `.blend` can be queued. `.glb` can be queued from the commerce vault. Geometry math is unchanged.

**Gaps closed:** upload gateway, both design dropzones, vault picker, env pointer for the converter.

**Expected blast radius:** 6

**Target files:**

- `src/app/admin/factory-bom/actions.ts` — allow `blend` in `requestCadUpload` only. Keep the size cap. Keep SKU stem rename rules.
- `src/app/admin/factory-bom/CadUploadDropzone.tsx`
- `src/app/embed/factory-bom/IntakeDropzone.tsx` — copy states `.blend` converts, then the GLB parser runs. `.skp` copy stays “thumbnail only.”
- `src/app/embed/admin/master-catalog/ecommerce/AssetVaultDropzone.tsx` — accept `.glb` and `.blend` beside `.dae` and `.skp`.
- `.env.example` — `CAD_CONVERT_URL=`
- `tests/cad-upload-pipeline.test.ts` — assert the extension gate function or the action’s pure check. Do not weaken the Inngest allow-list test.

**Target test:** `npx vitest run tests/cad-upload-pipeline.test.ts`

**Not in this phase:** `process-job.ts`, `app.py`, dossier schema.

### Phase 2 — Named GLB drafts match the Katana cut-card contract

**Intent:** A hygiene-pass GLB writes the same note and scrap contract the tablet already expects. Still named nodes only. Still no new routing.

**Gaps closed:** `scrap_factor` 1.08 on tube feet, `formatKatanaIngredientNote` on metal lines, a fixture test.

**Expected blast radius:** 3

**Target files:**

- `src/lib/cad-upload/process-job.ts` — metal `insertGeometryLine` only. Leave cushion, powder, and freight quantities on their current units.
- `tests/glb-weldment.test.ts` — new. Build a minimal GLB (or checked-in fixture) with one node named like `FRM-ALUM-2X2-72-90-90`. Assert profile `SQ2-16`, length 72 inches within tolerance, and that the note helper returns a cut card. Parser unit test can call `parseGlbWeldment` without Postgres.
- `src/lib/sketchup-cutlist/index.ts` — re-export `parseGlbWeldment` if the test imports from the barrel. Skip this file if the test imports the module path directly (blast 2).

**Target test:** `npx vitest run tests/glb-weldment.test.ts`

**Proof bar:** the fixture’s net feet are `lengthIn / 12` before scrap. Scrap stays on `scrap_factor`. Do not multiply quantity by 1.08.

### Phase 3 — Legacy meshes use edge length, not the family template

**Intent:** Unnamed 6-face sticks become reviewable draft lines. Fused blobs and non-prisms do not.

**Gaps closed:** AABB-on-rotated-tube, OBJ walker stranded from the product, fused-mesh silence.

**Expected blast radius:** 5

**Target files:**

- `src/lib/sketchup-cutlist/parse-glb-weldment.ts` — when a node is not structural by name, measure boundary edges with the same tolerances as `parse-obj-weldment.ts` (0.08 inch, 0.02 inch under 0.20 inch). Snap section through `profile-crosswalk.ts`. Long point and 45/90 ends come from `long-point.ts`. Named hygiene nodes keep their current path.
- `src/lib/obj-cutlist/parse-obj-weldment.ts` — extract the shared edge cluster helper if both parsers would copy it. If the helper does not fit the blast cap, call the existing OBJ functions on a tiny OBJ synthesized from the GLB primitive and do not duplicate the ruler.
- `src/lib/cad-upload/process-job.ts` — map `fused_mesh` and `non_prism` into `cad_uploads.error_message` with stable prefixes `FUSED_MESH:` and `NON_PRISM:`. Do not delete manager-sourced draft rows. Do not write a quantity for flagged groups.
- `tests/glb-weldment.test.ts` — add the rotated 2×2 case (long edges 29 and 25, miter face ~2.83). Expect 29 inch long point, ends 45/45, profile 2×2, miter face not a second profile.
- `tests/obj-cutlist.test.ts` — only if the shared helper’s signature changes. Do not loosen the club-chair 30.17 ft bar.

**Target test:** `npx vitest run tests/glb-weldment.test.ts tests/obj-cutlist.test.ts`

**Still refused:** splitting a fused solid in Blender. Those files stay `FUSED_MESH` for a person.

### Phase 4 — DAE stops impersonating the club chair

**Intent:** Unknown Collada files use the same pure rollup as Phase 3, or the critic refuses the draft. They never default to `instantiateBravadaClubChair`.

**Gaps closed:** two-family fallthrough.

**Expected blast radius:** 3

**Target files:**

- `src/lib/cad-upload/instantiate-from-dae.ts` — `buildPlan` returns a Waterfall or Bravada plan only when the walker hint matches that family. Every other file builds draft lines from `rollupTubes` / stick profiles with `source = sketchup_geometry`.
- `src/lib/sketchup-cutlist/family-templates.ts` — only if a shared rollup-to-plan helper must live beside the fixtures. Prefer keeping fixtures untouched.
- `tests/dae-weldment.test.ts` — Waterfall sample still selects the Waterfall plan. A stick set whose hint is `FIN-OTHER-CHA-01` must not emit `ASM-BRV-ARM` or the Bravada club-chair FIN.

**Target test:** `npx vitest run tests/dae-weldment.test.ts`

**Leave in place:** critic refusal, `runSecondaryExtract`, no live `product_bom` writes.

### Phase 5 — Geometry stamps the locked route, once

**Intent:** A draft-ready metal file gets the aluminum Standard Track from `KATANA_RESOURCES`. Cushion sequence 30 stays. The lone `FAB POD A` / 15 minute insert goes away.

**Gaps closed:** GLB has no metal routing; DAE routing is one cell.

**Expected blast radius:** 3

**Target files:**

- `src/lib/cad-upload/instantiate-from-dae.ts` — delete the sequence-20 `FAB POD A` insert.
- `src/lib/cad-upload/process-job.ts` — after a successful GLB or DAE draft write, call the existing `applyStandardTrack` for `aluminum_frame` when the draft has metal tube lines and no manager-edited operations. Skip work centers already `edited` or `source = manager`.
- `tests/cad-upload-pipeline.test.ts` or a focused `tests/cad-routing-stamp.test.ts` — assert the track resources are a subset of `KATANA_RESOURCES` and that a manager row at the same sequence is not overwritten.

**Target test:** `npx vitest run tests/cad-routing-stamp.test.ts`

**Constraint:** do not invent resource names. `Cushion Stuffing` may remain because it is already in `FABRIC_KATANA_RESOURCES`.

### Phase 6 — Converter contract matches what Node actually does

**Intent:** The Python service is a byte converter with an honest health check. Inch math and named-node refusal stay in Node (Phases 2–3).

**Gaps closed:** comment-shaped `trimesh` “inch check”; operators cannot tell a down converter from a bad mesh.

**Expected blast radius:** 3

**Target files:**

- `services/cad-convert/app.py` — keep `415` + `SKP_CONVERT_UNAVAILABLE` for `.skp`. Keep Blender export for `.blend`. Replace the inch comment with a load check: `trimesh.load` must return a scene that has at least one geometry. On failure, HTTP 500 with `GLB_LOAD_FAILED`. Do not emit cut lists, SKUs, or draft JSON.
- `services/cad-convert/export_blend.py` — only if a change is required to keep `bpy.context.window` untouched. Otherwise omit (blast 2).
- `tests/cad-convert-client.test.ts` — client still surfaces `SKP_CONVERT_UNAVAILABLE` and a non-200 body. No live Blender in vitest.

**Target test:** `npx vitest run tests/cad-convert-client.test.ts`

### Phase 7 — Readiness checklist on Release

**Intent:** Step 4 shows Katana publish mode and Woo non-readiness without changing either.

**Gaps closed:** silent `sync_to_woo = false`.

**Expected blast radius:** 4

**Target files:**

- `src/server/factory-bom/derive-readiness.ts` — add a pure `deriveCommerceReadiness` result: `katanaRecipe` (`dry_run` | `live_gate` | `not_approved`), `woo` always `held` when `sync_to_woo` is false, `image` (`present` | `missing`). No I/O.
- `src/server/factory-bom/load-airlock-snapshot.ts` — pass the flags and `CATALOG_PUBLISH_MODE` into the snapshot the wizard already loads.
- `src/app/embed/factory-bom/steps/Step4Release.tsx` — render the three lines. Release button behavior stays `evaluateAirlock` plus the existing publish and custom-job actions.
- `tests/derive-factory-readiness.test.ts` — `sync_to_woo: false` yields `woo: held`. A dry-run catalog mode yields `katanaRecipe: dry_run`.

**Target test:** `npx vitest run tests/derive-factory-readiness.test.ts`

**Forbidden in this phase:** setting `sync_to_woo`, inserting `channel_sync`, calling Woo.

### Phase 8 — Airlock certification pass

**Intent:** Prove the design embed still deep-links and that Phase 1’s empty state is a drop zone. No new product behavior.

**Expected blast radius:** 1

**Target files:**

- `tests/e2e/factory-bom-lifecycle.spec.ts` — only if an assertion still looks for the removed product `<select>` or the old “select a product” sentence. Existing `?sku=` cases stay.

**Target test:** `npm run test:e2e:factory-bom`

**Then, once, on the integration branch:** `npm run qa:lifecycle`. A green lifecycle run is the hub proof. It does not replace per-phase QCA.

---

## Suggested order

1. Phase 1 (designers can enqueue `.blend` and vault `.glb`)  
2. Phase 2 (named GLB is Katana-note safe)  
3. Phase 3 (legacy sticks)  
4. Phase 4 (DAE cannot borrow the club chair)  
5. Phase 5 (one route stamp)  
6. Phase 6 (converter honesty; can run any time after Phase 1)  
7. Phase 7 (readiness copy)  
8. Phase 8 (Playwright)

Phases 6 and 7 do not depend on Phase 3. Do not merge them into Phase 3’s lock.

## Finish line

The workspace is finished when all of the following are true:

- A named `.glb`, a non-family `.dae`, and a `.blend` that becomes `.glb` each produce `product_bom_draft` rows with tube `scrap_factor` 1.08 and a Katana cut-card note, or a stable `GEOM_HYGIENE` / `FUSED_MESH` / `NON_PRISM` / `SKP_CONVERT_UNAVAILABLE` error.
- Draft metal routing is the aluminum Standard Track and does not overwrite manager edits.
- Release still requires a human. Woo and Clover flags are still false. Step 4 says so.
- `.skp` still does not become a cut list.
- Each phase’s QCA JSON is `CERTIFIED` (exit 0), and `npm run qa:lifecycle` exits 0 on the branch that contains them.
