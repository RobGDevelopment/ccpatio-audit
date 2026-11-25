#!/usr/bin/env python3
"""
High-rez finish CV helper: tape-measure PPI, safe square crop, deskew, flatten.
Invoked by process-highrez-finishes.ts. Writes processed textures/thumbs + JSON stdout.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

STAGING = Path(r"C:\Workspace\ccpatio-media-staging")
RAW_ROOT = STAGING / "HighRezImages"
OUT_ROOT = STAGING / "processed"
TEXTURE_DIR = OUT_ROOT / "textures"
THUMB_DIR = OUT_ROOT / "thumbs"
OVERLAY_DIR = OUT_ROOT / "overlays"
WORK_DIR = OUT_ROOT / "_work"


def ensure_dirs() -> None:
    for d in (TEXTURE_DIR, THUMB_DIR, OVERLAY_DIR, WORK_DIR):
        d.mkdir(parents=True, exist_ok=True)


def file_sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def detect_yellow_mask(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    # Stanley yellow tape — tolerant under studio light
    lower = np.array([15, 80, 80], dtype=np.uint8)
    upper = np.array([45, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower, upper)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return mask


def estimate_pixels_per_inch(bgr: np.ndarray, yellow: np.ndarray) -> tuple[float | None, str]:
    """Estimate PPI from yellow tape tick periodicity (projection autocorrelation)."""
    ys, xs = np.where(yellow > 0)
    if len(xs) < 500:
        return None, "no_tape"

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    band_w = max(8, x1 - x0 + 1)
    band_h = max(8, y1 - y0 + 1)
    vertical = band_h >= band_w

    if vertical:
        # Sample a thin column through the tape
        cx = int(np.median(xs))
        col = bgr[y0:y1, max(0, cx - 6) : min(bgr.shape[1], cx + 7)]
        if col.size == 0:
            return None, "empty_band"
        gray = cv2.cvtColor(col, cv2.COLOR_BGR2GRAY).astype(np.float32)
        signal = gray.mean(axis=1)
    else:
        cy = int(np.median(ys))
        row = bgr[max(0, cy - 6) : min(bgr.shape[0], cy + 7), x0:x1]
        if row.size == 0:
            return None, "empty_band"
        gray = cv2.cvtColor(row, cv2.COLOR_BGR2GRAY).astype(np.float32)
        signal = gray.mean(axis=0)

    signal = signal - signal.mean()
    if signal.std() < 1e-3:
        return None, "flat_signal"

    # Autocorrelation peaks ≈ tick spacing; Stanley inches have major ticks every 1"
    # Prefer lags corresponding to ~0.5–2.5" assuming PPI in 150–900 range.
    n = len(signal)
    fft = np.fft.rfft(signal)
    ac = np.fft.irfft(fft * np.conj(fft)).real
    ac = ac[: n // 2]
    ac[0] = 0
    # Smooth
    if len(ac) > 11:
        ac = cv2.GaussianBlur(ac.reshape(-1, 1), (0, 0), 2).ravel()

    best_lag = None
    best_score = -1.0
    for lag in range(20, min(len(ac) - 1, 900)):
        score = float(ac[lag])
        if score > best_score:
            best_score = score
            best_lag = lag

    if best_lag is None or best_score <= 0:
        return None, "no_period"

    # Heuristic: strongest lag is often 1/8" or 1/16" or 1". Try candidates.
    candidates_inches = [1.0, 0.5, 0.25, 0.125, 0.0625]
    # Also use local maxima list
    peaks = []
    for i in range(20, len(ac) - 1):
        if ac[i] > ac[i - 1] and ac[i] >= ac[i + 1] and ac[i] > best_score * 0.35:
            peaks.append(i)
    if not peaks:
        peaks = [best_lag]

    best_ppi = None
    best_err = 1e18
    # Prefer PPI in a plausible studio range
    for lag in peaks[:40]:
        for inches in candidates_inches:
            ppi = lag / inches
            if 80 <= ppi <= 1200:
                # Prefer ~200–700 for these cameras
                err = abs(ppi - 400) + (0 if inches in (1.0, 0.125) else 40)
                if err < best_err:
                    best_err = err
                    best_ppi = ppi

    if best_ppi is None:
        # Fallback: assume strongest lag = 1/8 inch
        best_ppi = best_lag / 0.125
        if not (80 <= best_ppi <= 1200):
            best_ppi = best_lag / 1.0

    return float(best_ppi), "tape_autocorr"


def sample_mask(bgr: np.ndarray, yellow: np.ndarray) -> np.ndarray:
    """Mask the material sample: not dark table, not white base, not yellow tape."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    s = hsv[:, :, 1]
    # Dark studio table / backdrop
    dark = (v < 45) & (s < 80)
    # Bright white base sometimes under Dekton
    white = (v > 210) & (s < 40)
    mask = (~dark) & (~white) & (yellow == 0)
    mask_u8 = (mask.astype(np.uint8) * 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask_u8 = cv2.morphologyEx(mask_u8, cv2.MORPH_OPEN, kernel, iterations=1)
    # Keep largest connected component
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask_u8, connectivity=8)
    if n <= 1:
        return mask_u8
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = 1 + int(np.argmax(areas))
    out = np.zeros_like(mask_u8)
    out[labels == largest] = 255
    return out


def detect_grommet_band(bgr: np.ndarray, sample: np.ndarray) -> int:
    """Return extra top inset (px) if metal grommets/clips detected near top of sample."""
    ys, xs = np.where(sample > 0)
    if len(ys) == 0:
        return 0
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    h = y1 - y0 + 1
    band_h = max(20, int(h * 0.18))
    roi = bgr[y0 : y0 + band_h, x0:x1]
    if roi.size == 0:
        return 0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    # Bright circular-ish blobs
    blur = cv2.GaussianBlur(gray, (9, 9), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Metal is bright; count bright pixels
    bright_ratio = float((gray > 180).mean())
    if bright_ratio > 0.01:
        return int(band_h * 0.85)
    # Hole (powder coat punch) — dark circle
    dark_ratio = float((gray < 40).mean())
    if dark_ratio > 0.02:
        return int(band_h * 0.5)
    return 0


def estimate_skew_deg(sample: np.ndarray, bgr: np.ndarray) -> float:
    """Deskew using Canny + Hough on sample interior; prefer near-vertical/horizontal lines."""
    ys, xs = np.where(sample > 0)
    if len(xs) < 100:
        return 0.0
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    roi = bgr[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, threshold=max(80, edges.shape[0] // 8))
    if lines is None:
        return 0.0
    angles = []
    for rho_theta in lines[:80]:
        rho, theta = rho_theta[0]
        deg = math.degrees(theta)  # 0 = vertical line in OpenCV? Actually 0 = horizontal normal
        # Convert to line orientation relative to vertical stripes / edges
        # theta=0 → vertical line; theta=pi/2 → horizontal
        orient = deg  # degrees from vertical axis for the line
        # Fold to [-45, 45] relative to nearest axis
        for base in (0.0, 90.0):
            d = orient - base
            while d > 45:
                d -= 90
            while d < -45:
                d += 90
            if abs(d) < 12:
                angles.append(d)
    if not angles:
        return 0.0
    return float(np.median(angles))


def rotate_image(bgr: np.ndarray, angle_deg: float) -> np.ndarray:
    if abs(angle_deg) < 0.05:
        return bgr
    h, w = bgr.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    return cv2.warpAffine(bgr, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def safe_square_crop(
    bgr: np.ndarray,
    sample: np.ndarray,
    yellow: np.ndarray,
    inset_frac: float = 0.09,
) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """Centered interior square with safety inset; mask tape/grommets/edges."""
    # Expand yellow slightly so tape shadow is excluded
    dil = cv2.dilate(yellow, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)), iterations=1)
    usable = (sample > 0) & (dil == 0)
    ys, xs = np.where(usable)
    if len(xs) < 100:
        ys, xs = np.where(sample > 0)
    if len(xs) < 100:
        h, w = bgr.shape[:2]
        side = int(min(h, w) * 0.7)
        x0 = (w - side) // 2
        y0 = (h - side) // 2
        return bgr[y0 : y0 + side, x0 : x0 + side].copy(), (x0, y0, side, side)

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    grommet_extra = detect_grommet_band(bgr, sample)
    y0 = min(y1 - 10, y0 + grommet_extra)

    bw = x1 - x0 + 1
    bh = y1 - y0 + 1
    inset_x = int(bw * inset_frac)
    inset_y = int(bh * inset_frac)
    x0 += inset_x
    x1 -= inset_x
    y0 += inset_y
    y1 -= inset_y
    bw = max(32, x1 - x0 + 1)
    bh = max(32, y1 - y0 + 1)
    side = min(bw, bh)
    # Center square in usable rect
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    sx0 = max(0, cx - side // 2)
    sy0 = max(0, cy - side // 2)
    sx1 = min(bgr.shape[1], sx0 + side)
    sy1 = min(bgr.shape[0], sy0 + side)
    side = min(sx1 - sx0, sy1 - sy0)
    crop = bgr[sy0 : sy0 + side, sx0 : sx0 + side].copy()
    return crop, (sx0, sy0, side, side)


def flatten_illumination(bgr: np.ndarray) -> np.ndarray:
    """Remove vignette / hotspot so tiled cushions don't checkerboard."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    l = lab[:, :, 0]
    # Large Gaussian approximates low-frequency lighting
    k = max(31, (min(bgr.shape[:2]) // 8) | 1)
    blur = cv2.GaussianBlur(l, (k, k), 0)
    blur = np.maximum(blur, 1.0)
    mean_l = float(l.mean())
    l2 = l / blur * mean_l
    lab[:, :, 0] = np.clip(l2, 0, 255)
    out = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    return out


def seam_soften(bgr: np.ndarray, strength: float = 0.35) -> np.ndarray:
    """Subtle edge blend for solid weaves / stone / powder so 3x3 tiles soft-join."""
    h, w = bgr.shape[:2]
    band = max(4, int(min(h, w) * 0.02))
    out = bgr.astype(np.float32)
    # Average opposite edges into a soft ramp
    for i in range(band):
        a = (i + 1) / (band + 1) * strength
        top = out[i]
        bot = out[h - 1 - i]
        mix = top * (1 - a) + bot * a
        out[i] = mix
        out[h - 1 - i] = bot * (1 - a) + top * a
        left = out[:, i]
        right = out[:, w - 1 - i]
        mixc = left * (1 - a) + right * a
        out[:, i] = mixc
        out[:, w - 1 - i] = right * (1 - a) + left * a
    return np.clip(out, 0, 255).astype(np.uint8)


def stripe_score(bgr: np.ndarray) -> dict:
    """Simple vertical/horizontal stripe / weave metrics for matching."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray = gray - gray.mean()
    # Column / row energy
    col = gray.mean(axis=0)
    row = gray.mean(axis=1)
    col_fft = np.abs(np.fft.rfft(col))
    row_fft = np.abs(np.fft.rfft(row))
    col_fft[0] = 0
    row_fft[0] = 0
    v_peak = float(col_fft.max()) if col_fft.size else 0.0
    h_peak = float(row_fft.max()) if row_fft.size else 0.0
    # Dominant period in px
    v_period = int(np.argmax(col_fft)) if col_fft.size else 0
    h_period = int(np.argmax(row_fft)) if row_fft.size else 0
    # if period index i → wavelength ~ n/i
    n = len(col)
    v_wave = (n / v_period) if v_period > 0 else 0.0
    h_wave = (len(row) / h_period) if h_period > 0 else 0.0
    return {
        "vertical_energy": v_peak,
        "horizontal_energy": h_peak,
        "vertical_period_px": float(v_wave),
        "horizontal_period_px": float(h_wave),
        "is_striped": bool(v_peak > h_peak * 1.35 and v_peak > 50),
    }


def mean_lab(bgr: np.ndarray) -> list[float]:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    m = lab.reshape(-1, 3).mean(axis=0)
    return [float(m[0]), float(m[1]), float(m[2])]


def write_outputs(sku_or_tmp: str, crop_bgr: np.ndarray, soften: bool) -> dict:
    flat = flatten_illumination(crop_bgr)
    if soften:
        flat = seam_soften(flat)
    tex = cv2.resize(flat, (2048, 2048), interpolation=cv2.INTER_AREA)
    thumb = cv2.resize(flat, (512, 512), interpolation=cv2.INTER_AREA)
    tex_path = TEXTURE_DIR / f"{sku_or_tmp}.jpg"
    thumb_path = THUMB_DIR / f"{sku_or_tmp}.jpg"
    cv2.imwrite(str(tex_path), tex, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    cv2.imwrite(str(thumb_path), thumb, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    return {
        "texture_path": str(tex_path),
        "thumb_path": str(thumb_path),
        "texture_w": 2048,
        "texture_h": 2048,
        "thumb_w": 512,
        "thumb_h": 512,
        "lab": mean_lab(tex),
        "stripe": stripe_score(tex),
    }


def draw_overlay(bgr: np.ndarray, box: tuple[int, int, int, int], path: Path) -> None:
    vis = bgr.copy()
    x, y, s, _ = box
    cv2.rectangle(vis, (x, y), (x + s, y + s), (0, 255, 0), max(4, s // 200))
    # Downscale for QA
    scale = 900 / max(vis.shape[:2])
    small = cv2.resize(vis, (int(vis.shape[1] * scale), int(vis.shape[0] * scale)))
    cv2.imwrite(str(path), small, [int(cv2.IMWRITE_JPEG_QUALITY), 80])


def process_one(path: Path, category: str, tmp_id: str) -> dict:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Failed to read {path}")
    h, w = bgr.shape[:2]
    yellow = detect_yellow_mask(bgr)
    ppi, ppi_method = estimate_pixels_per_inch(bgr, yellow)
    sample = sample_mask(bgr, yellow)
    skew = estimate_skew_deg(sample, bgr)
    # Rotate so stripes/edges → 0°
    rotated = rotate_image(bgr, -skew)
    yellow_r = detect_yellow_mask(rotated)
    sample_r = sample_mask(rotated, yellow_r)
    # Re-estimate PPI after rotation if needed
    if ppi is None:
        ppi, ppi_method = estimate_pixels_per_inch(rotated, yellow_r)
    if ppi is None:
        # Fallback default for this camera body (~8640 wide, ~8–12" samples)
        ppi = 480.0
        ppi_method = "fallback_default_480"

    inset = 0.09
    crop, box = safe_square_crop(rotated, sample_r, yellow_r, inset_frac=inset)
    cropped_width_in = (box[2] / ppi) if ppi else None

    # Solids (powder/dekton/plain weave) get seam soften; striped fabrics skip heavy soften
    stripe = stripe_score(crop)
    soften = category in ("Dekton", "PowderCoat") or not stripe["is_striped"]

    outs = write_outputs(tmp_id, crop, soften=soften)
    overlay_path = OVERLAY_DIR / f"{tmp_id}.jpg"
    draw_overlay(rotated, box, overlay_path)

    return {
        "source_file": str(path),
        "relative": str(path.relative_to(RAW_ROOT)).replace("\\", "/"),
        "category_folder": category,
        "sha1": file_sha1(path),
        "image_w": w,
        "image_h": h,
        "pixels_per_inch": round(float(ppi), 3) if ppi else None,
        "ppi_method": ppi_method,
        "deskew_deg": round(float(skew), 3),
        "crop_box": {"x": box[0], "y": box[1], "side": box[2]},
        "cropped_width_in": round(float(cropped_width_in), 3) if cropped_width_in else None,
        "inset_frac": inset,
        "overlay_path": str(overlay_path),
        "tmp_id": tmp_id,
        **outs,
    }


def synthesize(
    sku: str,
    hex_color: str,
    kind: str,
    repeat_inches: float,
    texture_scale: float,
) -> dict:
    """Generate clean 2048/512 fallback tiles."""
    rgb = tuple(int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    base = np.zeros((2048, 2048, 3), dtype=np.uint8)
    base[:, :] = (rgb[2], rgb[1], rgb[0])  # BGR

    rng = np.random.default_rng(abs(hash(sku)) % (2**32))
    if kind == "ultraleather":
        # Pebble-grain leather
        noise = rng.normal(0, 10, (2048, 2048)).astype(np.float32)
        noise = cv2.GaussianBlur(noise, (0, 0), 2.5)
        pebble = rng.normal(0, 18, (512, 512)).astype(np.float32)
        pebble = cv2.resize(pebble, (2048, 2048), interpolation=cv2.INTER_CUBIC)
        pebble = cv2.GaussianBlur(pebble, (0, 0), 1.2)
        for c in range(3):
            ch = base[:, :, c].astype(np.float32) + noise + pebble * 0.6
            base[:, :, c] = np.clip(ch, 0, 255).astype(np.uint8)
        base = seam_soften(base, 0.4)
    elif kind == "powder":
        stipple = rng.normal(0, 7, (2048, 2048)).astype(np.float32)
        micro = rng.integers(0, 2, (2048, 2048), dtype=np.uint8).astype(np.float32) * 4
        for c in range(3):
            ch = base[:, :, c].astype(np.float32) + stipple + micro
            base[:, :, c] = np.clip(ch, 0, 255).astype(np.uint8)
        base = seam_soften(base, 0.45)
    else:  # dekton / stone
        grain = rng.normal(0, 14, (2048, 2048)).astype(np.float32)
        grain = cv2.GaussianBlur(grain, (0, 0), 1.8)
        veins = rng.normal(0, 1, (256, 256)).astype(np.float32)
        veins = cv2.resize(veins, (2048, 2048), interpolation=cv2.INTER_CUBIC)
        veins = cv2.GaussianBlur(veins, (0, 0), 6) * 22
        for c in range(3):
            ch = base[:, :, c].astype(np.float32) + grain + veins * (0.7 if c == 0 else 0.5)
            base[:, :, c] = np.clip(ch, 0, 255).astype(np.uint8)
        base = seam_soften(base, 0.4)

    outs = write_outputs(sku, base, soften=False)
    # Synthetic overlay badge placeholder — solid color card
    badge = np.zeros((600, 800, 3), dtype=np.uint8)
    badge[:] = (40, 40, 40)
    cv2.putText(
        badge,
        "SYNTHETIC FALLBACK",
        (60, 280),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.2,
        (0, 220, 255),
        3,
        cv2.LINE_AA,
    )
    cv2.putText(
        badge,
        sku,
        (60, 360),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (220, 220, 220),
        2,
        cv2.LINE_AA,
    )
    overlay_path = OVERLAY_DIR / f"{sku}.jpg"
    cv2.imwrite(str(overlay_path), badge, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    return {
        "sku": sku,
        "source_type": "synthetic_fallback",
        "hex": hex_color,
        "kind": kind,
        "pixels_per_inch": 2048 / repeat_inches if repeat_inches else None,
        "cropped_width_in": repeat_inches,
        "repeat_inches": repeat_inches,
        "texture_scale": texture_scale,
        "overlay_path": str(overlay_path),
        **outs,
    }


def list_raw() -> list[tuple[Path, str]]:
    out = []
    for folder in ("Dekton", "Fabrics", "PowderCoat"):
        d = RAW_ROOT / folder
        if not d.is_dir():
            continue
        for p in sorted(d.iterdir()):
            if p.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                out.append((p, folder))
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["process", "synthesize", "hash"], default="process")
    parser.add_argument("--json-in", default="")
    parser.add_argument("--out-json", default=str(OUT_ROOT / "cv-results.json"))
    args = parser.parse_args()
    ensure_dirs()

    if args.mode == "hash":
        rows = []
        for path, folder in list_raw():
            rows.append(
                {
                    "relative": str(path.relative_to(RAW_ROOT)).replace("\\", "/"),
                    "category_folder": folder,
                    "sha1": file_sha1(path),
                    "bytes": path.stat().st_size,
                }
            )
        print(json.dumps({"files": rows}, indent=2))
        return 0

    if args.mode == "synthesize":
        specs = json.loads(Path(args.json_in).read_text(encoding="utf-8"))
        results = []
        for spec in specs:
            results.append(
                synthesize(
                    spec["sku"],
                    spec["hex"],
                    spec["kind"],
                    float(spec.get("repeat_inches", 8.0)),
                    float(spec.get("texture_scale", 1.0)),
                )
            )
        Path(args.out_json).write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(json.dumps({"synthesized": len(results), "out": args.out_json}))
        return 0

    # process all raw
    results = []
    for i, (path, folder) in enumerate(list_raw()):
        tmp_id = f"tmp_{folder}_{i:03d}"
        print(f"[cv] {path.name} …", file=sys.stderr)
        try:
            results.append(process_one(path, folder, tmp_id))
        except Exception as e:
            results.append(
                {
                    "source_file": str(path),
                    "relative": str(path.relative_to(RAW_ROOT)).replace("\\", "/"),
                    "category_folder": folder,
                    "error": str(e),
                    "sha1": file_sha1(path),
                }
            )
    Path(args.out_json).write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps({"processed": len(results), "out": args.out_json}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
