# After Action Report — Stage 1 R3F Sandbox Bootstrap

**Date:** 2026-08-30  
**Scope:** Isolated `3d-sandbox/` Next.js app, R3F dependencies, hero GLB transfer, gltfjsx translation

---

## 1. Sandbox creation and dependencies

A fresh Next.js 16 app was scaffolded at [`3d-sandbox/`](3d-sandbox/) with:

- TypeScript, Tailwind CSS, ESLint, App Router, `--src-dir`, `@/*` import alias

**Note:** A prior partial sandbox (`webgl-client/`, `textures/`, `tools/`) existed under `3d-sandbox/`. It was archived to [`3d-sandbox/_legacy/`](3d-sandbox/_legacy/) so `create-next-app` could run cleanly. Canvas micro-textures were restored from `_legacy/textures/` into `public/textures/`.

### Installed packages

| Package | Purpose |
|---|---|
| `three` | Core WebGL engine |
| `@react-three/fiber` | React renderer |
| `@react-three/drei` | `useGLTF`, helpers |
| `@react-three/postprocessing` | Outline pass (Stage 4) |
| `zustand` | Configurator state (Stage 4) |
| `three-stdlib` | `DRACOLoader`, GLTF types |
| `@types/three` (dev) | TypeScript definitions |

TypeScript check: `npx tsc --noEmit` passes.

---

## 2. Asset architecture

```
3d-sandbox/public/
├── models/
│   ├── lowback-chair.glb              (source, 3.27 MB)
│   └── lowback-chair-transformed.glb  (Draco + optimized, 131.9 KB)
├── textures/
│   ├── canvas_normal.jpg
│   └── canvas_roughness.jpg
└── draco/
    ├── draco_decoder.js
    ├── draco_decoder.wasm
    └── draco_wasm_wrapper.js
```

Hero GLB copied from `Blender/dist/hero/lowback-chair.glb` (Stage 0 output).

---

## 3. gltfjsx translation

**Command executed:**

```bash
npx gltfjsx public/models/lowback-chair.glb --transform --keepnames --keepmeshes --types -o src/components/canvas/LowbackChairModel.tsx
```

### Critical adaptation: `--keepmeshes`

The first run used `--transform` only. gltf-transform **joined all three meshes into one**, producing a component with only `nodes.Mesh_Frame`. Re-running with **`--keepmeshes` (`-j`)** preserved all semantic parts.

### Compression result

| File | Size | Reduction |
|---|---|---|
| `lowback-chair.glb` (original) | **3,274,652 bytes** (3.12 MB) | — |
| `lowback-chair-transformed.glb` | **131,892 bytes** (128.8 KB) | **~96%** |

Transformed GLB was moved to `public/models/` (gltfjsx default output path is beside the `.tsx` file).

---

## 4. LowbackChairModel.tsx verification

Generated component: [`3d-sandbox/src/components/canvas/LowbackChairModel.tsx`](3d-sandbox/src/components/canvas/LowbackChairModel.tsx)

**Confirmed node references:**

- `nodes.Mesh_Frame` — frame mesh geometry + material
- `nodes.Mesh_Seat` — seat cushion geometry + material
- `nodes.Mesh_Pillow` — pillow geometry + material

**Draco loader:** configured via `DRACOLoader` + `useGLTF.preload(MODEL_PATH, true, false, configureDracoLoader)` pointing at `/draco/`.

**Model path:** `useGLTF` loads `/models/lowback-chair-transformed.glb`.

**GLB node audit (transformed file):**

```
nodes: ['Mesh_Frame', 'Mesh_Seat', 'Mesh_Pillow']
meshes: 3
```

---

## 5. Run the sandbox

```bash
cd 3d-sandbox
npm run dev
```

**Next step (Stage 4):** `useConfiguratorStore.ts`, sidebar swatches, `ConfiguratorStage` with `<Selection>` / `<Outline>`, and material injection into the three mesh slots.
