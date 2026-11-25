import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ECOMMERCE_32_FINISHES,
  ECOMMERCE_32_FINISH_COUNT,
  assertExact32Roster,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import {
  deriveFinishPhysicalScale,
  finishStoragePrefix,
  finishTextureObjectPath,
  finishThumbObjectPath,
} from "@/server/assets/finish-assets";
import { validateManifest } from "../scripts/ops/upload-highrez-finishes";

const STAGING = "C:\\Workspace\\ccpatio-media-staging";
const MANIFEST = path.join(STAGING, "processed", "manifest.json");
const QA_SHEET = path.join(STAGING, "processed", "qa-contact-sheet.html");
const CV_PY = path.join(process.cwd(), "scripts", "ops", "process-highrez-finishes-cv.py");
const PROCESS_TS = path.join(process.cwd(), "scripts", "ops", "process-highrez-finishes.ts");
const UPLOAD_TS = path.join(process.cwd(), "scripts", "ops", "upload-highrez-finishes.ts");

describe("highrez-swatch-pipeline", () => {
  it("keeps the exact 32-finish roster", () => {
    assertExact32Roster();
    expect(ECOMMERCE_32_FINISHES).toHaveLength(ECOMMERCE_32_FINISH_COUNT);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "sunbrella")).toHaveLength(16);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "ultraleather")).toHaveLength(4);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "dekton")).toHaveLength(6);
    expect(ECOMMERCE_32_FINISHES.filter((f) => f.family === "powder")).toHaveLength(6);
  });

  it("anchors Cabana Classic ~7in stripe in texture_scale helpers", () => {
    const scale = deriveFinishPhysicalScale({
      croppedWidthIn: 6.2,
      sku: "FAB-CAB-CLA",
      patternRepeatIn: { w: 54, h: 25.25 },
    });
    expect(scale.repeat_inches).toBe(7);
    expect(scale.texture_scale).toBe(7);
    expect(scale.sample_width_in).toBe(6.2);
    expect(scale.pattern_repeat_w_in).toBe(54);
  });

  it("maps storage paths under finishes/{sku}/", () => {
    expect(finishStoragePrefix("fab-cab-cla")).toBe("finishes/FAB-CAB-CLA");
    expect(finishTextureObjectPath("FAB-CAB-CLA")).toBe("finishes/FAB-CAB-CLA/texture-2048.jpg");
    expect(finishThumbObjectPath("FAB-CAB-CLA")).toBe("finishes/FAB-CAB-CLA/thumb-512.jpg");
  });

  it("ships process + upload scripts without dirtying package-lock deps", () => {
    expect(fs.existsSync(PROCESS_TS)).toBe(true);
    expect(fs.existsSync(UPLOAD_TS)).toBe(true);
    expect(fs.existsSync(CV_PY)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["finishes:process"]).toContain("process-highrez-finishes.ts");
    expect(pkg.scripts["finishes:upload"]).toContain("upload-highrez-finishes.ts");
  });

  it("validates processed manifest 32/32 with 2048 + 512 outputs outside the repo", async () => {
    expect(fs.existsSync(MANIFEST), `Run npm run finishes:process first — missing ${MANIFEST}`).toBe(
      true,
    );
    expect(fs.existsSync(QA_SHEET)).toBe(true);
    const result = await validateManifest(MANIFEST);
    expect(result.errors, result.errors.join("\n")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(32);
    expect(result.entries.every((e) => e.texture_ok && e.thumb_ok)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
      entries: Array<{ source_type: string; sku: string }>;
      studio_photo: number;
      synthetic_fallback: number;
    };
    expect(manifest.studio_photo + manifest.synthetic_fallback).toBe(32);
    expect(manifest.synthetic_fallback).toBe(6);
    expect(manifest.studio_photo).toBe(26);
    const synthFamilies = manifest.entries
      .filter((e) => e.source_type === "synthetic_fallback")
      .map((e) => e.sku);
    expect(synthFamilies.filter((s) => s.startsWith("FAB-")).length).toBeGreaterThanOrEqual(4);
  });

  it("keeps staging media outside git", () => {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    const others = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    });
    const media = others
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f));
    expect(media, `Unexpected in-repo media:\n${media.join("\n")}`).toEqual([]);
  });
});
