/**
 * Lightweight, client-safe GLB parser and file hasher.
 * Reads GLB binary header and JSON chunk without loading geometry or importing Three.js.
 */

export type GlbSummary = {
  valid: boolean;
  reason?: string;
  meshCount?: number;
  nodeCount?: number;
  materialCount?: number;
  boundsMeters?: [number, number, number];
  boundsInches?: [number, number, number];
  unitsLookOdd?: boolean;
};

const GLTF_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"
const MAX_JSON_CHUNK_BYTES = 5 * 1024 * 1024; // 5 MiB cap

export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readGlbSummary(file: File): Promise<GlbSummary> {
  if (file.size < 20) {
    return { valid: false, reason: "FILE_TOO_SMALL" };
  }

  // Read header (12 bytes) + chunk 0 header (8 bytes) = 20 bytes
  const headerSlice = file.slice(0, 20);
  const headerBuf = await headerSlice.arrayBuffer();
  const view = new DataView(headerBuf);

  const magic = view.getUint32(0, true);
  if (magic !== GLTF_MAGIC) {
    return { valid: false, reason: "INVALID_MAGIC" };
  }

  const version = view.getUint32(4, true);
  if (version !== 2) {
    return { valid: false, reason: "UNSUPPORTED_VERSION" };
  }

  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);

  if (chunkType !== JSON_CHUNK_TYPE) {
    return { valid: false, reason: "INVALID_CHUNK_TYPE" };
  }

  if (chunkLength > MAX_JSON_CHUNK_BYTES) {
    return { valid: true, reason: "JSON_CHUNK_TOO_LARGE" };
  }

  // Read JSON chunk
  const jsonSlice = file.slice(20, 20 + chunkLength);
  const jsonBuf = await jsonSlice.arrayBuffer();
  const jsonText = new TextDecoder().decode(jsonBuf);

  let gltf: {
    meshes?: unknown[];
    nodes?: Array<{ mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }>;
    materials?: unknown[];
    accessors?: Array<{ min?: number[]; max?: number[] }>;
  };

  try {
    gltf = JSON.parse(jsonText);
  } catch {
    return { valid: false, reason: "CORRUPTED_JSON" };
  }

  const meshCount = gltf.meshes?.length || 0;
  const nodeCount = gltf.nodes?.length || 0;
  const materialCount = gltf.materials?.length || 0;

  if (meshCount === 0) {
    return { valid: false, reason: "NO_GEOMETRY" };
  }

  // Approximate extents from POSITION accessors
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  if (Array.isArray(gltf.accessors)) {
    for (const acc of gltf.accessors) {
      if (acc.min && acc.max && acc.min.length >= 3 && acc.max.length >= 3) {
        minX = Math.min(minX, acc.min[0]!);
        minY = Math.min(minY, acc.min[1]!);
        minZ = Math.min(minZ, acc.min[2]!);
        maxX = Math.max(maxX, acc.max[0]!);
        maxY = Math.max(maxY, acc.max[1]!);
        maxZ = Math.max(maxZ, acc.max[2]!);
      }
    }
  }

  let boundsMeters: [number, number, number] | undefined;
  let boundsInches: [number, number, number] | undefined;
  let unitsLookOdd = false;

  if (Number.isFinite(minX) && Number.isFinite(maxX)) {
    let sizeX = Math.abs(maxX - minX);
    let sizeY = Math.abs(maxY - minY);
    let sizeZ = Math.abs(maxZ - minZ);

    // Check for root scale transform in nodes if any
    if (gltf.nodes && gltf.nodes.length > 0) {
      for (const node of gltf.nodes) {
        if (node.scale && node.scale.length >= 3) {
          sizeX *= Math.abs(node.scale[0]!);
          sizeY *= Math.abs(node.scale[1]!);
          sizeZ *= Math.abs(node.scale[2]!);
          break;
        }
      }
    }

    boundsMeters = [sizeX, sizeY, sizeZ];
    // Convert meters to inches (1m = 39.3701 in = 1 / 0.0254)
    boundsInches = [sizeX / 0.0254, sizeY / 0.0254, sizeZ / 0.0254];

    const maxDim = Math.max(sizeX, sizeY, sizeZ);
    // If largest dimension < 0.05m (2 inches) or > 20m (65 feet), units look odd (e.g. mm or cm)
    if (maxDim < 0.05 || maxDim > 20) {
      unitsLookOdd = true;
    }
  }

  return {
    valid: true,
    meshCount,
    nodeCount,
    materialCount,
    boundsMeters,
    boundsInches,
    unitsLookOdd,
  };
}
