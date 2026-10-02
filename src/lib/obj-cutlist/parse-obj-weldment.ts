/**
 * One-pass OBJ group walker for SketchUp website models (units = inches).
 * Stick dimensions come from hexahedron boundary edges, not the world AABB.
 * A 45° cut face (section × √2) is discarded. Unequal long edges are the
 * long point and the short point.
 */

export type CutEnd = 45 | 90;

export type EdgeCluster = {
  lengthIn: number;
  count: number;
};

export type ObjStick = {
  group: string;
  material: string;
  sectionMajorIn: number;
  sectionMinorIn: number;
  longPointIn: number;
  shortPointIn: number | null;
  endA: CutEnd;
  endB: CutEnd;
  lengthConvention: "long_point" | "square";
  /** More than two distinct long-edge lengths (compound mitre). */
  compoundLongEdges: boolean;
  edgesIn: EdgeCluster[];
  droppedMiterFacesIn: number[];
};

export type OmittedGroup = {
  group: string;
  reason: string;
  faces: number;
};

export type ObjWeldmentParse = {
  units: string | null;
  groupCount: number;
  sticks: ObjStick[];
  omittedStickLike: OmittedGroup[];
  largestExtentIn: number;
};

type Vec3 = [number, number, number];

type GroupAcc = {
  name: string;
  material: string;
  faces: number[][];
};

const SQRT2 = Math.SQRT2;
const MIN_STICK_IN = 4;
const MIN_ASPECT = 2.5;
const MAX_SECTION_IN = 6.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function quant(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function posKey(v: Vec3): string {
  return `${quant(v[0])},${quant(v[1])},${quant(v[2])}`;
}

function faceIndex(token: string, vertCount: number): number | null {
  const raw = token.split("/")[0];
  if (!raw) return null;
  let idx = Number(raw);
  if (!Number.isFinite(idx) || idx === 0) return null;
  if (idx < 0) idx = vertCount + idx + 1;
  if (idx < 1 || idx > vertCount) return null;
  return idx;
}

function readUnits(text: string): string | null {
  const match = text.match(/File units\s*=\s*([A-Za-z]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function clusterEdges(lengths: number[]): EdgeCluster[] {
  const sorted = [...lengths].sort((a, b) => a - b);
  const buckets: Array<{ sum: number; count: number }> = [];
  for (const length of sorted) {
    const last = buckets[buckets.length - 1];
    const center = last ? last.sum / last.count : 0;
    const tol = center < 0.2 || length < 0.2 ? 0.02 : 0.08;
    if (last && Math.abs(length - center) <= tol) {
      last.sum += length;
      last.count += 1;
    } else {
      buckets.push({ sum: length, count: 1 });
    }
  }
  return buckets.map((bucket) => ({
    lengthIn: round2(bucket.sum / bucket.count),
    count: bucket.count,
  }));
}

function isMiterFace(larger: number, smaller: number): boolean {
  if (larger > 4.5 || smaller > 4.5 || smaller < 0.05) return false;
  const ratio = larger / smaller;
  return Math.abs(ratio - SQRT2) / SQRT2 <= 0.08;
}

function dropMiterFaces(clusters: EdgeCluster[]): {
  kept: EdgeCluster[];
  dropped: EdgeCluster[];
} {
  const droppedIdx = new Set<number>();
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = 0; j < clusters.length; j += 1) {
      if (i === j) continue;
      const a = clusters[i]!;
      const b = clusters[j]!;
      if (a.lengthIn <= b.lengthIn) continue;
      if (isMiterFace(a.lengthIn, b.lengthIn)) droppedIdx.add(i);
    }
  }
  return {
    kept: clusters.filter((_, index) => !droppedIdx.has(index)),
    dropped: clusters.filter((_, index) => droppedIdx.has(index)),
  };
}

function mitreEnds(
  delta: number,
  sectionWidths: number[],
): { ends: 0 | 1 | 2 } {
  let best: 0 | 1 | 2 = 0;
  let bestErr = Infinity;
  for (const width of sectionWidths) {
    if (width <= 0) continue;
    const tol = Math.max(0.15, width * 0.12);
    const twoErr = Math.abs(delta - 2 * width);
    const oneErr = Math.abs(delta - width);
    if (twoErr <= tol && twoErr < bestErr) {
      best = 2;
      bestErr = twoErr;
    }
    if (oneErr <= tol && oneErr < bestErr) {
      best = 1;
      bestErr = oneErr;
    }
  }
  return { ends: best };
}

function endsFromMiterFace(miterEdgeCount: number): {
  endA: CutEnd;
  endB: CutEnd;
} {
  if (miterEdgeCount >= 4) return { endA: 45, endB: 45 };
  if (miterEdgeCount >= 2) return { endA: 45, endB: 90 };
  return { endA: 90, endB: 90 };
}

function classifyPrism(clusters: EdgeCluster[]): {
  sectionMajorIn: number;
  sectionMinorIn: number;
  longPointIn: number;
  shortPointIn: number | null;
  endA: CutEnd;
  endB: CutEnd;
  lengthConvention: "long_point" | "square";
  compoundLongEdges: boolean;
  droppedMiterFacesIn: number[];
} | null {
  const edgeTotal = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  if (edgeTotal < 12 || edgeTotal > 16) return null;

  const { kept, dropped } = dropMiterFaces(clusters);
  const longest = kept.reduce(
    (max, cluster) => Math.max(max, cluster.lengthIn),
    0,
  );
  if (longest < MIN_STICK_IN) return null;

  const sectionClusters = kept.filter(
    (cluster) =>
      cluster.count >= 3 &&
      cluster.lengthIn <= MAX_SECTION_IN &&
      longest / Math.max(cluster.lengthIn, 0.01) >= MIN_ASPECT,
  );
  const lengthClusters = kept.filter(
    (cluster) => !sectionClusters.includes(cluster),
  );
  if (sectionClusters.length < 1 || sectionClusters.length > 2) return null;
  if (lengthClusters.length < 1) return null;
  // A plate has two large face dimensions, each with 4 boundary edges.
  // A mitre splits the long edges into pairs of 2 (or 1 on a compound cut).
  if (
    lengthClusters.length >= 2 &&
    lengthClusters.every((cluster) => cluster.count >= 4)
  ) {
    return null;
  }
  if (lengthClusters.length === 1 && lengthClusters[0]!.count < 3) return null;

  const sectionLengths = sectionClusters
    .map((cluster) => cluster.lengthIn)
    .sort((a, b) => b - a);
  const sectionMajorIn = sectionLengths[0]!;
  const sectionMinorIn = sectionLengths[1] ?? sectionLengths[0]!;
  if (sectionMajorIn > 4.5 && sectionMinorIn > 4.5) return null;
  if (longest / Math.max(sectionMajorIn, 0.01) < MIN_ASPECT) return null;

  const longPointIn = round2(
    Math.max(...lengthClusters.map((cluster) => cluster.lengthIn)),
  );
  const shortestLong = round2(
    Math.min(...lengthClusters.map((cluster) => cluster.lengthIn)),
  );
  const droppedMiterFacesIn = dropped.map((cluster) => cluster.lengthIn);
  const miterEdgeCount = dropped.reduce((sum, cluster) => sum + cluster.count, 0);
  const compoundLongEdges = lengthClusters.length > 2;

  if (lengthClusters.length === 1) {
    const ends = endsFromMiterFace(miterEdgeCount);
    const mitered = ends.endA === 45 || ends.endB === 45;
    return {
      sectionMajorIn,
      sectionMinorIn,
      longPointIn,
      shortPointIn: null,
      endA: ends.endA,
      endB: ends.endB,
      lengthConvention: mitered ? "long_point" : "square",
      compoundLongEdges,
      droppedMiterFacesIn,
    };
  }

  const decision = mitreEnds(longPointIn - shortestLong, [
    sectionMajorIn,
    sectionMinorIn,
  ]);
  const faceEnds = endsFromMiterFace(miterEdgeCount);
  const endA: CutEnd = decision.ends > 0 ? 45 : faceEnds.endA;
  const endB: CutEnd =
    decision.ends === 2 ? 45 : decision.ends === 1 ? 90 : faceEnds.endB;
  if (endA === 90 && endB === 90) return null;

  return {
    sectionMajorIn,
    sectionMinorIn,
    longPointIn,
    shortPointIn: shortestLong,
    endA,
    endB,
    lengthConvention: "long_point",
    compoundLongEdges,
    droppedMiterFacesIn,
  };
}

function boundaryEdges(faces: number[][], verts: Vec3[]): number[] {
  const seen = new Set<string>();
  const lengths: number[] = [];
  for (const face of faces) {
    for (let i = 0; i < face.length; i += 1) {
      const ia = face[i]!;
      const ib = face[(i + 1) % face.length]!;
      const va = verts[ia - 1];
      const vb = verts[ib - 1];
      if (!va || !vb) continue;
      const ka = posKey(va);
      const kb = posKey(vb);
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const length = Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]);
      if (length >= 0.02) lengths.push(length);
    }
  }
  return lengths;
}

function uniquePositions(faces: number[][], verts: Vec3[]): number {
  const keys = new Set<string>();
  for (const face of faces) {
    for (const idx of face) {
      const v = verts[idx - 1];
      if (v) keys.add(posKey(v));
    }
  }
  return keys.size;
}

function extentOf(faces: number[][], verts: Vec3[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const face of faces) {
    for (const idx of face) {
      const v = verts[idx - 1];
      if (!v) continue;
      minX = Math.min(minX, v[0]);
      minY = Math.min(minY, v[1]);
      minZ = Math.min(minZ, v[2]);
      maxX = Math.max(maxX, v[0]);
      maxY = Math.max(maxY, v[1]);
      maxZ = Math.max(maxZ, v[2]);
    }
  }
  if (!Number.isFinite(minX)) return 0;
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ);
}

function stickLikeAabb(faces: number[][], verts: Vec3[]): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const face of faces) {
    for (const idx of face) {
      const v = verts[idx - 1];
      if (!v) continue;
      minX = Math.min(minX, v[0]);
      minY = Math.min(minY, v[1]);
      minZ = Math.min(minZ, v[2]);
      maxX = Math.max(maxX, v[0]);
      maxY = Math.max(maxY, v[1]);
      maxZ = Math.max(maxZ, v[2]);
    }
  }
  if (!Number.isFinite(minX)) return false;
  const size = [maxX - minX, maxY - minY, maxZ - minZ].sort((a, b) => a - b);
  const small = size[0]!;
  const mid = size[1]!;
  const long = size[2]!;
  return long >= MIN_STICK_IN && mid <= MAX_SECTION_IN && long / Math.max(mid, 0.01) >= MIN_ASPECT && small <= 4.5;
}

/**
 * Parse SketchUp OBJ text into prism sticks. Does not assign SKUs.
 * Refuses measurement when the header unit is present and is not inches
 * by returning an empty stick list and the foreign unit.
 */
export function parseObjWeldment(objText: string): ObjWeldmentParse {
  const units = readUnits(objText);
  const verts: Vec3[] = [];
  const groups: GroupAcc[] = [];
  let current: GroupAcc | null = null;
  let carriedMaterial = "";

  if (units != null && units !== "inches") {
    return {
      units,
      groupCount: 0,
      sticks: [],
      omittedStickLike: [],
      largestExtentIn: 0,
    };
  }

  for (const line of objText.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const parts = line.trim().split(/\s+/);
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        verts.push([x, y, z]);
      }
      continue;
    }
    if (line.startsWith("g ") || line.startsWith("o ")) {
      current = { name: line.slice(2).trim(), material: carriedMaterial, faces: [] };
      groups.push(current);
      continue;
    }
    if (line.startsWith("usemtl ")) {
      carriedMaterial = line.slice(7).trim();
      if (current && !current.material) current.material = carriedMaterial;
      continue;
    }
    if (line.startsWith("f ") && current) {
      const idxs: number[] = [];
      for (const token of line.trim().split(/\s+/).slice(1)) {
        const idx = faceIndex(token, verts.length);
        if (idx != null) idxs.push(idx);
      }
      if (idxs.length >= 3) current.faces.push(idxs);
    }
  }

  const sticks: ObjStick[] = [];
  const omittedStickLike: OmittedGroup[] = [];
  let largestExtentIn = 0;

  for (const group of groups) {
    if (group.faces.length === 0) continue;
    const extent = extentOf(group.faces, verts);
    if (extent > largestExtentIn) largestExtentIn = extent;

    const material = group.material;
    const denied =
      /marble|stone|carpet|pillow|carrara|carrera/i.test(material) ||
      /pillow|cushion|marble|carpet/i.test(group.name);
    if (denied) {
      if (stickLikeAabb(group.faces, verts)) {
        omittedStickLike.push({
          group: group.name,
          reason: "non_metal_material",
          faces: group.faces.length,
        });
      }
      continue;
    }

    const positions = uniquePositions(group.faces, verts);
    const edges = boundaryEdges(group.faces, verts);
    const clusters = clusterEdges(edges);
    const prism =
      group.faces.length === 6 && positions === 8
        ? classifyPrism(clusters)
        : null;

    if (!prism) {
      if (stickLikeAabb(group.faces, verts) && omittedStickLike.length < 20) {
        omittedStickLike.push({
          group: group.name,
          reason:
            group.faces.length === 6
              ? "non_prism_edges"
              : "non_prism",
          faces: group.faces.length,
        });
      }
      continue;
    }

    sticks.push({
      group: group.name,
      material,
      sectionMajorIn: prism.sectionMajorIn,
      sectionMinorIn: prism.sectionMinorIn,
      longPointIn: prism.longPointIn,
      shortPointIn: prism.shortPointIn,
      endA: prism.endA,
      endB: prism.endB,
      lengthConvention: prism.lengthConvention,
      compoundLongEdges: prism.compoundLongEdges,
      edgesIn: clusters,
      droppedMiterFacesIn: prism.droppedMiterFacesIn,
    });
  }

  return {
    units,
    groupCount: groups.length,
    sticks,
    omittedStickLike,
    largestExtentIn: round2(largestExtentIn),
  };
}
