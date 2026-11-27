# BUILD_PLAN — `intake-split-studio-realtime-crop`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 15 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/intake-split-studio-realtime-crop.test.ts`

## Intent

Replace Tab 1's 40,000px vertical photoshoot card stack with a single-viewport **Master-Detail Split Studio**, fix the letterbox crop-math bug that produced black squares, repair all **27** cloud raw masters (`2800px` EXIF-baked) + uncustomized auto-crops, and make **Apply Crop** a cloud-backed Vercel API (`/api/ecommerce/intake-crop`) with live 60fps `<canvas>` previews — zero `C:\Workspace` runtime dependency on production.

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `package.json`, `scripts/`, `src/db/`, `src/app/embed/`, `src/app/api/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Live production guardrails

| Guard | Rule |
|-------|------|
| Mia custom edits | **NEVER** overwrite `finish_intake` rows Mia promoted/certified or manually named; **NEVER** overwrite Mia-customized `display_name` in `ecommerce_finishes` / `master_catalog` |
| Repair scope | Only repair broken `raw_reference_url`s and broken **uncustomized** auto-crops on pending rows |
| Outbound modes | Do **not** touch `.env*`; leave `DOWNSTREAM_MUTATIONS=false` and all `*_LEDGER_MODE=log` |
| Local staging | Raw photos stay in `C:\Workspace\ccpatio-media-staging\HighRezImages\` (outside git) |
| Schema | Additive DDL only (`ADD COLUMN IF NOT EXISTS`); no drops/wipes |
| Tests | Isolated fixtures / `QA-TEST-*` only |

## Workstreams

### 1. Repair All 27 Cloud Raw Masters (`2800px` EXIF-Baked) & Uncustomized Auto-Crops

**Files (expected):**  
`scripts/ops/seed-intake-photoshoot.ts`, `scripts/ops/lib/swatch-cv-pipeline.ts`, optionally `scripts/ops/lib/swatch-pixel-qa.ts`

- Bake EXIF `.rotate()` into high-res cloud masters (`max 2800px` longest edge, JPEG q92, `4:4:4`), upload with `upsert: true` + `cacheControl: '31536000'`, append `?v=<sha8>` to `raw_reference_url`.
- Normalize storage keys to safe slugs (spaces like `PV104825 copy.jpg` → `dekton-pv104825-copy-orig.jpg`).
- Store post-EXIF `source_width` / `source_height` of the uploaded cloud master.
- Re-run hardware-safe interior square detection; assert non-black (`mean L* > 22`, `< 0.5%` dark `L* < 14` border pixels).
- Upload fresh `2048×2048` + `512×512` only for **uncustomized pending** rows; preserve Mia `display_name` / `certified` status.
- Verify **27/27** `raw_reference_url` HTTP 200. Ensure Storage CORS allows `<img crossOrigin="anonymous">` (graceful CSS fallback if not).

### 2. Cloud-Backed Vercel `Apply Crop` (`/api/ecommerce/intake-crop`)

**Files (expected):**  
`src/app/api/ecommerce/intake-crop/route.ts`, `src/server/ecommerce/finish-intake.ts`, `src/app/embed/admin/master-catalog/actions.ts`, `IntakeMediaStudio.tsx`

- Authenticate via `authenticateAssetStudioRequest` (embedToken header + session cookies; partner `token` optional).
- Fetch high-res `raw_reference_url` from Supabase (`fetch` / `storage.download`); local `C:\Workspace\...` only as optional **dev** fallback.
- Map `{ cropX, cropY, cropSidePx }` in source pixels → `sharp.extract` → illumination flatten (plane for Dekton; Gaussian + optional seamless wrap for non-striped; **never** cross-blend stripes) → `2048` q92 + `512` q90.
- Upload upsert + `?v=<new_sha8>`; persist crop + URLs; return updated record JSON.
- UI: disabled `Cropping 2048px…` state, filmstrip thumb refresh, clear unsaved badge, toast `Applied 2048×2048 square crop ✓`. Auto-invoke on **Approve & Promote** when crop is dirty.

### 3. Single-Viewport Split-Screen Studio + Zero-Letterbox 60fps Canvas Cropper

**Files (expected):**  
`IntakeMediaStudio.tsx`, `IntakeCropOverlay.tsx`, `src/lib/intake-crop-math.ts`, portal wiring in `EcommerceCertificationPortal.tsx` / `actions.ts` as needed

- Top bar: sub-queue pills + category filter + `+ Upload New Media` + collapsible multi-file signed dropzone (`intake-upload-sign` / `commit`, Web Crypto SHA-256, progress).
- `lg:grid-cols-[270px_minmax(0,1fr)_380px]` contained in viewport:
  - **Left filmstrip** (`#1`–`#27`, 44×44 thumb, folder badge, name/status, Prev/Next + Alt+Arrow).
  - **Center:** tight `inline-block` `<img>` wrapper (zero `object-contain` letterbox); 1:1 pixel-square overlay with drag + 4 corner handles; live `<canvas>` strip (`512 SWATCH`, `2048 LOUPE`, `3×3 TILE`) via `requestAnimationFrame`.
  - **Right:** Material Class (category-aware Display Name placeholders — never `"Canvas Ivory"` on Dekton/Powder), Display Name, Vendor SKU, **Material Description / Grade**, Pattern Mode + conditional **Repeat W/H**, interactive Katana/Hub SKU combobox, Apply Crop + Approve & Promote (auto-select next Pending).
- Mode B (`Products Needing Media / Dims`) reuses the same split layout.

### 4. Automated Verification + QCA

**Files (expected):**  
`tests/intake-split-studio-realtime-crop.test.ts`, `tests/e2e/intake-split-studio-realtime-crop.spec.ts` (or under `e2e/`), `.cursor/phase.lock` blast sync

1. Vitest proves 27 cloud masters HTTP 200 / dims / non-black crops (or static + pipeline assertions when live DB gated), split-studio markup contracts, crop API cloud-only path, canvas/CSS math, category placeholders, striped Repeat inputs.
2. `npx vitest run tests/intake-split-studio-realtime-crop.test.ts` → PASS.
3. `npm run qa:lifecycle` → `exit_code: 0`.
4. Sync `expected_blast_radius` (`tolerance: 0`, excluding `.cursor/aar.json`).
5. `emit.mjs` + `qca.mjs` → **CERTIFIED** (`audit_exit: 0`); paste verbatim QCA JSON.

## Acceptance criteria

- Tab 1 is a zero-page-scroll split studio (no 27-card vertical stack).
- Apply Crop works on Vercel via cloud `raw_reference_url` (no Windows path reads).
- Crop overlay percentages match painted bitmap (no letterbox black-square crops).
- All 27 raw references load; uncustomized pending auto-crops pass non-black QA.
- Material Description, striped Repeat W/H, category placeholders, and SKU combobox are present.
- Mia certified / customized names are never overwritten.
- Target Vitest + `qa:lifecycle` green; QCA `CERTIFIED`.
