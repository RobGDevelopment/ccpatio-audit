import { NodeIO, type mat4, type vec3 } from "@gltf-transform/core";
import { evaluateComponentHygiene, isStructuralNode, type ProfileType } from "./component-hygiene";
import { calculatePowder, calculateWeight, calculateJoinery } from "./derived-heuristics";

function transformPoint(matrix: mat4, point: vec3): vec3 {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  const rw = w === 0 ? 1 : 1 / w;
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * rw,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * rw,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * rw,
  ];
}

const METER_TO_INCH = 39.37007874;

export async function parseGlbWeldment(glbBuffer: Uint8Array) {
  const io = new NodeIO();
  const document = await io.readBinary(glbBuffer);
  const root = document.getRoot();

  const components: any[] = [];
  const failures: Array<{ name: string; reason: string }> = [];

  for (const node of root.listNodes()) {
    const name = node.getName() || "Unnamed";
    if (!isStructuralNode(name)) continue;

    const mesh = node.getMesh();
    if (!mesh) continue;

    const worldMatrix = node.getWorldMatrix();
    let min: vec3 = [Infinity, Infinity, Infinity];
    let max: vec3 = [-Infinity, -Infinity, -Infinity];

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute("POSITION");
      if (!position) continue;
      
      for (let i = 0; i < position.getCount(); i++) {
        const localPos = position.getElement(i, [0, 0, 0]) as vec3;
        const worldPos = transformPoint(worldMatrix, localPos);
        
        // Convert to inches
        const xIn = worldPos[0] * METER_TO_INCH;
        const yIn = worldPos[1] * METER_TO_INCH;
        const zIn = worldPos[2] * METER_TO_INCH;

        if (xIn < min[0]) min[0] = xIn;
        if (yIn < min[1]) min[1] = yIn;
        if (zIn < min[2]) min[2] = zIn;
        if (xIn > max[0]) max[0] = xIn;
        if (yIn > max[1]) max[1] = yIn;
        if (zIn > max[2]) max[2] = zIn;
      }
    }

    if (min[0] === Infinity) continue;

    const dx = max[0] - min[0];
    const dy = max[1] - min[1];
    const dz = max[2] - min[2];
    const aabbLongAxisIn = Math.max(dx, dy, dz);

    const hygieneResult = evaluateComponentHygiene(name, aabbLongAxisIn);

    if (!hygieneResult.isValid) {
      failures.push({ name, reason: hygieneResult.reason || "Invalid component" });
    }

    components.push({
      name,
      role: hygieneResult.role,
      material: hygieneResult.material,
      profile: hygieneResult.profile,
      lengthIn: hygieneResult.lengthIn,
      statedLengthIn: hygieneResult.statedLengthIn,
      lengthSource: hygieneResult.lengthSource,
      confidence: hygieneResult.confidence,
      aabb: { min, max },
      endA: hygieneResult.endA,
      endB: hygieneResult.endB,
      lengthConvention: hygieneResult.lengthConvention,
    });
  }

  const hasFailures = failures.length > 0;
  const noStructural = components.length === 0;
  
  if (hasFailures || noStructural) {
    return {
      unit: "inch",
      hygiene: "fail",
      failures: noStructural && !hasFailures ? [{ name: "File", reason: "Zero structural nodes" }] : failures,
      components,
      derived: null
    };
  }

  const derivedComps = components.map(c => ({
    ...c,
    profile: c.profile as ProfileType,
  }));

  const powder = calculatePowder(derivedComps.filter(c => c.material === "ALUM" || c.material === "STL"));
  const weight = calculateWeight(derivedComps);
  const joinery = calculateJoinery(derivedComps);

  return {
    unit: "inch",
    hygiene: "pass",
    failures: [],
    components,
    derived: {
      powder,
      weight,
      joinery,
    }
  };
}
