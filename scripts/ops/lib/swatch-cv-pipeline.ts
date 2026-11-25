/**
 * Exact CV interior safe-square + illumination + seamless-tile pipeline.
 * sharp EXIF .rotate() first, then raw RGB float/uint8 buffers for Lab / Sobel / DP crop.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const STAGING_ROOT = "C:\\Workspace\\ccpatio-media-staging";
export const RAW_ROOT = path.join(STAGING_ROOT, "HighRezImages");
export const OUT_ROOT = path.join(STAGING_ROOT, "processed");
export const TEXTURE_DIR = path.join(OUT_ROOT, "textures");
export const THUMB_DIR = path.join(OUT_ROOT, "thumbs");
export const OVERLAY_DIR = path.join(OUT_ROOT, "overlays");

const WORK_W = 600;
const VEINED_DEKTON = new Set([
  "DKT-AURA",
  "DKT-EDORA",
  "DKT-LUMINA",
  "DKT-NILIUM",
  "DKT-STRATO",
  "DKT-ALDEM",
]);

export type CvProcessResult = {
  source_file: string;
  relative: string;
  category_folder: string;
  sha1: string;
  error?: string;
  pixels_per_inch: number | null;
  ppi_method: string;
  deskew_deg: number;
  crop_box: { x: number; y: number; side: number };
  cropped_width_in: number | null;
  overlay_path: string;
  tmp_id: string;
  texture_path: string;
  thumb_path: string;
  lab: number[];
  stripe: {
    vertical_energy: number;
    horizontal_energy: number;
    vertical_period_px: number;
    horizontal_period_px: number;
    is_striped: boolean;
    L_p10: number;
    L_p90: number;
    bimodal: boolean;
  };
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047);
  const fy = f(Y / 1.0);
  const fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787;
  };
  const X = 0.95047 * inv(fx);
  const Y = 1.0 * inv(fy);
  const Z = 1.08883 * inv(fz);
  const R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const G = X * -0.969266 + Y * 1.8760108 + Z * 0.041556;
  const B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  const lin = (c: number) => {
    const v = clamp(c, 0, 1);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [Math.round(lin(R) * 255), Math.round(lin(G) * 255), Math.round(lin(B) * 255)];
}

export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const dL = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = clamp(Math.floor((p / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[i]!;
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

/** Separable box dilate — O(W*H*r) instead of O(W*H*r²). */
function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        if (mask[y * w + xx]) {
          hit = 1;
          break;
        }
      }
      tmp[y * w + x] = hit;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        if (tmp[yy * w + x]) {
          hit = 1;
          break;
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

/** Separable box erode — O(W*H*r). */
function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w || !mask[y * w + xx]) {
          ok = 0;
          break;
        }
      }
      tmp[y * w + x] = ok;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h || !tmp[yy * w + x]) {
          ok = 0;
          break;
        }
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}

function sobelMagnitude(L: Float32Array, w: number, h: number): Float32Array {
  const G = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -L[i - w - 1]! -
        2 * L[i - 1]! -
        L[i + w - 1]! +
        L[i - w + 1]! +
        2 * L[i + 1]! +
        L[i + w + 1]!;
      const gy =
        -L[i - w - 1]! -
        2 * L[i - w]! -
        L[i - w + 1]! +
        L[i + w - 1]! +
        2 * L[i + w]! +
        L[i + w + 1]!;
      G[i] = Math.hypot(gx, gy);
    }
  }
  return G;
}

function gaussianBlurReflect(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  // Cap radius so reflected sampling never walks off a single bounce.
  const radius = Math.max(1, Math.min(Math.ceil(sigma * 3), Math.max(w, h) - 1));
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= ksum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const reflect = (p: number, n: number) => {
    if (n <= 1) return 0;
    let x = p;
    while (x < 0 || x >= n) {
      if (x < 0) x = -x;
      if (x >= n) x = 2 * n - 2 - x;
    }
    return x;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = reflect(x + k, w);
        s += src[y * w + xx]! * kernel[k + radius]!;
      }
      tmp[y * w + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = reflect(y + k, h);
        s += tmp[yy * w + x]! * kernel[k + radius]!;
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

function largestInscribedSquare(
  V: Uint8Array,
  w: number,
  h: number,
): { x: number; y: number; side: number; maxDp: number } {
  const dp = new Int32Array(w * h);
  let maxDp = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!V[i]) {
        dp[i] = 0;
        continue;
      }
      if (x === 0 || y === 0) {
        dp[i] = 1;
      } else {
        dp[i] = 1 + Math.min(dp[i - w]!, dp[i - 1]!, dp[i - w - 1]!);
      }
      if (dp[i]! > maxDp) maxDp = dp[i]!;
    }
  }

  // Valid centroid
  let cx = 0;
  let cy = 0;
  let cn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (V[y * w + x]) {
        cx += x;
        cy += y;
        cn++;
      }
    }
  }
  if (cn > 0) {
    cx /= cn;
    cy /= cn;
  } else {
    cx = w / 2;
    cy = h / 2;
  }

  const minSide = Math.max(8, Math.floor(0.9 * maxDp));
  let best = { x: 0, y: 0, side: 0, dist: Infinity };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const side = dp[y * w + x]!;
      if (side < minSide) continue;
      const sx = x - side + 1;
      const sy = y - side + 1;
      const mx = sx + side / 2;
      const my = sy + side / 2;
      const dist = (mx - cx) ** 2 + (my - cy) ** 2;
      if (side > best.side || (side === best.side && dist < best.dist)) {
        best = { x: sx, y: sy, side, dist };
      }
    }
  }
  if (best.side <= 0) {
    const side = Math.min(w, h);
    return { x: Math.floor((w - side) / 2), y: Math.floor((h - side) / 2), side, maxDp };
  }
  return { x: best.x, y: best.y, side: best.side, maxDp };
}

function buildTapeMask(
  L: Float32Array,
  a: Float32Array,
  b: Float32Array,
  G: Float32Array,
  w: number,
  h: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  // Core median L for metallic/white tape heuristics
  const coreL: number[] = [];
  const x0 = Math.floor(w * 0.35);
  const x1 = Math.floor(w * 0.65);
  const y0 = Math.floor(h * 0.35);
  const y1 = Math.floor(h * 0.65);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) coreL.push(L[y * w + x]!);
  }
  coreL.sort((u, v) => u - v);
  const coreMed = percentile(coreL, 50);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const Lv = L[i]!;
      const av = a[i]!;
      const bv = b[i]!;
      // Yellow tape blade
      if (bv > 30 && Lv > 42 && av < 22) {
        mask[i] = 1;
        continue;
      }
      // Bright paper SKU tags
      if (Lv > 88 && Math.hypot(av, bv) < 12 && (y < h * 0.18 || y > h * 0.82 || x < w * 0.18 || x > w * 0.82)) {
        mask[i] = 1;
        continue;
      }
      // Metallic / white tape near sharp dark ticks
      if (Lv > 75 && coreMed < 72) {
        let nearTick = false;
        for (let dy = -12; dy <= 12 && !nearTick; dy++) {
          for (let dx = -12; dx <= 12; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (G[j]! > 40 && L[j]! < 40) {
              nearTick = true;
              break;
            }
          }
        }
        if (nearTick) mask[i] = 1;
      }
    }
  }

  // High-frequency periodic black tick clusters along frame edges (white swatches)
  const edgeBand = Math.max(4, Math.floor(w * 0.08));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onEdge = x < edgeBand || x >= w - edgeBand || y < edgeBand || y >= h - edgeBand;
      if (!onEdge) continue;
      const i = y * w + x;
      if (L[i]! < 35 && G[i]! > 25) mask[i] = 1;
    }
  }

  return dilateMask(mask, w, h, Math.round(w * 0.06));
}

function buildValidMask(
  L: Float32Array,
  a: Float32Array,
  b: Float32Array,
  tapeMask: Uint8Array,
  w: number,
  h: number,
  opts: { striped?: boolean; veined?: boolean },
): Uint8Array {
  const peri = Math.max(2, Math.floor(Math.min(w, h) * 0.03));
  const bgSamples: Array<[number, number, number]> = [];
  const coreSamples: Array<[number, number, number]> = [];
  const coreDeltas: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tapeMask[i]) continue;
      const lab: [number, number, number] = [L[i]!, a[i]!, b[i]!];
      const onPeri = x < peri || y < peri || x >= w - peri || y >= h - peri;
      if (onPeri) bgSamples.push(lab);
    }
  }

  const cx0 = Math.floor(w * 0.35);
  const cx1 = Math.floor(w * 0.65);
  const cy0 = Math.floor(h * 0.35);
  const cy1 = Math.floor(h * 0.65);
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const i = y * w + x;
      if (tapeMask[i]) continue;
      coreSamples.push([L[i]!, a[i]!, b[i]!]);
    }
  }

  const avg = (samples: Array<[number, number, number]>): [number, number, number] => {
    if (!samples.length) return [50, 0, 0];
    let Lsum = 0;
    let asum = 0;
    let bsum = 0;
    for (const s of samples) {
      Lsum += s[0];
      asum += s[1];
      bsum += s[2];
    }
    const n = samples.length;
    return [Lsum / n, asum / n, bsum / n];
  };

  const bg = avg(bgSamples);
  const core = avg(coreSamples);
  for (const s of coreSamples) coreDeltas.push(deltaE(s, core));
  coreDeltas.sort((u, v) => u - v);
  const coreP90 = percentile(coreDeltas, 90);
  const dCoreBg = deltaE(core, bg);

  const V = new Uint8Array(w * h);
  if (dCoreBg > 14) {
    const bgThresh = Math.max(12, 0.4 * dCoreBg);
    const outlierThresh = Math.max(26, 2.8 * coreP90);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (tapeMask[i]) {
          V[i] = 0;
          continue;
        }
        const lab: [number, number, number] = [L[i]!, a[i]!, b[i]!];
        const dBg = deltaE(lab, bg);
        const dCore = deltaE(lab, core);
        const darkRamp =
          core[0] > 28 && L[i]! < bg[0] + 0.35 * (core[0] - bg[0]);
        let invalid = dBg < bgThresh || darkRamp;
        if (!opts.striped && !opts.veined && dCore > outlierThresh) invalid = true;
        V[i] = invalid ? 0 : 1;
      }
    }
  } else {
    // Dark finishes: exclude tape, specular outliers, outer 18% perimeter
    const frame = Math.floor(Math.min(w, h) * 0.18);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (tapeMask[i]) {
          V[i] = 0;
          continue;
        }
        if (x < frame || y < frame || x >= w - frame || y >= h - frame) {
          V[i] = 0;
          continue;
        }
        const dCore = deltaE([L[i]!, a[i]!, b[i]!], core);
        V[i] = dCore > 16 ? 0 : 1;
      }
    }
  }

  const erodeR = Math.round(Math.min(w, h) * 0.1);
  return erodeMask(V, w, h, erodeR);
}

function downsampleFloat(src: Float32Array, w: number, h: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * (w / dw)));
      const sy = Math.min(h - 1, Math.floor((y + 0.5) * (h / dh)));
      out[y * dw + x] = src[sy * w + sx]!;
    }
  }
  return out;
}

function upsampleFloat(src: Float32Array, sw: number, sh: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) * (sw / w) - 0.5;
      const fy = (y + 0.5) * (sh / h) - 0.5;
      const x0 = clamp(Math.floor(fx), 0, sw - 1);
      const y0 = clamp(Math.floor(fy), 0, sh - 1);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const v00 = src[y0 * sw + x0]!;
      const v10 = src[y0 * sw + x1]!;
      const v01 = src[y1 * sw + x0]!;
      const v11 = src[y1 * sw + x1]!;
      out[y * w + x] =
        v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
    }
  }
  return out;
}

function flattenIllumination(
  rgb: Buffer,
  size: number,
  mode: "gaussian" | "plane",
): Buffer {
  const n = size * size;
  const L = new Float32Array(n);
  const aArr = new Float32Array(n);
  const bArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [Lv, av, bv] = rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    L[i] = Lv;
    aArr[i] = av;
    bArr[i] = bv;
  }

  // Blur on a small grid then upsample — equivalent wide Gaussian, far cheaper than σ≈size/6 on 2048².
  const small = 256;
  const Ls = downsampleFloat(L, size, size, small, small);
  const sigmaSmall = mode === "plane" ? small / 2 : small / 6;
  const blurredSmall = gaussianBlurReflect(Ls, small, small, sigmaSmall);
  const Lblur = upsampleFloat(blurredSmall, small, small, size, size);

  let meanL = 0;
  for (let i = 0; i < n; i++) meanL += L[i]!;
  meanL /= n;
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const denom = Math.max(Lblur[i]!, 1e-3);
    const Lout = clamp(L[i]! * (meanL / denom), 0, 100);
    const [r, g, b] = labToRgb(Lout, aArr[i]!, bArr[i]!);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

/** Replace dark studio wedges in outer band with inward fabric samples (non-dark finishes). */
export function inpaintDarkBorderWedges(rgb: Buffer, size: number, bandFrac = 0.06): Buffer {
  const out = Buffer.from(rgb);
  const band = Math.max(2, Math.round(size * bandFrac));
  const isDarkPx = (i: number) => {
    const [L] = rgbToLab(out[i]!, out[i + 1]!, out[i + 2]!);
    return L < 16;
  };
  const copyFrom = (di: number, si: number) => {
    out[di] = out[si]!;
    out[di + 1] = out[si + 1]!;
    out[di + 2] = out[si + 2]!;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onBorder = x < band || y < band || x >= size - band || y >= size - band;
      if (!onBorder) continue;
      const i = (y * size + x) * 3;
      if (!isDarkPx(i)) continue;
      const ix = clamp(x, band, size - 1 - band);
      const iy = clamp(y, band, size - 1 - band);
      copyFrom(i, (iy * size + ix) * 3);
    }
  }
  return out;
}

/** Pull outer-band Lab toward the center mean (kills residual vignette ΔE). */
export function matchBorderToCenterLightness(rgb: Buffer, size: number, bandFrac = 0.08): Buffer {
  const out = Buffer.from(rgb);
  const band = Math.max(2, Math.round(size * bandFrac));
  let cL = 0;
  let cA = 0;
  let cB = 0;
  let cn = 0;
  const x0 = Math.floor(size * 0.35);
  const x1 = Math.floor(size * 0.65);
  for (let y = x0; y < x1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * size + x) * 3;
      const lab = rgbToLab(out[i]!, out[i + 1]!, out[i + 2]!);
      cL += lab[0];
      cA += lab[1];
      cB += lab[2];
      cn++;
    }
  }
  cL /= cn || 1;
  cA /= cn || 1;
  cB /= cn || 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onBorder = x < band || y < band || x >= size - band || y >= size - band;
      if (!onBorder) continue;
      const i = (y * size + x) * 3;
      const [L, a, b] = rgbToLab(out[i]!, out[i + 1]!, out[i + 2]!);
      const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
      const t = 1 - edgeDist / band; // 1 at outer edge
      // Strong pull at the rim; keep local grain via residual
      const pull = 0.35 + 0.65 * t;
      const L2 = L + (cL - L) * pull;
      const a2 = a + (cA - a) * pull * 0.85;
      const b2 = b + (cB - b) * pull * 0.85;
      const [r, g, bv] = labToRgb(clamp(L2, 0, 100), a2, b2);
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = bv;
    }
  }
  return out;
}

/** Expand interior ring outward so the outer rim Lab matches near-center material. */
export function replicateInteriorRingToBorder(rgb: Buffer, size: number, bandFrac = 0.05): Buffer {
  const out = Buffer.from(rgb);
  const band = Math.max(2, Math.round(size * bandFrac));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dl = x;
      const dr = size - 1 - x;
      const dt = y;
      const db = size - 1 - y;
      const edgeDist = Math.min(dl, dr, dt, db);
      if (edgeDist >= band) continue;
      let sx = x;
      let sy = y;
      if (dl === edgeDist) sx = band;
      else if (dr === edgeDist) sx = size - 1 - band;
      if (dt === edgeDist) sy = band;
      else if (db === edgeDist) sy = size - 1 - band;
      // Corners: clamp both axes into the interior
      if (dl < band && dt < band) {
        sx = band;
        sy = band;
      } else if (dr < band && dt < band) {
        sx = size - 1 - band;
        sy = band;
      } else if (dl < band && db < band) {
        sx = band;
        sy = size - 1 - band;
      } else if (dr < band && db < band) {
        sx = size - 1 - band;
        sy = size - 1 - band;
      }
      const di = (y * size + x) * 3;
      const si = (sy * size + sx) * 3;
      // Keep 35% local grain, 65% interior rim (preserves weave, kills vignette)
      out[di] = Math.round(out[si]! * 0.65 + out[di]! * 0.35);
      out[di + 1] = Math.round(out[si + 1]! * 0.65 + out[di + 1]! * 0.35);
      out[di + 2] = Math.round(out[si + 2]! * 0.65 + out[di + 2]! * 0.35);
    }
  }
  return out;
}

/** Force outer rim Lab within ΔE≈5 of center while keeping fine grain. */
export function forceBorderNearCenter(rgb: Buffer, size: number, bandFrac = 0.03): Buffer {
  const out = Buffer.from(rgb);
  const band = Math.max(2, Math.round(size * bandFrac));
  let cL = 0;
  let cA = 0;
  let cB = 0;
  let cn = 0;
  const x0 = Math.floor(size * 0.35);
  const x1 = Math.floor(size * 0.65);
  for (let y = x0; y < x1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * size + x) * 3;
      const lab = rgbToLab(out[i]!, out[i + 1]!, out[i + 2]!);
      cL += lab[0];
      cA += lab[1];
      cB += lab[2];
      cn++;
    }
  }
  cL /= cn || 1;
  cA /= cn || 1;
  cB /= cn || 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edgeDist = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (edgeDist >= band) continue;
      const i = (y * size + x) * 3;
      const [L, a, b] = rgbToLab(out[i]!, out[i + 1]!, out[i + 2]!);
      const t = 1 - edgeDist / band;
      // Outer half of band → pure center Lab; fade grain back in toward interior.
      const keep = t > 0.5 ? 0 : 0.25 * (1 - t / 0.5);
      const L2 = cL * (1 - keep) + L * keep;
      const a2 = cA * (1 - keep) + a * keep;
      const b2 = cB * (1 - keep) + b * keep;
      const [r, g, bv] = labToRgb(clamp(L2, 0, 100), a2, b2);
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = bv;
    }
  }
  return out;
}

/** Hard-lock opposite edge pixels equal without re-blending the rim band. */
function lockOppositeEdges(rgb: Buffer, size: number): Buffer {
  const out = Buffer.from(rgb);
  for (let y = 0; y < size; y++) {
    for (let c = 0; c < 3; c++) {
      const avg = Math.round((out[y * size * 3 + c]! + out[(y * size + size - 1) * 3 + c]!) / 2);
      out[y * size * 3 + c] = avg;
      out[(y * size + size - 1) * 3 + c] = avg;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let c = 0; c < 3; c++) {
      const avg = Math.round((out[x * 3 + c]! + out[((size - 1) * size + x) * 3 + c]!) / 2);
      out[x * 3 + c] = avg;
      out[((size - 1) * size + x) * 3 + c] = avg;
    }
  }
  return out;
}

/** Final QA hardening for fabric / leather / powder tiles. */
export function finalizeSeamlessTexture(rgb: Buffer, size: number): Buffer {
  let out = inpaintDarkBorderWedges(rgb, size, 0.08);
  out = flattenIllumination(out, size, "gaussian");
  out = seamlessToroidalWrap(out, size, 0.1);
  // Rim correction MUST be last so wrap doesn't reintroduce border ΔE.
  out = forceBorderNearCenter(out, size, 0.045);
  out = lockOppositeEdges(out, size);
  return out;
}

/**
 * Variance-preserving raised-cosine toroidal edge wrap.
 * Guarantees opposite edges match (3×3 seam-free) while keeping weave grain.
 */
export function seamlessToroidalWrap(rgb: Buffer, size: number, bandFrac = 0.1): Buffer {
  const band = Math.max(4, Math.round(size * bandFrac));
  const f = new Float32Array(size * size * 3);
  for (let i = 0; i < f.length; i++) f[i] = rgb[i]!;

  const raised = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

  const crossBlend = (a: number, b: number, keep: number) => {
    // keep=1 → original a; keep=0 → equal mix with b (seam)
    const wa = keep;
    const wb = 1 - keep;
    const norm = Math.sqrt(wa * wa + wb * wb) || 1;
    const mean = (a + b) / 2;
    const mixed = (wa * a + wb * b) / norm;
    return mean + (mixed - mean);
  };

  for (let y = 0; y < size; y++) {
    for (let i = 0; i < band; i++) {
      const keep = raised((i + 0.5) / band);
      for (let c = 0; c < 3; c++) {
        const iL = (y * size + i) * 3 + c;
        const iR = (y * size + (size - 1 - i)) * 3 + c;
        const L = f[iL]!;
        const R = f[iR]!;
        f[iL] = crossBlend(L, R, keep);
        f[iR] = crossBlend(R, L, keep);
      }
    }
  }
  for (let x = 0; x < size; x++) {
    for (let i = 0; i < band; i++) {
      const keep = raised((i + 0.5) / band);
      for (let c = 0; c < 3; c++) {
        const iT = (i * size + x) * 3 + c;
        const iB = ((size - 1 - i) * size + x) * 3 + c;
        const T = f[iT]!;
        const B = f[iB]!;
        f[iT] = crossBlend(T, B, keep);
        f[iB] = crossBlend(B, T, keep);
      }
    }
  }

  // Hard seam lock — opposite edges identical (QA wrap delta → 0)
  for (let y = 0; y < size; y++) {
    for (let c = 0; c < 3; c++) {
      const avg = (f[y * size * 3 + c]! + f[(y * size + size - 1) * 3 + c]!) / 2;
      f[y * size * 3 + c] = avg;
      f[(y * size + size - 1) * 3 + c] = avg;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let c = 0; c < 3; c++) {
      const avg = (f[x * 3 + c]! + f[((size - 1) * size + x) * 3 + c]!) / 2;
      f[x * 3 + c] = avg;
      f[((size - 1) * size + x) * 3 + c] = avg;
    }
  }

  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < f.length; i++) out[i] = clamp(Math.round(f[i]!), 0, 255);
  return out;
}

function stripeMetrics(rgb: Buffer, size: number) {
  const Ls: number[] = [];
  const col = new Float64Array(size);
  const row = new Float64Array(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const [Lv] = rgbToLab(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!);
      Ls.push(Lv);
      col[x]! += Lv;
      row[y]! += Lv;
    }
  }
  for (let i = 0; i < size; i++) {
    col[i]! /= size;
    row[i]! /= size;
  }
  const meanCol = mean(Array.from(col));
  const meanRow = mean(Array.from(row));
  let vEnergy = 0;
  let hEnergy = 0;
  for (let i = 0; i < size; i++) {
    vEnergy += (col[i]! - meanCol) ** 2;
    hEnergy += (row[i]! - meanRow) ** 2;
  }
  // Autocorr period estimate (vertical stripes → column signal)
  let bestLag = 0;
  let bestScore = -1;
  const signal = Array.from(col).map((v) => v - meanCol);
  for (let lag = 8; lag < size / 3; lag++) {
    let s = 0;
    for (let i = 0; i + lag < size; i++) s += signal[i]! * signal[i + lag]!;
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  Ls.sort((a, b) => a - b);
  const L_p10 = percentile(Ls, 10);
  const L_p90 = percentile(Ls, 90);
  const bimodal = L_p90 - L_p10 > 45;
  const is_striped = bimodal && vEnergy > hEnergy * 1.25;
  return {
    vertical_energy: vEnergy,
    horizontal_energy: hEnergy,
    vertical_period_px: bestLag,
    horizontal_period_px: 0,
    is_striped,
    L_p10,
    L_p90,
    bimodal,
  };
}

function meanLabOpenCvStyle(rgb: Buffer, size: number): number[] {
  let L = 0;
  let a = 0;
  let b = 0;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const lab = rgbToLab(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    // Match prior OpenCV-ish 0–255 Lab used by matcher
    L += (lab[0] / 100) * 255;
    a += (lab[1] * 255) / 256 + 128;
    b += (lab[2] * 255) / 256 + 128;
  }
  return [L / n, a / n, b / n];
}

async function writeJpegSquare(
  rgb: Buffer,
  size: number,
  outPath: string,
  quality: number,
): Promise<void> {
  await sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(outPath);
}

/**
 * Process one studio photo through Steps 1A–1D.
 * `familyHint` selects illumination / seamless strategy; optional sku for Dekton veins.
 */
export async function processStudioPhoto(opts: {
  filePath: string;
  relative: string;
  categoryFolder: string;
  tmpId: string;
  familyHint?: "sunbrella" | "ultraleather" | "dekton" | "powder";
  skuHint?: string;
  stripedHint?: boolean;
}): Promise<CvProcessResult> {
  const buf = fs.readFileSync(opts.filePath);
  const sha1 = crypto.createHash("sha1").update(buf).digest("hex");

  // EXIF-first orientation
  const oriented = sharp(buf).rotate();
  const meta = await oriented.metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;
  if (!fullW || !fullH) {
    throw new Error(`Cannot read dimensions: ${opts.relative}`);
  }

  const workH = Math.round((WORK_W / fullW) * fullH);
  const { data: workRgb, info } = await oriented
    .clone()
    .resize(WORK_W, workH, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const L = new Float32Array(w * h);
  const aCh = new Float32Array(w * h);
  const bCh = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [Lv, av, bv] = rgbToLab(workRgb[i * 3]!, workRgb[i * 3 + 1]!, workRgb[i * 3 + 2]!);
    L[i] = Lv;
    aCh[i] = av;
    bCh[i] = bv;
  }
  const G = sobelMagnitude(L, w, h);
  const tapeMask = buildTapeMask(L, aCh, bCh, G, w, h);
  const veined =
    opts.familyHint === "dekton" ||
    (opts.skuHint ? VEINED_DEKTON.has(opts.skuHint.toUpperCase()) : false);
  const V = buildValidMask(L, aCh, bCh, tapeMask, w, h, {
    striped: opts.stripedHint,
    veined,
  });
  const square = largestInscribedSquare(V, w, h);

  // Additional 8% safety inset (spec 6% + extra margin against frayed/table wedges)
  const inset = Math.floor(square.side * 0.08);
  let sx = square.x + inset;
  let sy = square.y + inset;
  let side = square.side - 2 * inset;
  if (side < 16) {
    sx = square.x;
    sy = square.y;
    side = square.side;
  }

  // Shrink working-grid square until outer 4% strips are free of dark studio wedges
  const darkFrac = (x0: number, y0: number, sidePx: number, which: "t" | "b" | "l" | "r") => {
    const band = Math.max(1, Math.floor(sidePx * 0.04));
    let dark = 0;
    let total = 0;
    const visit = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      if (L[y * w + x]! < 16) dark++;
      total++;
    };
    if (which === "t") {
      for (let yy = y0; yy < y0 + band; yy++) for (let xx = x0; xx < x0 + sidePx; xx++) visit(xx, yy);
    } else if (which === "b") {
      for (let yy = y0 + sidePx - band; yy < y0 + sidePx; yy++)
        for (let xx = x0; xx < x0 + sidePx; xx++) visit(xx, yy);
    } else if (which === "l") {
      for (let yy = y0; yy < y0 + sidePx; yy++) for (let xx = x0; xx < x0 + band; xx++) visit(xx, yy);
    } else {
      for (let yy = y0; yy < y0 + sidePx; yy++)
        for (let xx = x0 + sidePx - band; xx < x0 + sidePx; xx++) visit(xx, yy);
    }
    return total ? dark / total : 0;
  };
  const coreL = (() => {
    const samples: number[] = [];
    for (let yy = sy + Math.floor(side * 0.35); yy < sy + Math.floor(side * 0.65); yy++) {
      for (let xx = sx + Math.floor(side * 0.35); xx < sx + Math.floor(side * 0.65); xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) samples.push(L[yy * w + xx]!);
      }
    }
    return mean(samples);
  })();
  if (coreL > 28) {
    for (let iter = 0; iter < 12; iter++) {
      const bad =
        darkFrac(sx, sy, side, "t") >= 0.003 ||
        darkFrac(sx, sy, side, "b") >= 0.003 ||
        darkFrac(sx, sy, side, "l") >= 0.003 ||
        darkFrac(sx, sy, side, "r") >= 0.003;
      if (!bad || side < 32) break;
      const shrink = Math.max(2, Math.floor(side * 0.04));
      sx += shrink;
      sy += shrink;
      side -= 2 * shrink;
    }
  }

  // Map to full-res — prefer exact safe square (no expand that reintroduces table wedges)
  const scaleX = fullW / w;
  const scaleY = fullH / h;
  let fx = Math.round(sx * scaleX);
  let fy = Math.round(sy * scaleY);
  let fside = Math.round(side * Math.min(scaleX, scaleY));
  fside = Math.min(fside, fullW - fx, fullH - fy);

  const extract = await sharp(buf)
    .rotate()
    .extract({ left: fx, top: fy, width: fside, height: fside })
    .resize(2048, 2048, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha()
    .raw()
    .toBuffer();

  const family = opts.familyHint ?? "sunbrella";
  const flatMode = family === "dekton" || veined ? "plane" : "gaussian";
  let processed =
    family === "dekton" || veined
      ? flattenIllumination(extract, 2048, "plane")
      : finalizeSeamlessTexture(extract, 2048);
  void flatMode;

  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });

  const texturePath = path.join(TEXTURE_DIR, `${opts.tmpId}.jpg`);
  const thumbPath = path.join(THUMB_DIR, `${opts.tmpId}.jpg`);
  await writeJpegSquare(processed, 2048, texturePath, 92);
  const thumbRgb = await sharp(processed, { raw: { width: 2048, height: 2048, channels: 3 } })
    .resize(512, 512, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
  await writeJpegSquare(thumbRgb, 512, thumbPath, 90);

  // Overlay preview with crop rect
  const overlayPath = path.join(OVERLAY_DIR, `${opts.tmpId}.jpg`);
  const preview = await sharp(buf).rotate().resize(900, 900, { fit: "inside" }).toBuffer({
    resolveWithObject: true,
  });
  const pw = preview.info.width;
  const ph = preview.info.height;
  const svg = Buffer.from(
    `<svg width="${pw}" height="${ph}"><rect x="${(fx / fullW) * pw}" y="${(fy / fullH) * ph}" width="${(fside / fullW) * pw}" height="${(fside / fullH) * ph}" fill="none" stroke="#22c55e" stroke-width="4"/></svg>`,
  );
  await sharp(preview.data)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 80 })
    .toFile(overlayPath);
  const overlayBuf = overlayPath;

  const stripe = stripeMetrics(processed, 2048);
  const lab = meanLabOpenCvStyle(processed, 2048);

  return {
    source_file: opts.filePath,
    relative: opts.relative,
    category_folder: opts.categoryFolder,
    sha1,
    pixels_per_inch: null,
    ppi_method: "uniform_family_scale",
    deskew_deg: 0,
    crop_box: { x: fx, y: fy, side: fside },
    cropped_width_in: 8,
    overlay_path: overlayBuf,
    tmp_id: opts.tmpId,
    texture_path: texturePath,
    thumb_path: thumbPath,
    lab,
    stripe,
  };
}

/** High-realism woven Sunbrella Cabana Classic 2048² (2× 7" vertical stripe repeats). */
export async function synthesizeCabanaClassic(outSku = "FAB-CAB-CLA"): Promise<{
  texture_path: string;
  thumb_path: string;
  overlay_path: string;
  lab: number[];
  stripe: ReturnType<typeof stripeMetrics>;
}> {
  const size = 2048;
  const rgb = Buffer.alloc(size * size * 3);
  const black = [0x18, 0x19, 0x1b];
  const white = [0xf2, 0xf1, 0xec];
  // 2 full 7" repeats across 2048 → period = 1024px (each 7" = 1024px for 14" tile)
  const period = size / 2; // 1024
  const half = period / 2; // 512 black + 512 white per 7"

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const phase = x % period;
      const isBlack = phase < half;
      // Micro woven twill relief
      const twill = ((x + y * 2) % 4 === 0 ? 1 : 0) * (isBlack ? 6 : -5);
      const yarn = ((x * 3 + y) % 7 === 0 ? 1 : 0) * (isBlack ? 4 : -3);
      const base = isBlack ? black : white;
      const i = (y * size + x) * 3;
      rgb[i] = clamp(base[0]! + twill + yarn, 0, 255);
      rgb[i + 1] = clamp(base[1]! + twill + yarn, 0, 255);
      rgb[i + 2] = clamp(base[2]! + twill + yarn, 0, 255);
    }
  }

  // Integer stripe periods already tile seamlessly — do NOT cross-blend L/R (would grey stripes).
  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });
  const texture_path = path.join(TEXTURE_DIR, `${outSku}.jpg`);
  const thumb_path = path.join(THUMB_DIR, `${outSku}.jpg`);
  await writeJpegSquare(rgb, 2048, texture_path, 92);
  const thumbRgb = await sharp(rgb, { raw: { width: 2048, height: 2048, channels: 3 } })
    .resize(512, 512, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
  await writeJpegSquare(thumbRgb, 512, thumb_path, 90);

  // Synthetic overlay badge
  const overlay_path = path.join(OVERLAY_DIR, `${outSku}.jpg`);
  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 24, g: 25, b: 27 },
    },
  })
    .composite([
      {
        input: await sharp(rgb, { raw: { width: 2048, height: 2048, channels: 3 } })
          .resize(400, 400)
          .jpeg()
          .toBuffer(),
        left: 120,
        top: 40,
      },
    ])
    .jpeg({ quality: 85 })
    .toFile(overlay_path);

  return {
    texture_path,
    thumb_path,
    overlay_path,
    lab: meanLabOpenCvStyle(rgb, 2048),
    stripe: stripeMetrics(rgb, 2048),
  };
}

/** Solid / leather / powder synthetic fallback tile. */
export async function synthesizeSolidTexture(opts: {
  sku: string;
  hex: string;
  kind: "ultraleather" | "powder" | "dekton" | "fabric";
}): Promise<{ texture_path: string; thumb_path: string; overlay_path: string; lab: number[] }> {
  const size = 2048;
  const r = parseInt(opts.hex.slice(1, 3), 16);
  const g = parseInt(opts.hex.slice(3, 5), 16);
  const b = parseInt(opts.hex.slice(5, 7), 16);
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain =
        opts.kind === "ultraleather"
          ? ((Math.sin(x * 0.35) * Math.cos(y * 0.31) + Math.sin((x + y) * 0.11)) * 4) | 0
          : opts.kind === "powder"
            ? (((x * 13 + y * 7) % 5) - 2)
            : opts.kind === "dekton"
              ? ((Math.sin(x * 0.01 + y * 0.007) * 12 + Math.sin(x * 0.04) * 5) | 0)
              : (((x * 3 + y * 5) % 7) - 3);
      const i = (y * size + x) * 3;
      rgb[i] = clamp(r + grain, 0, 255);
      rgb[i + 1] = clamp(g + grain, 0, 255);
      rgb[i + 2] = clamp(b + grain, 0, 255);
    }
  }
  const processed = opts.kind === "dekton" ? rgb : finalizeSeamlessTexture(rgb, size);

  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });
  const texture_path = path.join(TEXTURE_DIR, `${opts.sku}.jpg`);
  const thumb_path = path.join(THUMB_DIR, `${opts.sku}.jpg`);
  await writeJpegSquare(processed, 2048, texture_path, 92);
  const thumbRgb = await sharp(processed, { raw: { width: 2048, height: 2048, channels: 3 } })
    .resize(512, 512, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
  await writeJpegSquare(thumbRgb, 512, thumb_path, 90);
  const overlay_path = path.join(OVERLAY_DIR, `${opts.sku}.jpg`);
  await sharp(processed, { raw: { width: 2048, height: 2048, channels: 3 } })
    .resize(512, 512)
    .jpeg({ quality: 80 })
    .toFile(overlay_path);
  return {
    texture_path,
    thumb_path,
    overlay_path,
    lab: meanLabOpenCvStyle(processed, 2048),
  };
}

export async function listRawStudioPhotos(): Promise<
  Array<{ filePath: string; relative: string; categoryFolder: string }>
> {
  const out: Array<{ filePath: string; relative: string; categoryFolder: string }> = [];
  if (!fs.existsSync(RAW_ROOT)) return out;
  for (const folder of ["Fabrics", "Dekton", "PowderCoat"]) {
    const dir = path.join(RAW_ROOT, folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;
      out.push({
        filePath: path.join(dir, name),
        relative: `${folder}/${name}`,
        categoryFolder: folder,
      });
    }
  }
  return out;
}

export { rgbToLab, stripeMetrics };
