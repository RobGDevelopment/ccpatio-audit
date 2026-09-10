#!/usr/bin/env python3
"""
Mesh OBB stick-fitter (Python / trimesh) — optional fallback when Node path
is insufficient. Prefer scripts/diagnostics/mesh-obb-sticks.ts in CI.

Usage:
  pip install trimesh numpy
  python scripts/diagnostics/mesh_obb_sticks.py [path/to/model.glb]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import numpy as np
    import trimesh
except ImportError as exc:
    raise SystemExit(
        "Install trimesh + numpy: pip install trimesh numpy\n"
        f"Original error: {exc}"
    ) from exc


def to_inches(extents: np.ndarray) -> np.ndarray:
    longest = float(np.max(extents))
    scale = 39.3701 if 0 < longest < 5 else 1.0
    return extents * scale


def stick_candidate(name: str, extents_in: np.ndarray) -> dict | None:
    dims = np.sort(extents_in)
    short, mid, long = map(float, dims)
    if long < 6 or long > 120:
        return None
    if long / max(mid, 0.01) < 3.5:
        return None
    profile = "SQ2-16"
    width = 2.0
    if short < 0.4 and 1.0 < mid < 2.2:
        profile = "FB0.125x1.5"
        width = 1.5
    elif abs(mid - 1.5) < 0.4 and abs(short - 0.75) < 0.35:
        profile = "RT1.5x0.75-16"
        width = 1.5
    length = round(long * 2) / 2
    return {
        "definitionName": f'{name} {profile} {length}" 90 90',
        "parentAsmName": None,
        "instanceCount": 1,
        "nameLengthIn": length,
        "obbLengthIn": round(long, 3),
        "endA": 90,
        "endB": 90,
        "profile": profile,
        "profileWidthIn": width,
        "materialName": None,
        "confidence": "low",
    }


def extract(glb_path: Path) -> dict:
    scene = trimesh.load(glb_path, force="scene")
    sticks = []
    if isinstance(scene, trimesh.Scene):
        geoms = scene.geometry.items()
        bounds = scene.bounds
    else:
        geoms = [("mesh", scene)]
        bounds = scene.bounds

    for name, geom in geoms:
        if not hasattr(geom, "extents"):
            continue
        extents_in = to_inches(np.asarray(geom.extents, dtype=float))
        stick = stick_candidate(str(name), extents_in)
        if stick:
            sticks.append(stick)

    size = to_inches(np.asarray(bounds[1] - bounds[0], dtype=float))
    ordered = sorted(map(float, size), reverse=True)
    return {
        "sourceFile": str(glb_path),
        "exportedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "productHint": glb_path.stem,
        "overall": {
            "lengthIn": round(ordered[0], 1),
            "depthIn": round(ordered[1], 1),
            "heightIn": round(ordered[2], 1),
        },
        "assemblies": [],
        "sticks": sticks,
        "flags": [
            "mesh_obb_fallback_python_trimesh",
            "mitres_defaulted_to_90_90",
        ],
        "auditBucket": "exploded_soup",
    }


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "3d-sandbox/public/models/bravada-swivel.glb"
    if not target.exists():
        raise SystemExit(f"GLB not found: {target}")
    payload = extract(target)
    out_dir = root / "scripts/diagnostics/cutlist-exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{target.stem}.mesh-obb-py.cutlist.json"
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"OBB sticks={len(payload['sticks'])} → {out}")


if __name__ == "__main__":
    main()
