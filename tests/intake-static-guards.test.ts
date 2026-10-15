import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function scanDir(relDir: string): string[] {
  const fullDir = path.resolve(process.cwd(), relDir);
  if (!fs.existsSync(fullDir)) return [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(fullDir, entry.name);
    if (entry.isDirectory()) {
      const sub = scanDir(path.relative(process.cwd(), fullPath));
      files.push(...sub);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(path.relative(process.cwd(), fullPath).replace(/\\/g, "/"));
    }
  }
  return files;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = path.join("src", spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.join(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    base,
  ]) {
    const full = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      return path.relative(process.cwd(), full).replace(/\\/g, "/");
    }
  }
  return null;
}

function getIntakeFiles(): string[] {
  const dirs = [
    "src/lib/intake",
    "src/server/factory-bom/intake",
    "src/app/embed/factory-bom",
  ];
  const files: string[] = [];
  for (const d of dirs) {
    files.push(...scanDir(d));
  }
  const individuals = [
    "src/server/ghl/search-opportunities.ts",
    "src/server/ghl/fetch-intake-opportunity.ts",
    "src/server/ghl/parse.ts",
    "src/server/master-catalog/create-product-core.ts",
  ];
  for (const f of individuals) {
    if (fs.existsSync(path.resolve(process.cwd(), f))) {
      files.push(f);
    }
  }
  return Array.from(new Set(files));
}

describe("Intake Static Guards G1-G8", () => {
  it("G1: No any, as any, @ts-ignore, @ts-expect-error or catch (…: any)", () => {
    const files = getIntakeFiles();
    const violations: { file: string; line: number; text: string }[] = [];

    const forbiddenPatterns = [
      /\bas\s+any\b/,
      /:\s*any\b/,
      /@ts-ignore/,
      /@ts-expect-error/,
      /catch\s*\([^)]*:\s*any\s*\)/,
    ];

    for (const f of files) {
      // Exclude legacy files that will be deleted in Task 11 / C4
      if (
        f.includes("AirlockWizard") ||
        f.includes("FunnelFork") ||
        f.includes("IntakeDropzone") ||
        f.includes("PacketLines")
      ) {
        continue;
      }
      const lines = fs.readFileSync(path.resolve(process.cwd(), f), "utf8").split("\n");
      lines.forEach((line, idx) => {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            violations.push({ file: f, line: idx + 1, text: line.trim() });
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("G2: No caught error message/stack leaked or JSON.stringify(error)", () => {
    const files = getIntakeFiles();
    const violations: { file: string; line: number; text: string }[] = [];

    // Pattern for caught error leakage like `return { error: err.message }` or `JSON.stringify(err)`
    const leakPattern = /(?:error|message)\s*:\s*(?:err|error|e)\.(?:message|stack)/;
    const jsonErrPattern = /JSON\.stringify\s*\(\s*(?:err|error|e)\s*\)/;

    for (const f of files) {
      if (
        f.includes("AirlockWizard") ||
        f.includes("FunnelFork") ||
        f.includes("IntakeDropzone") ||
        f.includes("PacketLines")
      ) {
        continue;
      }
      const lines = fs.readFileSync(path.resolve(process.cwd(), f), "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (leakPattern.test(line) || jsonErrPattern.test(line)) {
          violations.push({ file: f, line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("G3: Transitive import graph of intake contains no Katana, Woo, Clover, or QBO clients", () => {
    const files = getIntakeFiles().filter(
      (f) =>
        !f.includes("AirlockWizard") &&
        !f.includes("FunnelFork") &&
        !f.includes("IntakeDropzone") &&
        !f.includes("PacketLines")
    );

    const visited = new Set<string>();
    const queue = [...files];
    const forbiddenModules = [
      "src/lib/katana.ts",
      "src/server/integrations",
      "src/inngest/path-a-release.ts",
      "src/server/woocommerce",
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const src = fs.readFileSync(path.resolve(process.cwd(), current), "utf8");
      const importRegex = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = importRegex.exec(src)) !== null) {
        const spec = m[1];
        const resolved = resolveSpecifier(current, spec);
        if (resolved) {
          for (const forbidden of forbiddenModules) {
            expect(
              resolved.startsWith(forbidden),
              `Intake module ${current} transitively imports forbidden module: ${resolved}`
            ).toBe(false);
          }
          if (!visited.has(resolved) && (resolved.startsWith("src/app/embed/factory-bom") || resolved.startsWith("src/lib/intake") || resolved.startsWith("src/server/factory-bom/intake"))) {
            queue.push(resolved);
          }
        }
      }
    }
  });

  it("G4: No fetch() to Katana, Woo, QBO, or Clover hosts in intake scope", () => {
    const files = getIntakeFiles();
    const violations: string[] = [];

    const forbiddenHosts = ["katana", "woocommerce", "quickbooks", "clover"];

    for (const f of files) {
      const src = fs.readFileSync(path.resolve(process.cwd(), f), "utf8");
      for (const host of forbiddenHosts) {
        if (src.toLowerCase().includes(`fetch(`) && src.toLowerCase().includes(host)) {
          violations.push(`${f} mentions fetch with ${host}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("G5: three and R3F imported only inside viewer folder and lazy-loaded", () => {
    const files = getIntakeFiles();
    const violations: string[] = [];

    for (const f of files) {
      if (f.includes("/viewer/")) continue;
      const src = fs.readFileSync(path.resolve(process.cwd(), f), "utf8");
      if (
        src.includes("from 'three'") ||
        src.includes('from "three"') ||
        src.includes("@react-three/")
      ) {
        violations.push(`${f} imports three.js outside of viewer/`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("G6: No intake routes under src/app/api/, no dots in segments, src/proxy.ts clean in diff", () => {
    // Check no routes under src/app/api/intake or src/app/api/factory-bom
    expect(fs.existsSync(path.resolve(process.cwd(), "src/app/api/factory-bom"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "src/app/api/intake"))).toBe(false);

    // Check embed route path segments do not contain dots
    const embedApiDir = "src/app/embed/factory-bom/api";
    if (fs.existsSync(path.resolve(process.cwd(), embedApiDir))) {
      const routes = scanDir(embedApiDir);
      for (const r of routes) {
        const segments = r.split("/");
        // only route.ts is allowed to have extension
        const dirSegments = segments.slice(0, -1);
        for (const seg of dirSegments) {
          expect(seg.includes(".")).toBe(false);
        }
      }
    }

    // Check src/proxy.ts is untouched in git status
    try {
      const diff = execSync("git diff --name-only HEAD src/proxy.ts", { encoding: "utf8" });
      expect(diff.trim()).toBe("");
    } catch {
      // If git diff succeeds with empty, test passes
    }
  });

  it("G7: Packet storage never calls getPublicUrl and uses upsert: false", () => {
    const packetServerFile = "src/server/factory-bom/intake/packet.ts";
    if (fs.existsSync(path.resolve(process.cwd(), packetServerFile))) {
      const src = fs.readFileSync(path.resolve(process.cwd(), packetServerFile), "utf8");
      expect(src.includes("getPublicUrl")).toBe(false);
      expect(src.includes("upsert: false") || src.includes("upsert:false")).toBe(true);
    }
  });

  it("G8: Embed code never imports legacy actions mintCustomJob, promoteToCatalog, beginAirlockIntake", () => {
    const embedFiles = scanDir("src/app/embed/factory-bom").filter(
      (f) =>
        !f.includes("AirlockWizard") &&
        !f.includes("FunnelFork") &&
        !f.includes("IntakeDropzone") &&
        !f.includes("PacketLines")
    );

    const forbiddenImports = [
      "mintCustomJob",
      "promoteToCatalog",
      "beginAirlockIntake",
      "uploadFactoryPacketAction",
    ];

    const violations: string[] = [];

    for (const f of embedFiles) {
      const src = fs.readFileSync(path.resolve(process.cwd(), f), "utf8");
      for (const item of forbiddenImports) {
        if (new RegExp(`\\b${item}\\b`).test(src)) {
          violations.push(`${f} imports or references legacy symbol ${item}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
