# BUILD_PLAN — `swatch-cv-recrop-scale-lightbox`

**Base:** `HEAD`  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 18 (QCA excludes `.cursor/aar.json`; `tolerance: 0`)  
**Target test:** `npx vitest run tests/swatch-cv-quality-and-lightbox.test.ts`

## Intent

Re-architect the 32-finish CV crop / illumination / seamless-tile pipeline with automated border QA gates, fix Cabana Classic stripe matching and uniform 3D UV texture scales, re-upload cache-busted `2048×2048` & `512×512` square assets to Supabase, and rebuild the 1:1 Square Lightbox + Current Inventory preview.

Do **not** flip any `*_MODE` or `DOWNSTREAM_MUTATIONS` flags (`log` / `false`). Keep all staging media in `C:\Workspace\ccpatio-media-staging\` (outside git).

## Allowed paths (phase.lock)

`.cursor/phase.lock`, `.cursor/session-stamp.json`, `.cursor/aar.json`, `BUILD_PLAN.md`, `scripts/`, `src/app/embed/`, `src/app/api/`, `src/app/partner/primeview-handoff/`, `src/components/`, `src/lib/`, `src/server/`, `tests/`, `e2e/`

## Workstreams

### 1. Exact CV Interior Safe-Square & Illumination Pipeline

**Files:** `scripts/ops/`, `scripts/ops/lib/`

- Re-engineer processor with `sharp` EXIF `.rotate()` + raw RGB float/uint8 buffers.
- **1A** Working `600px` grid: CIE `L*a*b*` + Sobel `G`; tape / ruler / SKU-tag mask dilated `6%` width.
- **1B** Adaptive studio backdrop + frayed-edge flood exclusion (deltaE core vs bg branches for light vs dark finishes); morphological erode `8%` of `min(W,H)`.
- **1C** DP largest inscribed axis-aligned square; pick side `≥ 0.90 * maxDp` nearest valid centroid; inset extra `6%` safety; map to full-res.
- **1D** Extract `1.12×` side when margin permits; lanczos3 resize; illumination flatten (Gaussian `σ=size/6` for fabric/leather/powder; linear plane `σ=size/2` for veined Dekton); variance-preserving `10%` raised-cosine toroidal wrap for non-Dekton; emit full-bleed `texture-2048.jpg` (q92, 4:4:4) + `swatch-512.jpg` (q90).

### 2. Cabana Classic Fix, 32-SKU Match Audit & Uniform UV Scales

**Files:** `scripts/ops/`, `src/server/assets/`, `src/server/ecommerce/`

- Bimodal stripe scan (`L_p90 − L_p10 > 45` + periodic projection peaks). Never bind `FAB-CAB-CLA` to `PV205084.JPG` / solid grey.
- If no true B&W cabana photo exists, synthesize high-realism woven `2048×2048` Cabana Classic (`#18191B` / `#F2F1EC`, 2× `7.0"` vertical repeats) and reassign `PV205084` to its true grey Sunbrella SKU; write `match-audit.json` + regenerate `qa-contact-sheet.html`.
- Replace noisy detector floats with family-uniform physical calibration:
  - Canvas solids ×4 → `texture_scale=8`, `repeat_w/h=8`, `pattern_repeat=0`
  - Cabana → `7` / `7` / `pattern_repeat_in=7`
  - Remaining Sunbrella weaves ×11 → `8`
  - Ultraleather ×4 → `6`
  - Dekton ×6 → `24`
  - Powder ×6 → `4`

### 3. Pixel Border QA Gate + Cache-Busted Supabase Re-Upload

**Files:** `scripts/ops/`, `src/server/`, `tests/`

- Automated Pixel QA Verifier (pipeline + Vitest): exact dims; `<0.3%` dark `L*<16` in outer `4%` strips for non-dark SKUs; wrap-edge mean RGB delta `<8` + border-vs-center `deltaE<5.5` for solid/textured fabric/leather/powder; `FAB-CAB-CLA` bimodal `L_p90>75` & `L_p10<25`.
- `npm run finishes:upload -- --apply` with `upsert: true` and URLs persisted as `...?v=<sha256[0:8]>` on ecommerce finishes **and** matching FAB/DKT showroom inventory image rows.

### 4. Full-Bleed Thumbnails, Dark Upload Buttons, 1:1 Lightbox & Showroom Click

**Files:** `src/app/embed/`, `src/app/showroom/`, `src/components/`

- Tab 1 cells: `w-12 h-12 min-w-12 aspect-square rounded-md overflow-hidden p-0 border border-slate-700` + `object-cover` img.
- Dark slate/amber `↑ Swatch` / `↑ 2048px` (no stark `bg-white`).
- Lightbox: `max-h-[calc(100dvh-2rem)]` modal; exact 1:1 stage `aspect-square w-[min(72dvh,620px)]`; Fit / 1:1 pan (`onPointer*`) / 3×3 tile; `← Prev` / `Next →` + Arrow/Escape keys; clean scale metadata; inline Replace upload.
- `/embed/showroom`: populated photos open Lightbox (Replace inside modal); empty placeholders only open Add photo.

### 5. Verification

**Files:** `tests/`, `e2e/`, `.cursor/aar.json`, `.cursor/phase.lock`

- `tests/swatch-cv-quality-and-lightbox.test.ts` (+ Playwright) prove Pixel QA, uniform scales, `?v=` URLs, lightbox geometry/nav/modes, dark Tab 1 buttons, showroom click→Lightbox.
- `npm run qa:lifecycle` → exit 0.
- Sync `expected_blast_radius` (tolerance 0, exclude `.cursor/aar.json`); `emit.mjs`; `qca.mjs` → `CERTIFIED` (`audit_exit: 0`).

## Guardrails

- Keep outbound `*_MODE` / `DOWNSTREAM_MUTATIONS` at `log` / `false`.
- Staging media stays outside git (`ccpatio-media-staging`).
- No `drizzle-kit push`, no table drops, additive schema only if needed.
- Never delete a paid order; ledger failures retry, not rollback.
