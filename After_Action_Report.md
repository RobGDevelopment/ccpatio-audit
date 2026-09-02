# After Action Report — Stage 0 Hero Split

**Script:** [`scripts/prepare_hero_chair.py`](scripts/prepare_hero_chair.py)  
**Blender:** 5.1.2  
**Target:** `C-Ledge Lounger Signature Lowback Chair` → mesh `G-Object.10360`  
**Date:** 2026-08-30

---

## Execution summary

Stage 0 completed successfully. The acceptance gate **passed**.

| Output | Path | Size |
|---|---|---|
| Hero blend | `Blender/dist/hero/lowback-chair.blend` | Self-contained mainfile (not library dump) |
| Hero GLB | `Blender/dist/hero/lowback-chair.glb` | > 50 KB (multi-mesh) |

---

## What the script did

1. **Target acquisition** — Found empty root `C-Ledge Lounger Signature Lowback Chair` with child mesh `G-Object.10360` (42,867 faces, single material `[Color M00]1`).

2. **Native separation attempts** — Both failed as expected on this asset:
   - `separate(type='MATERIAL')` → 1 material slot only
   - `separate(type='LOOSE')` → 1 connected shell only

3. **Semantic heuristic split** — Face classification by **world-space normal + relative height**:
   - **Mesh_Frame** — side / structural faces and lower body (31,582 faces)
   - **Mesh_Seat** — upward-facing mid-body cushion (9,449 faces)
   - **Mesh_Pillow** — upper back cushion region (1,836 faces)

4. **Normalization** — Combined AABB centered on X/Y; bottom Z set to floor; transforms applied.

5. **Export** — `bpy.ops.wm.save_as_mainfile()` + glTF with `use_active_scene=True`, `use_selection=False`.

---

## Acceptance gate verification

```
nodes: ['Mesh_Frame', 'Mesh_Seat', 'Mesh_Pillow']
meshes: 3
Acceptance gate: PASSED
```

The GLB contains **three distinct named mesh nodes**, not a monolithic stub.

---

## Caveats for Stage 1 (gltfjsx)

- Split is **algorithmic**, not SketchUp semantic layers. Visual QA in a viewer is recommended before locking swatch-to-part mappings.
- Pillow geometry is the smallest part (1,836 faces). If it looks wrong in the viewer, tune thresholds in `categorize_face()` in the script.
- Hero assets live under `Blender/dist/hero/` — separate from the bulk 834-file catalog exports.

---

## How to re-run

```text
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b "C:\Workspace\ccpatio-audit\Blender\MasterCatalog.blend" --python "C:\Workspace\ccpatio-audit\scripts\prepare_hero_chair.py"
```

**Next step:** Stage 2 — bootstrap `3d-sandbox/`, copy `lowback-chair.glb` to `public/models/`, run `gltfjsx --transform --keepnames`.

---

# After Action Report — Bravada Swivel Chair Pipeline

**Script:** [`scripts/prepare_bravada_chair.py`](scripts/prepare_bravada_chair.py)  
**Blender:** 5.1.2  
**Date:** 2026-08-30

## Catalog search result

Dynamic search for objects whose name contains **both** `Bravada` and `Swivel` (case-insensitive) returned **zero matches** in `MasterCatalog.blend`.

Available Bravada meshes are 2D catalog layout items only (zero height):

| Object | Faces |
|---|---|
| `C-bravada chaises` | 995 |
| `C-BRAVADA COFFE TA` | 1,629 |
| `C-bravada collecti#2` | 1,186 |
| `C-BRAVADA OTTOMAN` | 1,393 |

**Resolved target (fallback proxy):** `C-MOON CHAIR.dwg` — nearest 3D chair asset in the master catalog (23,994 faces, ~0.64 m height, 3 material slots). PIM SKU `FIN-BRV-SWV-CHA-34X34` (`BRAVADA SWIVEL CHAIR 34`) exists in spreadsheet seed data but has **no corresponding 3D object** in the blend file yet.

## Extraction summary

| Step | Result |
|---|---|
| Native MATERIAL split | 2 parts — roles incomplete (pillow + frame, no seat) |
| Semantic heuristic split | **Used** — Frame 19,852 / Seat 1,718 / Pillow 2,424 faces |
| Acceptance gate | **PASSED** |

| Output | Path | Size |
|---|---|---|
| Hero blend | `Blender/dist/hero/bravada-swivel.blend` | Self-contained mainfile |
| Hero GLB (raw) | `Blender/dist/hero/bravada-swivel.glb` | 2,024,700 bytes |
| Draco GLB (gltfjsx) | `3d-sandbox/public/models/bravada-swivel-transformed.glb` | **131,124 bytes** |

## R3F sandbox

- `gltfjsx --transform --keepnames --keepmeshes --types` → `BravadaChairModel.tsx`
- Wired dynamic Sunbrella materials, micro-textures (8×8 tile), and `<Select>` hover outlines (same pattern as `LowbackChairModel`)
- `ConfiguratorStage.tsx` now renders `<BravadaChairModel />`
- `npx tsc --noEmit` and `npm run build` both **pass**

## Re-run

```text
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b "C:\Workspace\ccpatio-audit\Blender\MasterCatalog.blend" --python "C:\Workspace\ccpatio-audit\scripts\prepare_bravada_chair.py"
```

## Follow-up

Import or name a true `C-Bravada Swivel Chair` empty + mesh in `MasterCatalog.blend` so the primary search path resolves without fallback. Until then, the pipeline mechanics (dynamic search → semantic split → gltfjsx → R3F configurator) are validated on the Moon Chair proxy.
