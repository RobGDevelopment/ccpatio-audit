/**
 * Automated Pixel Border QA Gate for processed 2048² / 512² finish textures.
 */
import fs from "node:fs";
import sharp from "sharp";
import { deltaE, rgbToLab } from "./swatch-cv-pipeline";

export type PixelQaIssue = {
  sku: string;
  path: string;
  code: string;
  detail: string;
};

export type PixelQaResult = {
  ok: boolean;
  issues: PixelQaIssue[];
};

const DARK_SKUS = new Set([
  "FAB-CAN-BLA",
  "FAB-CAN-NAV",
  "FAB-POS-SAP",
  "FAB-BLA-MOO",
  "PWD-BLACK",
  "PWD-OIL-RUB-BRONZE",
  "DKT-NILIUM",
  "DKT-ENTZO",
  "DKT-EDORA",
]);

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

async function loadRaw(filePath: string): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function centerL(data: Buffer, w: number, h: number): number {
  const x0 = Math.floor(w * 0.4);
  const x1 = Math.floor(w * 0.6);
  const y0 = Math.floor(h * 0.4);
  const y1 = Math.floor(h * 0.6);
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 3;
      s += rgbToLab(data[i]!, data[i + 1]!, data[i + 2]!)[0];
      n++;
    }
  }
  return n ? s / n : 0;
}

function borderDarkFraction(
  data: Buffer,
  w: number,
  h: number,
  side: "top" | "bottom" | "left" | "right",
  bandFrac = 0.04,
  Lthresh = 16,
): number {
  const band = Math.max(1, Math.floor(Math.min(w, h) * bandFrac));
  let dark = 0;
  let total = 0;
  const visit = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    const L = rgbToLab(data[i]!, data[i + 1]!, data[i + 2]!)[0];
    if (L < Lthresh) dark++;
    total++;
  };
  if (side === "top") {
    for (let y = 0; y < band; y++) for (let x = 0; x < w; x++) visit(x, y);
  } else if (side === "bottom") {
    for (let y = h - band; y < h; y++) for (let x = 0; x < w; x++) visit(x, y);
  } else if (side === "left") {
    for (let y = 0; y < h; y++) for (let x = 0; x < band; x++) visit(x, y);
  } else {
    for (let y = 0; y < h; y++) for (let x = w - band; x < w; x++) visit(x, y);
  }
  return total ? dark / total : 0;
}

function edgeContinuity(data: Buffer, w: number, h: number): { lr: number; tb: number } {
  let lr = 0;
  let tb = 0;
  for (let y = 0; y < h; y++) {
    const li = y * w * 3;
    const ri = (y * w + (w - 1)) * 3;
    lr +=
      (Math.abs(data[li]! - data[ri]!) +
        Math.abs(data[li + 1]! - data[ri + 1]!) +
        Math.abs(data[li + 2]! - data[ri + 2]!)) /
      3;
  }
  for (let x = 0; x < w; x++) {
    const ti = x * 3;
    const bi = ((h - 1) * w + x) * 3;
    tb +=
      (Math.abs(data[ti]! - data[bi]!) +
        Math.abs(data[ti + 1]! - data[bi + 1]!) +
        Math.abs(data[ti + 2]! - data[bi + 2]!)) /
      3;
  }
  return { lr: lr / h, tb: tb / w };
}

function borderVsCenterDeltaE(data: Buffer, w: number, h: number): number {
  // Outer rim after wrap (2%) — dark-wedge gate already covers the 4% studio-table strips.
  const band = Math.max(1, Math.floor(Math.min(w, h) * 0.02));
  const acc = (x0: number, y0: number, x1: number, y1: number) => {
    let L = 0;
    let a = 0;
    let b = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 3;
        const lab = rgbToLab(data[i]!, data[i + 1]!, data[i + 2]!);
        L += lab[0];
        a += lab[1];
        b += lab[2];
        n++;
      }
    }
    return [L / n, a / n, b / n] as [number, number, number];
  };
  const center = acc(Math.floor(w * 0.35), Math.floor(h * 0.35), Math.floor(w * 0.65), Math.floor(h * 0.65));
  const borders = [
    acc(0, 0, w, band),
    acc(0, h - band, w, h),
    acc(0, 0, band, h),
    acc(w - band, 0, w, h),
  ];
  return Math.max(...borders.map((b) => deltaE(center, b)));
}

function lightnessPercentiles(data: Buffer, w: number, h: number): { p10: number; p90: number } {
  const Ls: number[] = [];
  const step = Math.max(1, Math.floor((w * h) / 20000));
  for (let i = 0; i < w * h; i += step) {
    const o = i * 3;
    Ls.push(rgbToLab(data[o]!, data[o + 1]!, data[o + 2]!)[0]);
  }
  Ls.sort((a, b) => a - b);
  return { p10: percentile(Ls, 10), p90: percentile(Ls, 90) };
}

export async function verifyProcessedTexture(opts: {
  sku: string;
  texturePath: string;
  thumbPath: string;
  family: string;
  expectBimodalCabana?: boolean;
}): Promise<PixelQaResult> {
  const issues: PixelQaIssue[] = [];
  const push = (code: string, detail: string, p = opts.texturePath) =>
    issues.push({ sku: opts.sku, path: p, code, detail });

  if (!fs.existsSync(opts.texturePath)) push("missing_texture", "texture file missing");
  if (!fs.existsSync(opts.thumbPath)) push("missing_thumb", "thumb file missing", opts.thumbPath);
  if (issues.length) return { ok: false, issues };

  const tex = await loadRaw(opts.texturePath);
  const th = await loadRaw(opts.thumbPath);
  if (tex.w !== 2048 || tex.h !== 2048) {
    push("dims_texture", `expected 2048x2048 got ${tex.w}x${tex.h}`);
  }
  if (th.w !== 512 || th.h !== 512) {
    push("dims_thumb", `expected 512x512 got ${th.w}x${th.h}`, opts.thumbPath);
  }

  const Lcenter = centerL(tex.data, tex.w, tex.h);
  const isDark = DARK_SKUS.has(opts.sku) || Lcenter <= 28;
  // Cabana Classic is intentionally bimodal black+white stripes — skip dark-wedge gate.
  if (!isDark && opts.sku !== "FAB-CAB-CLA") {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const frac = borderDarkFraction(tex.data, tex.w, tex.h, side);
      if (frac >= 0.003) {
        push(
          "dark_wedge",
          `${side} border dark fraction ${(frac * 100).toFixed(2)}% >= 0.3% (L_center=${Lcenter.toFixed(1)})`,
        );
      }
    }
  }

  const seamlessFamilies = new Set(["sunbrella", "ultraleather", "powder"]);
  // Cabana vertical stripes are not seam-softened the same way as solids.
  if (seamlessFamilies.has(opts.family) && opts.sku !== "FAB-CAB-CLA") {
    const { lr, tb } = edgeContinuity(tex.data, tex.w, tex.h);
    if (lr >= 8 || tb >= 8) {
      push("seam_continuity", `wrap delta lr=${lr.toFixed(2)} tb=${tb.toFixed(2)} (need <8)`);
    }
    const dE = borderVsCenterDeltaE(tex.data, tex.w, tex.h);
    if (dE >= 5.5) {
      push("border_center_deltaE", `border-vs-center ΔE=${dE.toFixed(2)} (need <5.5)`);
    }
  }

  if (opts.sku === "FAB-CAB-CLA" || opts.expectBimodalCabana) {
    const { p10, p90 } = lightnessPercentiles(tex.data, tex.w, tex.h);
    if (!(p90 > 75 && p10 < 25)) {
      push("cabana_bimodal", `FAB-CAB-CLA L_p90=${p90.toFixed(1)} L_p10=${p10.toFixed(1)} (need >75 & <25)`);
    }
  }

  return { ok: issues.length === 0, issues };
}

export async function verifyAllProcessed(
  entries: Array<{
    sku: string;
    texture_path: string;
    thumb_path: string;
    family: string;
  }>,
): Promise<PixelQaResult> {
  const issues: PixelQaIssue[] = [];
  for (const e of entries) {
    const r = await verifyProcessedTexture({
      sku: e.sku,
      texturePath: e.texture_path,
      thumbPath: e.thumb_path,
      family: e.family,
      expectBimodalCabana: e.sku === "FAB-CAB-CLA",
    });
    issues.push(...r.issues);
  }
  return { ok: issues.length === 0, issues };
}
