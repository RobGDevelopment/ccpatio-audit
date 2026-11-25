import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ECOMMERCE_32_FINISHES,
  assertExact32Roster,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import {
  finishThumbObjectPath,
  finishTextureObjectPath,
} from "@/server/assets/finish-assets";
import {
  CANVAS_SOLID_SKUS,
  deriveFinishPhysicalScale,
  formatFinishRepeatScaleLabel,
  uniformFinishPhysicalScale,
  withCacheBustQuery,
} from "@/lib/finish-physical-scale";
import { validateManifest } from "../scripts/ops/upload-highrez-finishes";
import { verifyAllProcessed } from "../scripts/ops/lib/swatch-pixel-qa";
import { seamlessToroidalWrap, synthesizeCabanaClassic } from "../scripts/ops/lib/swatch-cv-pipeline";

const STAGING = "C:\\Workspace\\ccpatio-media-staging";
const MANIFEST = path.join(STAGING, "processed", "manifest.json");
const MATCH_AUDIT = path.join(STAGING, "processed", "match-audit.json");

describe("swatch-cv-quality-and-lightbox", () => {
  it("keeps exact 32 roster + uniform family texture scales", () => {
    assertExact32Roster();
    for (const sku of CANVAS_SOLID_SKUS) {
      expect(uniformFinishPhysicalScale(sku).texture_scale).toBe(8);
    }
    expect(uniformFinishPhysicalScale("FAB-CAB-CLA").texture_scale).toBe(7);
    expect(uniformFinishPhysicalScale("FAB-SHE-LIN").texture_scale).toBe(8);
    expect(uniformFinishPhysicalScale("FAB-BEA-ULT").texture_scale).toBe(6);
    expect(uniformFinishPhysicalScale("DKT-AURA").texture_scale).toBe(24);
    expect(uniformFinishPhysicalScale("PWD-BONE").texture_scale).toBe(4);
    expect(uniformFinishPhysicalScale("PWD-OIL-RUB-BRONZE").texture_scale).toBe(4);

    const cabana = deriveFinishPhysicalScale({
      croppedWidthIn: 16.476,
      sku: "FAB-CAB-CLA",
      patternRepeatIn: { w: 7, h: 7 },
    });
    expect(cabana.texture_scale).toBe(7);
    expect(cabana.sample_width_in).toBe(7);

    const henna = deriveFinishPhysicalScale({ croppedWidthIn: 16.476, sku: "FAB-CAN-HEN" });
    const white = deriveFinishPhysicalScale({ croppedWidthIn: 5.134, sku: "FAB-CAN-WHI" });
    expect(henna.texture_scale).toBe(8);
    expect(white.texture_scale).toBe(8);
  });

  it("formats lightbox scale labels without 0×0 · 7 confusion", () => {
    expect(formatFinishRepeatScaleLabel({ sku: "FAB-CAB-CLA" })).toBe('Stripe Repeat: 7"');
    expect(formatFinishRepeatScaleLabel({ sku: "FAB-CAN-WHI" })).toBe('Tile: 8" × 8" · Scale: 8');
    expect(formatFinishRepeatScaleLabel({ sku: "DKT-ALDEM" })).toBe('Tile: 24" × 24" · Scale: 24');
  });

  it("maps storage paths to texture-2048.jpg + swatch-512.jpg", () => {
    expect(finishTextureObjectPath("FAB-CAB-CLA")).toBe("finishes/FAB-CAB-CLA/texture-2048.jpg");
    expect(finishThumbObjectPath("FAB-CAB-CLA")).toBe("finishes/FAB-CAB-CLA/swatch-512.jpg");
    expect(withCacheBustQuery("https://x/y/texture-2048.jpg", "abcdef0123456789")).toBe(
      "https://x/y/texture-2048.jpg?v=abcdef01",
    );
  });

  it("ships dark DropButton + 1:1 lightbox + showroom lightbox wiring", () => {
    const portal = fs.readFileSync(
      path.join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx"),
      "utf8",
    );
    const drop = fs.readFileSync(
      path.join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/SwatchesFinishesDrawer.tsx"),
      "utf8",
    );
    const lightbox = fs.readFileSync(
      path.join(process.cwd(), "src/app/embed/admin/master-catalog/ecommerce/FullResImageLightbox.tsx"),
      "utf8",
    );
    const card = fs.readFileSync(
      path.join(process.cwd(), "src/app/showroom/stock/InventoryCard.tsx"),
      "utf8",
    );

    expect(drop).toContain('variant?: "light" | "dark"');
    expect(drop).toContain("bg-slate-800/90");
    expect(portal).toContain('variant="dark"');
    expect(portal).not.toMatch(/upload-thumb-[\s\S]{0,200}bg-white/);
    expect(portal).toContain("aspect-square");
    expect(portal).toContain("object-cover");
    expect(portal).toContain("onPrev");
    expect(portal).toContain("formatFinishRepeatScaleLabel");
    expect(lightbox).toContain("lightbox-prev");
    expect(lightbox).toContain("max-h-[calc(100dvh-2rem)]");
    expect(lightbox).toContain("aspect-square");
    expect(lightbox).toContain("w-[min(72dvh,620px)]");
    expect(lightbox).toContain("onPointerDown");
    expect(lightbox).toContain("33.3333%");
    expect(lightbox).toContain("lightbox-replace");
    expect(lightbox).toContain("ArrowLeft");
    expect(card).toContain("inventory-open-lightbox");
    expect(card).toContain("FullResImageLightbox");
    expect(card).toContain("setUploadOpen(true)");
  });

  it("variance-preserving wrap + cabana synth are bimodal", async () => {
    const size = 64;
    const rgb = Buffer.alloc(size * size * 3, 120);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * size + x) * 3;
        rgb[i] = 40;
        rgb[i + 1] = 40;
        rgb[i + 2] = 40;
      }
      for (let x = size - 4; x < size; x++) {
        const i = (y * size + x) * 3;
        rgb[i] = 200;
        rgb[i + 1] = 200;
        rgb[i + 2] = 200;
      }
    }
    const wrapped = seamlessToroidalWrap(rgb, size, 0.1);
    expect(wrapped.length).toBe(rgb.length);

    const cabana = await synthesizeCabanaClassic("FAB-CAB-CLA");
    expect(fs.existsSync(cabana.texture_path)).toBe(true);
    expect(cabana.stripe.bimodal).toBe(true);
    expect(cabana.stripe.L_p90).toBeGreaterThan(75);
    expect(cabana.stripe.L_p10).toBeLessThan(25);
  });

  it("validates processed 32 textures through Pixel QA + uniform scales + no PV205084 on Cabana", async () => {
    expect(fs.existsSync(MANIFEST), `Run npm run finishes:process first — missing ${MANIFEST}`).toBe(
      true,
    );
    expect(fs.existsSync(MATCH_AUDIT)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
      entries: Array<{
        sku: string;
        family: string;
        source_file: string | null;
        source_type: string;
        texture_path: string;
        thumb_path: string;
        texture_scale: number;
      }>;
    };
    expect(manifest.entries).toHaveLength(32);

    const cabana = manifest.entries.find((e) => e.sku === "FAB-CAB-CLA");
    expect(cabana).toBeTruthy();
    expect(String(cabana!.source_file ?? "")).not.toMatch(/PV205084/i);
    expect(cabana!.texture_scale).toBe(7);

    for (const e of manifest.entries) {
      const expected = deriveFinishPhysicalScale({ sku: e.sku }).texture_scale;
      expect(e.texture_scale, e.sku).toBe(expected);
    }

    const canvas = CANVAS_SOLID_SKUS.map((sku) =>
      manifest.entries.find((e) => e.sku === sku),
    );
    expect(canvas.every((e) => e?.texture_scale === 8)).toBe(true);

    const qa = await verifyAllProcessed(
      manifest.entries.map((e) => ({
        sku: e.sku,
        texture_path: e.texture_path,
        thumb_path: e.thumb_path,
        family: e.family,
      })),
    );
    expect(qa.issues, qa.issues.map((i) => `${i.sku}:${i.code}:${i.detail}`).join("\n")).toEqual([]);
    expect(qa.ok).toBe(true);

    const dry = await validateManifest(MANIFEST);
    expect(dry.errors, dry.errors.join("\n")).toEqual([]);
    expect(dry.ok).toBe(true);
  });

  it("documents cache-bust query contract for DB URLs", () => {
    const upload = fs.readFileSync(
      path.join(process.cwd(), "scripts/ops/upload-highrez-finishes.ts"),
      "utf8",
    );
    expect(upload).toContain("withCacheBustQuery");
    expect(upload).toContain("?v=");
    expect(ECOMMERCE_32_FINISHES).toHaveLength(32);
  });
});
