/**
 * Phase 0 SKP/GLB audit — classify available models into:
 *   named_cut_strings | nested_groups | exploded_soup
 *
 * Also writes the Bravada North Star fixture JSON for the instantiator.
 *
 * Usage (repo root):
 *   npx tsx scripts/diagnostics/audit-skp-cutlist-sources.ts
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  bravadaClubChairFixtureWalker,
  looksLikeCutListName,
  type AuditBucket,
} from "@/lib/sketchup-cutlist";

type FileAudit = {
  path: string;
  bytes: number;
  kind: "glb" | "skp" | "fixture";
  nodeCount: number;
  cutLikeNames: number;
  meshGeneric: number;
  bucket: AuditBucket;
  samples: string[];
};

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "scripts", "diagnostics", "cutlist-exports");
const REPORT_PATH = path.join(OUT_DIR, "phase0-audit-report.json");

function classify(cutLike: number, named: number, meshGeneric: number): AuditBucket {
  if (cutLike >= 3) return "named_cut_strings";
  if (named >= 5 && meshGeneric < named) return "nested_groups";
  return "exploded_soup";
}

async function auditGlb(filePath: string): Promise<FileAudit> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(filePath);
  const root = document.getRoot();
  const names = root.listNodes().map((n) => n.getName()?.trim() || "(unnamed)");
  const cutLikeNames = names.filter(looksLikeCutListName);
  const meshGeneric = names.filter(
    (n) => /^Mesh_/i.test(n) || n === "(unnamed)" || /^Node$/i.test(n),
  );
  const named = new Set(names.filter((n) => n !== "(unnamed)")).size;
  return {
    path: path.relative(ROOT, filePath).replace(/\\/g, "/"),
    bytes: fs.statSync(filePath).size,
    kind: "glb",
    nodeCount: names.length,
    cutLikeNames: cutLikeNames.length,
    meshGeneric: meshGeneric.length,
    bucket: classify(cutLikeNames.length, named, meshGeneric.length),
    samples: [...new Set(cutLikeNames.length ? cutLikeNames : names)].slice(0, 12),
  };
}

function listCandidates(): string[] {
  const dirs = [
    path.join(ROOT, "3d-sandbox", "public", "models"),
    path.join(ROOT, "Blender", "dist", "hero"),
    path.join(ROOT, "Blender", "dist", "glb"),
    path.join(ROOT, "docs"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const walk = (d: string, depth: number) => {
      if (depth > 3) return;
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) walk(full, depth + 1);
        else if (/\.(glb|skp)$/i.test(ent.name)) {
          const size = fs.statSync(full).size;
          // Skip empty GLB stubs (< 1KB)
          if (size < 1024 && /\.glb$/i.test(ent.name)) continue;
          files.push(full);
        }
      }
    };
    walk(dir, 0);
  }
  // Prefer larger / known heroes first; cap bulk scan
  return files
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
    .slice(0, 12);
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const fixture = bravadaClubChairFixtureWalker();
  const fixturePath = path.join(OUT_DIR, "bravada-club-chair.cutlist.json");
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));

  const results: FileAudit[] = [
    {
      path: "docs/BOM_Examples/BravadaSample.jpeg (name fixture)",
      bytes: 0,
      kind: "fixture",
      nodeCount: fixture.sticks.length,
      cutLikeNames: fixture.sticks.filter((s) =>
        looksLikeCutListName(s.definitionName),
      ).length,
      meshGeneric: 0,
      bucket: "named_cut_strings",
      samples: fixture.sticks.map((s) => s.definitionName).slice(0, 12),
    },
  ];

  for (const file of listCandidates()) {
    if (/\.skp$/i.test(file)) {
      results.push({
        path: path.relative(ROOT, file).replace(/\\/g, "/"),
        bytes: fs.statSync(file).size,
        kind: "skp",
        nodeCount: 0,
        cutLikeNames: 0,
        meshGeneric: 0,
        bucket: "nested_groups",
        samples: [
          "SKP present — run scripts/sketchup/export_cutlist_walker.rb in SketchUp Pro",
        ],
      });
      continue;
    }
    try {
      results.push(await auditGlb(file));
    } catch (err) {
      console.warn(`skip ${file}:`, err instanceof Error ? err.message : err);
    }
  }

  const summary = {
    auditedAt: new Date().toISOString(),
    fixturePath: path.relative(ROOT, fixturePath).replace(/\\/g, "/"),
    counts: {
      named_cut_strings: results.filter((r) => r.bucket === "named_cut_strings")
        .length,
      nested_groups: results.filter((r) => r.bucket === "nested_groups").length,
      exploded_soup: results.filter((r) => r.bucket === "exploded_soup").length,
    },
    recommendation:
      "BravadaSample path is named_cut_strings — Ruby name parser + family template. Most GLBs are exploded_soup / Mesh_* — use mesh OBB fallback only when SKP names are missing.",
    files: results,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${summary.fixturePath}`);
  console.log(`Wrote ${path.relative(ROOT, REPORT_PATH)}`);
  console.log("bucket counts:", summary.counts);
  for (const row of results) {
    console.log(
      `  [${row.bucket}] ${row.path} cutLike=${row.cutLikeNames} nodes=${row.nodeCount}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
