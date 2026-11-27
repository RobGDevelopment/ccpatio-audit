/**
 * Phase intake-split-studio-realtime-crop — split studio, cloud crop, non-black QA.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCloudCropPathIsPortable,
  cacheBustHasSha8,
} from "@/server/ecommerce/apply-intake-crop";
import {
  clampCropBox,
  cropBoxToCssPercent,
  displayNamePlaceholderForMaterial,
  titleCaseStorefront,
} from "@/lib/intake-crop-math";
import {
  assertNonBlackSwatch,
  listRawStudioPhotos,
  STAGING_ROOT,
} from "../scripts/ops/lib/swatch-cv-pipeline";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("intake-split-studio-realtime-crop", () => {
  it("lists exactly 27 raw studio photos under external staging", async () => {
    const photos = await listRawStudioPhotos();
    expect(photos).toHaveLength(27);
    expect(photos.filter((p) => p.categoryFolder === "Fabrics")).toHaveLength(16);
    expect(photos.filter((p) => p.categoryFolder === "Dekton")).toHaveLength(6);
    expect(photos.filter((p) => p.categoryFolder === "PowderCoat")).toHaveLength(5);
    expect(STAGING_ROOT).toContain("ccpatio-media-staging");
    for (const key of [
      "PV205012",
      "PV205022",
      "PV205027",
      "PV205034",
      "PV205037",
      "PV205099",
      "PV104825 copy",
    ]) {
      expect(photos.some((p) => p.relative.includes(key))).toBe(true);
    }
  });

  it("assertNonBlackSwatch rejects solid-black tiles and accepts bright tiles", () => {
    const size = 64;
    const black = Buffer.alloc(size * size * 3, 5);
    const bright = Buffer.alloc(size * size * 3, 180);
    expect(assertNonBlackSwatch(black, size).ok).toBe(false);
    expect(assertNonBlackSwatch(bright, size).ok).toBe(true);
    // Striped: dark border allowed
    const striped = Buffer.from(bright);
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) striped[x * 3 + c] = 4;
    }
    expect(assertNonBlackSwatch(striped, size, { striped: true }).ok).toBe(true);
  });

  it("zero-letterbox CSS percent math stays pixel-square on 3:2 masters", () => {
    const sourceWidth = 2800;
    const sourceHeight = 1867;
    const crop = clampCropBox({ cropX: 400, cropY: 200, cropSidePx: 1200 }, sourceWidth, sourceHeight);
    const pct = cropBoxToCssPercent({ ...crop, sourceWidth, sourceHeight });
    expect((pct.width / 100) * sourceWidth).toBeCloseTo(crop.cropSidePx, 5);
    expect((pct.height / 100) * sourceHeight).toBeCloseTo(crop.cropSidePx, 5);
  });

  it("category-aware display name placeholders never use Canvas Ivory on Dekton/Powder", () => {
    expect(displayNamePlaceholderForMaterial("sunbrella")).toContain("Cabana");
    expect(displayNamePlaceholderForMaterial("ultraleather")).toContain("Beacon");
    expect(displayNamePlaceholderForMaterial("dekton")).toContain("Aura");
    expect(displayNamePlaceholderForMaterial("powder")).toContain("Gray");
    expect(displayNamePlaceholderForMaterial("dekton")).not.toMatch(/Canvas Ivory/i);
    expect(displayNamePlaceholderForMaterial("powder")).not.toMatch(/Canvas Ivory/i);
    expect(titleCaseStorefront("aura 15")).toBe("Aura 15");
  });

  it("cloud Apply Crop path is portable (no C:\\Workspace staging dependency)", () => {
    expect(assertCloudCropPathIsPortable(null)).toBe(true);
    expect(assertCloudCropPathIsPortable("C:\\Workspace\\ccpatio-media-staging\\x.jpg")).toBe(false);
    expect(
      assertCloudCropPathIsPortable(
        "https://xyz.supabase.co/storage/v1/object/public/product-images/intake/raw/Fabrics/x-orig.jpg",
      ),
    ).toBe(true);
    expect(
      cacheBustHasSha8(
        "https://xyz.supabase.co/storage/v1/object/public/product-images/intake/crops/a/a-2048.jpg?v=deadbeef",
      ),
    ).toBe(true);
  });

  it("seed script bakes 2800px EXIF masters and preserves Mia display_name", () => {
    const seed = read("scripts/ops/seed-intake-photoshoot.ts");
    expect(seed).toMatch(/MASTER_MAX_EDGE\s*=\s*2800/);
    expect(seed).toMatch(/chromaSubsampling:\s*[\"']4:4:4[\"']/);
    expect(seed).toMatch(/cacheControl:\s*[\"']31536000[\"']/);
    expect(seed).toMatch(/hasMiaName/);
    expect(seed).toMatch(/mayRefreshCrops/);
    expect(seed).toMatch(/refineCropOnMaster/);
    expect(seed).not.toMatch(/resize\(\{\s*width:\s*1400/);
  });

  it("intake-crop API route authenticates and uses cloud apply helper", () => {
    const route = read("src/app/api/ecommerce/intake-crop/route.ts");
    expect(route).toMatch(/authenticateAssetStudioRequest/);
    expect(route).toMatch(/applyIntakeCropFromCloud/);
    expect(route).toMatch(/maxDuration/);
    const helper = read("src/server/ecommerce/apply-intake-crop.ts");
    expect(helper).toMatch(/PRODUCT_IMAGES_BUCKET/);
    expect(helper).toMatch(/\.download\(/);
    expect(helper).toMatch(/NODE_ENV !== ["']production["']/);
    expect(helper).toMatch(/ccpatio-media-staging/);
  });

  it("IntakeMediaStudio is a split-screen studio with live canvas + form contracts", () => {
    const studio = read(
      "src/app/embed/admin/master-catalog/ecommerce/IntakeMediaStudio.tsx",
    );
    expect(studio).toMatch(/data-testid=["']intake-split-studio["']/);
    expect(studio).toMatch(/data-testid=["']intake-filmstrip["']/);
    expect(studio).toMatch(/data-testid=["']intake-live-canvas-strip["']/);
    expect(studio).toMatch(/testId=["']intake-canvas-512["']/);
    expect(studio).toMatch(/testId=["']intake-canvas-loupe["']/);
    expect(studio).toMatch(/testId=["']intake-canvas-tile["']/);
    expect(studio).toMatch(/data-testid=["']intake-upload-dropzone["']/);
    expect(studio).toMatch(/data-testid=["']intake-material-description["']/);
    expect(studio).toMatch(/data-testid=["']intake-repeat-w["']/);
    expect(studio).toMatch(/data-testid=["']intake-repeat-h["']/);
    expect(studio).toMatch(/\/api\/ecommerce\/intake-crop/);
    expect(studio).toMatch(/Cropping 2048px/);
    expect(studio).toMatch(/Applied 2048×2048 square crop/);
    expect(studio).not.toMatch(/data-testid=["']intake-card-list["']/);
  });

  it("IntakeCropOverlay uses tight inline-block img (zero object-contain letterbox)", () => {
    const overlay = read(
      "src/app/embed/admin/master-catalog/ecommerce/IntakeCropOverlay.tsx",
    );
    expect(overlay).toMatch(/inline-block/);
    expect(overlay).toMatch(/max-h-\[38dvh\]/);
    expect(overlay).not.toMatch(/object-contain/);
    expect(overlay).toMatch(/data-corner=\{corner\}/);
    expect(overlay).toMatch(/"nw"/);
    expect(overlay).toMatch(/"se"/);
  });

  it("reCropFinishFromBuffer wires illumination postprocess (plane/gaussian)", () => {
    const finish = read("src/server/ecommerce/finish-intake.ts");
    expect(finish).toMatch(/postprocessCroppedRgb/);
    const post = read("src/server/ecommerce/swatch-postprocess.ts");
    expect(post).toMatch(/flattenIllumination/);
    expect(post).toMatch(/finalizeSeamlessTexture/);
    expect(post).toMatch(/dekton/);
  });
});
