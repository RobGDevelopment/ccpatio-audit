/**
 * Phase intake-media-certification-studio — static + pure-logic certification.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cropBoxToCssPercent,
  titleCaseStorefront,
} from "@/lib/intake-crop-math";
import {
  forceBorderNearCenter,
  finalizeSeamlessTexture,
  hardwareSafeCropSquare,
  listRawStudioPhotos,
  STAGING_ROOT,
} from "../scripts/ops/lib/swatch-cv-pipeline";
import { planIntakeUpload } from "@/server/ecommerce/intake-upload-policy";
import {
  mintCanonicalFinishSku,
  searchFinishSkuMatches,
  resolveFinishDefBySkuOrAlias,
  certifiedFinishObjectPaths,
} from "@/server/ecommerce/finish-intake";
import { PHASE1_SOW_ITEM_COUNT } from "@/server/ecommerce/phase1-portal";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("intake-media-certification-studio", () => {
  it("lists exactly 27 raw studio photos (16 Fabrics + 6 Dekton + 5 PowderCoat)", async () => {
    const photos = await listRawStudioPhotos();
    expect(photos).toHaveLength(27);
    expect(photos.filter((p) => p.categoryFolder === "Fabrics")).toHaveLength(16);
    expect(photos.filter((p) => p.categoryFolder === "Dekton")).toHaveLength(6);
    expect(photos.filter((p) => p.categoryFolder === "PowderCoat")).toHaveLength(5);
    expect(STAGING_ROOT).toContain("ccpatio-media-staging");
    for (const stripe of ["PV205022", "PV205037", "PV205012"]) {
      expect(photos.some((p) => p.relative.includes(stripe))).toBe(true);
    }
  });

  it("hardware-safe fabric crop sits below grommet band (22%)", () => {
    const w = 100;
    const h = 100;
    const V = new Uint8Array(w * h).fill(1);
    const L = new Float32Array(w * h).fill(50);
    const sq = hardwareSafeCropSquare(V, L, w, h, "Fabrics");
    // sampleTop=0, sampleH=100 → y0 >= 22
    expect(sq.y).toBeGreaterThanOrEqual(22);
    expect(sq.side).toBeGreaterThan(40);
  });

  it("forceBorderNearCenter is a no-op (Bug B removed) and striped skips wrap smear", () => {
    const size = 64;
    const rgb = Buffer.alloc(size * size * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = i % 255;
    const after = forceBorderNearCenter(rgb, size, 0.045);
    expect(Buffer.compare(after, rgb)).toBe(0);

    const striped = finalizeSeamlessTexture(Buffer.from(rgb), size, {
      striped: true,
      patternMode: "striped",
    });
    // Must return a buffer of same length (illumination may change values; no crash)
    expect(striped.length).toBe(rgb.length);
  });

  it("1:1 crop CSS percent math matches sharp.extract on non-square sources", () => {
    const sourceWidth = 6000;
    const sourceHeight = 4000; // 3:2
    const cropX = 1200;
    const cropY = 800;
    const cropSidePx = 2000;
    const pct = cropBoxToCssPercent({ cropX, cropY, cropSidePx, sourceWidth, sourceHeight });
    expect(pct.left).toBeCloseTo((cropX / sourceWidth) * 100, 6);
    expect(pct.top).toBeCloseTo((cropY / sourceHeight) * 100, 6);
    expect(pct.width).toBeCloseTo((cropSidePx / sourceWidth) * 100, 6);
    expect(pct.height).toBeCloseTo((cropSidePx / sourceHeight) * 100, 6);
    // Visual square: width% * sourceW === height% * sourceH === cropSidePx
    expect((pct.width / 100) * sourceWidth).toBeCloseTo(cropSidePx, 5);
    expect((pct.height / 100) * sourceHeight).toBeCloseTo(cropSidePx, 5);
  });

  it("signed upload policy accepts webp / mp4 / glb and rejects svg", () => {
    expect(
      planIntakeUpload({
        kind: "product_render",
        filename: "hero.webp",
        contentType: "image/webp",
        byteSize: 1_000_000,
        sku: "FIN-TEST",
      }).ok,
    ).toBe(true);
    expect(
      planIntakeUpload({
        kind: "product_video",
        filename: "walkthrough.mp4",
        contentType: "video/mp4",
        byteSize: 5_000_000,
        woo_sku: "27650",
      }).ok,
    ).toBe(true);
    expect(
      planIntakeUpload({
        kind: "product_3d",
        filename: "sofa.glb",
        contentType: "model/gltf-binary",
        byteSize: 2_000_000,
        woo_sku: "27650",
      }).ok,
    ).toBe(true);
    const bad = planIntakeUpload({
      kind: "product_render",
      filename: "evil.svg",
      contentType: "image/svg+xml",
      byteSize: 100,
    });
    expect(bad.ok).toBe(false);
  });

  it("auto-SKU bind + DKT↔STN bridge + canonical cloud rename paths", () => {
    const minted = mintCanonicalFinishSku("Cabana Classic", "sunbrella");
    expect(minted).toMatch(/^FAB-/);
    const matches = searchFinishSkuMatches("Entzo");
    expect(matches.some((m) => m.sku === "DKT-EDORA" || m.bridgeSkus.some((b) => b.includes("DKT")))).toBe(
      true,
    );
    const bridged = resolveFinishDefBySkuOrAlias("DKT-ENTZO");
    expect(bridged?.sku).toBe("DKT-EDORA");
    expect(bridged?.displayName).toBe("Entzo");
    const paths = certifiedFinishObjectPaths("FAB-CAB-CLA", "Cabana Classic");
    expect(paths.texture).toBe("finishes/FAB-CAB-CLA/FAB-CAB-CLA-cabana-classic-2048.jpg");
    expect(paths.thumb).toBe("finishes/FAB-CAB-CLA/FAB-CAB-CLA-cabana-classic-512.jpg");
  });

  it("4-tab portal defaults to intake; labels + crop overlay + approve wired", () => {
    const portal = read(
      "src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx",
    );
    expect(portal).toMatch(/PortalTab\s*=\s*\"intake\"\s*\|\s*\"finishes\"\s*\|\s*\"products\"\s*\|\s*\"sync\"/);
    expect(portal).toMatch(/useState(?:<PortalTab>)?\(\"intake\"\)/);
    expect(portal).toContain("portal-tab-intake");
    expect(portal).toMatch(/Intake &amp; Media Studio|Intake & Media Studio/);
    expect(portal).toMatch(/Certified Finishes &amp; Add-Ons|Certified Finishes & Add-Ons/);
    expect(portal).toContain("Certified Products");
    expect(portal).toMatch(/WooCommerce Sync &amp; Handoff|WooCommerce Sync & Handoff/);
    expect(portal).toContain("Rob · Mia · Kian · Executive");
    expect(portal).toContain("sync-sku-combobox");
    expect(portal).toContain("certified-gate-note");

    const studio = read(
      "src/app/embed/admin/master-catalog/ecommerce/IntakeMediaStudio.tsx",
    );
    expect(studio).toContain("portal-panel-intake");
    expect(studio).toContain("portal-intake-subfilters");
    expect(studio).toContain("intake-approve-promote");
    expect(studio).toContain("/api/ecommerce/intake-upload-sign");
    expect(studio).toContain("/api/ecommerce/intake-upload-commit");
    expect(studio).not.toMatch(/DropButton[\s\S]{0,200}variant=\"light\"/);

    const overlay = read(
      "src/app/embed/admin/master-catalog/ecommerce/IntakeCropOverlay.tsx",
    );
    expect(overlay).toContain("intake-crop-overlay");
    expect(overlay).toContain("cropBoxToCssPercent");
  });

  it("additive DDL only (IF NOT EXISTS) — zero DROP", () => {
    const sql = read("src/server/db/migrations/0063_finish_intake_and_product_media.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+\"finish_intake\"/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+\"gallery_image_urls\"/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+\"product_video_url\"/i);
    expect(sql).not.toMatch(/\bDROP\b/i);

    const ensure = read("src/server/ecommerce/finish-intake.ts");
    expect(ensure).toContain("CREATE TABLE IF NOT EXISTS");
    expect(ensure).toContain("ADD COLUMN IF NOT EXISTS");
    expect(ensure).not.toMatch(/DROP TABLE/i);
  });

  it("package.json wires intake:seed-photoshoot + finishes:pull-approved", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["intake:seed-photoshoot"]).toContain("seed-intake-photoshoot");
    expect(pkg.scripts["finishes:pull-approved"]).toContain("pull-approved-finishes");
  });

  it("Title Case preserves BH/SH/OD/LED/II/III; SOW denominator stays 102", () => {
    expect(titleCaseStorefront("canvas ivory")).toBe("Canvas Ivory");
    expect(titleCaseStorefront("kindle bh led ii")).toBe("Kindle BH LED II");
    expect(PHASE1_SOW_ITEM_COUNT).toBe(102);
  });

  it("CV pipeline + seed scripts exist; no forceBorderNearCenter rim smear in finalize", () => {
    const cv = read("scripts/ops/lib/swatch-cv-pipeline.ts");
    expect(cv).toContain("hardwareSafeCropSquare");
    expect(cv).toContain("sourceWidth");
    expect(cv).toContain("sourceHeight");
    // finalize must not call forceBorderNearCenter anymore
    expect(cv).not.toMatch(/finalizeSeamlessTexture[\s\S]{0,400}forceBorderNearCenter\(/);
    expect(fs.existsSync(path.join(ROOT, "scripts/ops/seed-intake-photoshoot.ts"))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "src/app/api/ecommerce/intake-upload-sign/route.ts"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(ROOT, "src/app/api/ecommerce/intake-upload-commit/route.ts"))).toBe(
      true,
    );
  });

  it("e2e specs expect intake default tab", () => {
    const two = read("tests/e2e/ecommerce-two-tab.spec.ts");
    expect(two).toContain("portal-tab-intake");
    expect(two).toContain("portal-panel-intake");
    const scroll = read("tests/e2e/ecommerce-portal-scroll-drawer.spec.ts");
    expect(scroll).toContain("portal-tab-finishes");
  });
});
