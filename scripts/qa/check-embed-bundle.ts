import fs from "node:fs";
import path from "node:path";

const BASELINE_BYTES = 809662;
const ROUTE_NAME = "/embed/factory-bom";
const STATS_FILE = path.resolve(process.cwd(), ".next/diagnostics/route-bundle-stats.json");

interface RouteStats {
  route: string;
  firstLoadUncompressedJsBytes: number;
  firstLoadChunkPaths: string[];
}

export function checkEmbedBundle(): { ok: boolean; message: string } {
  if (!fs.existsSync(STATS_FILE)) {
    console.error(`[check-embed-bundle] Error: stats file not found at ${STATS_FILE}. Run build first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(STATS_FILE, "utf8");
  const stats: RouteStats[] = JSON.parse(raw);

  const routeStat = stats.find((s) => s.route === ROUTE_NAME);
  if (!routeStat) {
    console.error(`[check-embed-bundle] Error: route ${ROUTE_NAME} not found in stats.`);
    process.exit(1);
  }

  const currentBytes = routeStat.firstLoadUncompressedJsBytes;
  const delta = currentBytes - BASELINE_BYTES;
  const percentDelta = ((delta / BASELINE_BYTES) * 100).toFixed(2);

  console.log("=== Phase 12 Embed Bundle Budget Audit ===");
  console.log(`Route:        ${ROUTE_NAME}`);
  console.log(`Baseline:     ${BASELINE_BYTES.toLocaleString()} bytes`);
  console.log(`Current:      ${currentBytes.toLocaleString()} bytes`);
  console.log(`Delta:        ${delta > 0 ? "+" : ""}${delta.toLocaleString()} bytes (${percentDelta}%)`);

  // Check that viewer chunks (WebGLRenderer, OrbitControls) are NOT in first load
  const forbiddenStrings = ["WebGLRenderer", "OrbitControls"];
  const violations: string[] = [];

  for (const chunkRel of routeStat.firstLoadChunkPaths) {
    const chunkFull = path.resolve(process.cwd(), chunkRel);
    if (fs.existsSync(chunkFull)) {
      const code = fs.readFileSync(chunkFull, "utf8");
      for (const forbidden of forbiddenStrings) {
        if (code.includes(forbidden)) {
          violations.push(`Chunk ${chunkRel} contains forbidden string "${forbidden}"`);
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("\n❌ VIOLATION: 3D Viewer chunks leaked into first load:");
    for (const v of violations) {
      console.error(` - ${v}`);
    }
    process.exit(1);
  } else {
    console.log("3D Viewer:    Clean (WebGLRenderer and OrbitControls absent from first load)");
  }

  if (currentBytes > BASELINE_BYTES) {
    console.error(`\n❌ BUDGET REGRESSION: current ${currentBytes} exceeds baseline ${BASELINE_BYTES}`);
    process.exit(1);
  }

  console.log("Result:       PASS (within budget)");
  return { ok: true, message: "Bundle check passed" };
}

if (process.argv[1]?.endsWith("check-embed-bundle.ts")) {
  checkEmbedBundle();
}
