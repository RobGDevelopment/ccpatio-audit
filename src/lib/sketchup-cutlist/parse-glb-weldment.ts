import { NodeIO, type mat4, type vec3 } from "@gltf-transform/core";
import { evaluateComponentHygiene, isStructuralNode, type ProfileType } from "./component-hygiene";
import { calculatePowder, calculateWeight, calculateJoinery, calculateArgon, calculateSand, calculateFreight } from "./derived-heuristics";

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

  let globalUnion: { min: [number, number, number]; max: [number, number, number] } = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let cushionUnion: { min: [number, number, number]; max: [number, number, number] } = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };

  for (const node of root.listNodes()) {
    const name = node.getName() || "Unnamed";
    const isStructural = isStructuralNode(name);
    const isCushion = name.toUpperCase().includes("CUSH");

    const mesh = node.getMesh();
    if (!mesh) continue;

    const worldMatrix = node.getWorldMatrix();
    let min: vec3 = [Infinity, Infinity, Infinity];
    let max: vec3 = [-Infinity, -Infinity, -Infinity];
    let meshMin: [number, number, number] = [Infinity, Infinity, Infinity];
    let meshMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

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

        if (xIn < meshMin[0]) meshMin[0] = xIn;
        if (yIn < meshMin[1]) meshMin[1] = yIn;
        if (zIn < meshMin[2]) meshMin[2] = zIn;
        if (xIn > meshMax[0]) meshMax[0] = xIn;
        if (yIn > meshMax[1]) meshMax[1] = yIn;
        if (zIn > meshMax[2]) meshMax[2] = zIn;
      }
    }

    if (meshMin[0] === Infinity) continue;

    // Expand global union
    if (meshMin[0] < globalUnion.min[0]) globalUnion.min[0] = meshMin[0];
    if (meshMin[1] < globalUnion.min[1]) globalUnion.min[1] = meshMin[1];
    if (meshMin[2] < globalUnion.min[2]) globalUnion.min[2] = meshMin[2];
    if (meshMax[0] > globalUnion.max[0]) globalUnion.max[0] = meshMax[0];
    if (meshMax[1] > globalUnion.max[1]) globalUnion.max[1] = meshMax[1];
    if (meshMax[2] > globalUnion.max[2]) globalUnion.max[2] = meshMax[2];

    if (isCushion) {
      if (meshMin[0] < cushionUnion.min[0]) cushionUnion.min[0] = meshMin[0];
      if (meshMin[1] < cushionUnion.min[1]) cushionUnion.min[1] = meshMin[1];
      if (meshMin[2] < cushionUnion.min[2]) cushionUnion.min[2] = meshMin[2];
      if (meshMax[0] > cushionUnion.max[0]) cushionUnion.max[0] = meshMax[0];
      if (meshMax[1] > cushionUnion.max[1]) cushionUnion.max[1] = meshMax[1];
      if (meshMax[2] > cushionUnion.max[2]) cushionUnion.max[2] = meshMax[2];
    }

    if (!isStructural) continue;

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
  
  const argon = calculateArgon(joinery.jointCount);
  const sand = calculateSand(derivedComps);
  const freight = calculateFreight(globalUnion, weight.aluminumLbs);

  return {
    unit: "inch",
    hygiene: "pass",
    failures: [],
    components,
    globalAabb: globalUnion,
    cushionAabb: cushionUnion.min[0] !== Infinity ? cushionUnion : null,
    derived: {
      powder,
      weight,
      joinery,
      argon,
      sand,
      freight,
    }
  };
}
