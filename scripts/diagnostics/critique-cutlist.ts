/**
 * Optional multimodal critic CLI — never writes the database.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/critique-cutlist.ts
 *   npx tsx scripts/diagnostics/critique-cutlist.ts path/to/export.cutlist.json
 *
 * If OPENAI_API_KEY or GEMINI_API_KEY is set, prints a prompt bundle for
 * human/agent paste — does not auto-call unless --call is passed (still no DB).
 */
import fs from "node:fs";
import path from "node:path";
import {
  bravadaClubChairFixtureWalker,
  critiqueCutlistPlan,
  instantiateBravadaClubChair,
  type WalkerExport,
} from "@/lib/sketchup-cutlist";

function loadWalker(): WalkerExport {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (arg) {
    return JSON.parse(fs.readFileSync(path.resolve(arg), "utf8")) as WalkerExport;
  }
  const fixture = path.join(
    process.cwd(),
    "scripts/diagnostics/cutlist-exports/bravada-club-chair.cutlist.json",
  );
  if (fs.existsSync(fixture)) {
    return JSON.parse(fs.readFileSync(fixture, "utf8")) as WalkerExport;
  }
  return bravadaClubChairFixtureWalker();
}

async function main(): Promise<void> {
  const walker = loadWalker();
  const plan = instantiateBravadaClubChair(walker);
  const images = [
    path.join(process.cwd(), "docs/BOM_Examples/BravadaSample.jpeg"),
    path.join(process.cwd(), "docs/BOM_Examples/DWG_BRV-CLB-034034_BOM.pdf"),
  ].filter((p) => fs.existsSync(p));

  const report = critiqueCutlistPlan({ plan, walker, imagePaths: images });
  const outDir = path.join(process.cwd(), "scripts/diagnostics/cutlist-exports");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${plan.finSku}-critic.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(`okForDraft=${report.okForDraft}`);
  for (const f of report.findings) {
    console.log(`[${f.severity}] ${f.code}: ${f.message}`);
  }
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);

  if (process.argv.includes("--prompt")) {
    const prompt = {
      instruction:
        "Review the proposed cut-list against the images. Flag missing stretchers, wrong mitres, or long/short-point errors. Do NOT invent new SKUs. Return JSON findings only.",
      overall: walker.overall,
      lines: plan.lines.map((l) => ({
        parent: l.parentSku,
        child: l.childSku,
        qty: l.quantity,
        uom: l.unitOfMeasure,
        notes: l.notes,
      })),
      images,
    };
    console.log("\n--- multimodal prompt bundle (no DB write) ---\n");
    console.log(JSON.stringify(prompt, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
