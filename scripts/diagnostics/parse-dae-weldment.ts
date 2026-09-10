/**
 * CLI wrapper — Option B DAE weldment AABB.
 * Core logic: @/lib/sketchup-cutlist/parse-dae-weldment
 */
import fs from "node:fs";
import path from "node:path";
import {
  classifyExtrusion,
  parseDaeWeldment,
} from "../../src/lib/sketchup-cutlist/parse-dae-weldment";

export {
  classifyExtrusion,
  parseDaeWeldment,
  parseDaeWeldmentFromXml,
  rollupTubes,
  type ParseDaeResult,
  type TubeRollup,
} from "../../src/lib/sketchup-cutlist/parse-dae-weldment";

const DEFAULT_DAE = path.resolve(
  process.cwd(),
  "docs/BOM_Examples/SketchupFiles/FIN-WFT-DIN-TAB-72X28.dae",
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function main(): void {
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : DEFAULT_DAE;

  if (!fs.existsSync(target)) {
    throw new Error(`DAE not found: ${target}`);
  }

  const result = parseDaeWeldment(target);

  console.log("=== Option B — DAE weldment AABB ===");
  console.log(`file: ${path.relative(process.cwd(), target)}`);
  console.log(`unit: ${result.unit}`);
  console.log(
    `geometries: ${result.geometries}  instance_geometry hits: ${result.instances}`,
  );
  console.log("\n--- per-instance (scaled local AABB) ---");
  for (const hit of result.hits) {
    const c = classifyExtrusion(hit.scaledSize);
    const label = c
      ? `${c.profile} L=${c.length}"`
      : `unclassified [${hit.scaledSize.map(round2).join("×")}]`;
    console.log(
      `  ${hit.nodeName.padEnd(12)} geom=${hit.geometryId.padEnd(6)} local=[${hit.localSize.map(round2).join("×")}] scaled=[${hit.scaledSize.map(round2).join("×")}] → ${label}`,
    );
  }

  console.log("\n--- draft cut-list (grouped) ---");
  for (const row of result.draft) {
    console.log(`  ${row.qty}× ${row.profile} @ ${row.length}"`);
  }

  const outDir = path.join(
    process.cwd(),
    "scripts/diagnostics/cutlist-exports",
  );
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(target, path.extname(target));
  fs.writeFileSync(
    path.join(outDir, `${base}.dae-draft.json`),
    JSON.stringify({ draft: result.draft, rollup: result.rollup }, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, `${base}.cutlist.json`),
    JSON.stringify(result.walker, null, 2),
  );
  console.log(`\nwrote ${base}.dae-draft.json + ${base}.cutlist.json`);
}

main();
