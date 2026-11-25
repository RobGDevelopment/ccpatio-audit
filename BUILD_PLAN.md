# BUILD_PLAN — `highrez-swatch-crop-match-upload`

**Base:** `HEAD` (`43273c8`)  
**Mode:** edit (Track 2 locked)  
**Blast cap override:** true  
**Expected blast radius:** 9 (QCA excludes `.cursor/aar.json`)

## Intent

32-finish local image pipeline: tape-measure scale calibration, safe-square crop /
deskew, illumination flattening, match 26 unique studio photos + synthesize 6 clean
fallbacks, QA contact sheet + editable `manifest.json`, and a gated Supabase uploader
defaulting to `--dry-run`. Keep ALL raw inputs and generated media strictly outside
the git repo under `C:\Workspace\ccpatio-media-staging\`. Do **not** flip any
`*_MODE` or `DOWNSTREAM_MUTATIONS` flags.

## Workstreams

1. **`finishes:process`** — `scripts/ops/process-highrez-finishes.ts` (+ OpenCV/PIL
   helper `scripts/ops/process-highrez-finishes-cv.py`): read
   `HighRezImages/{Dekton,Fabrics,PowderCoat}`, calibrate `pixels_per_inch` from
   yellow tape, safe interior square crop (8–10% inset), deskew, flatten lighting,
   write `processed/textures/{sku}.jpg` (2048) + `processed/thumbs/{sku}.jpg` (512),
   match 26 unique studio shots to the canonical 32 roster, synthesize 6 fallbacks,
   emit `processed/manifest.json` + `processed/qa-contact-sheet.html`.
2. **`finishes:upload`** — `scripts/ops/upload-highrez-finishes.ts`: default `--dry-run`
   validates 32/32 + dimensions + SKUs; `--apply` uploads to Supabase
   `finishes/{sku}/...` and persists public URLs + `repeat_inches` / `texture_scale`.
3. **Additive helpers** — `src/server/assets/finish-assets.ts` only if needed for
   `repeat_inches` / `texture_scale` metadata mapping (no schema drops).
4. **Vitest** — `tests/highrez-swatch-pipeline.test.ts`.

## Allowed files

1. `.cursor/phase.lock`
2. `.cursor/session-stamp.json`
3. `.cursor/aar.json`
4. `BUILD_PLAN.md`
5. `scripts/ops/process-highrez-finishes.ts`
6. `scripts/ops/process-highrez-finishes-cv.py`
7. `scripts/ops/upload-highrez-finishes.ts`
8. `src/server/assets/finish-assets.ts`
9. `package.json`
10. `tests/highrez-swatch-pipeline.test.ts`

## Target test

```bash
npx vitest run tests/highrez-swatch-pipeline.test.ts
```

## Commands

```bash
npm run finishes:process
npm run finishes:upload -- --dry-run
```
