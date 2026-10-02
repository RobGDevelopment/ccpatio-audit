import fs from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

function extractJsonFences(md: string): string[] {
  const blocks: string[] = [];
  const re = /```json\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) blocks.push(m[1].trim());
  return blocks;
}

function tryParse(block: string): JsonObject | null {
  try {
    return JSON.parse(block) as JsonObject;
  } catch {
    return null;
  }
}

export function mergeResearchPaste(md: string): JsonObject {
  const out: JsonObject = {};
  for (const block of extractJsonFences(md)) {
    const parsed = tryParse(block);
    if (!parsed) continue;
    Object.assign(out, parsed);
  }
  return out;
}

export function loadResearchFromPasteOrJson(cwd = process.cwd()): {
  research: JsonObject;
  source: string;
} {
  const handoffDir = path.resolve(cwd, "docs/Vividworks/Handoff");
  const fullJson = path.join(handoffDir, "_research_locked_full.json");
  const pasteMd = path.join(handoffDir, "_research_user_paste.md");

  if (fs.existsSync(fullJson)) {
    const raw = fs.readFileSync(fullJson, "utf8").trim();
    if (raw.startsWith("{") || raw.startsWith("[")) {
      return { research: JSON.parse(raw) as JsonObject, source: fullJson };
    }
  }

  if (!fs.existsSync(pasteMd)) {
    throw new Error(
      `Missing research input. Place Drive JSON at ${fullJson} or paste markdown at ${pasteMd}`,
    );
  }

  const md = fs.readFileSync(pasteMd, "utf8");
  const research = mergeResearchPaste(md);
  return { research, source: pasteMd };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("parse-handoff-research-paste.ts")) {
  const { research, source } = loadResearchFromPasteOrJson();
  const outPath = path.resolve(
    process.cwd(),
    "docs/Vividworks/Handoff/_research_merged.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(research, null, 2));
  const keys = Object.keys(research);
  const fabrics = Array.isArray(research.fabric_grades)
    ? research.fabric_grades.length
    : 0;
  const dektons = Array.isArray(research.dekton_grades)
    ? research.dekton_grades.length
    : 0;
  const powders = Array.isArray(research.powders) ? research.powders.length : 0;
  const products = Array.isArray(research.products_no_price)
    ? research.products_no_price.length
    : Array.isArray(research.products_no_price_cluster_sample)
      ? research.products_no_price_cluster_sample.length
      : 0;
  console.log(
    JSON.stringify(
      { source, outPath, keys, fabrics, dektons, powders, products },
      null,
      2,
    ),
  );
}
