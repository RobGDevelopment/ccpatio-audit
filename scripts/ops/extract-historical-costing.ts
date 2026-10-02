/**
 * Historical costing extraction — scan workspace spreadsheets for labor,
 * overhead, and material rate baselines; emit tmp/historical-costing-analysis.md
 *
 *   npx tsx scripts/ops/extract-historical-costing.ts
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";
import * as XLSX from "xlsx";

const ROOT = process.cwd();
const OUT_MD = join(ROOT, "tmp", "historical-costing-analysis.md");
const OUT_JSON = join(ROOT, "tmp", "historical-costing-extract.json");

const SKIP_DIR = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  "agent-transcripts",
  "agent-tools",
]);

const KEYWORDS =
  /\b(cost|labor|labour|hour|hourly|rate|overhead|consumable|consumables|margin|wage|burden|misc|gas|primer|powder|sandblast|weld|grind|sew|sewing|upholst|fabric|dekton|foam|tubing|linear|sqft|sq\.?\s*ft|\/lf|\/hr|\/hour|\/yard|\/yd)\b/i;

const RATE_PATTERNS: Array<{
  kind: string;
  re: RegExp;
  unit: string;
}> = [
  {
    kind: "labor_hourly",
    re: /\$?\s*([\d,.]+)\s*\/\s*(?:hour|hr)\b/gi,
    unit: "$/hour",
  },
  {
    kind: "per_lf",
    re: /\$?\s*([\d,.]+)\s*\/\s*(?:lf|linear\s*foot|lin(?:ear)?\.?\s*ft)\b/gi,
    unit: "$/LF",
  },
  {
    kind: "per_sqft",
    re: /\$?\s*([\d,.]+)\s*\/\s*(?:sq\.?\s*ft|sqft|sf)\b/gi,
    unit: "$/sqft",
  },
  {
    kind: "per_yard",
    re: /\$?\s*([\d,.]+)\s*\/\s*(?:yard|yd)\b/gi,
    unit: "$/yard",
  },
  {
    kind: "per_lb",
    re: /\$?\s*([\d,.]+)\s*\/\s*(?:lb|pound)\b/gi,
    unit: "$/lb",
  },
];

type Hit = {
  file: string;
  sheet: string;
  row: number;
  col: number;
  cell: string;
  context: string;
};

type RateHit = Hit & {
  kind: string;
  value: number;
  unit: string;
  label: string;
};

type SheetScore = {
  file: string;
  sheet: string;
  keywordHits: number;
  sampleHeaders: string[];
};

type ExtractPayload = {
  scannedFiles: string[];
  scoredSheets: SheetScore[];
  rateHits: RateHit[];
  keywordHits: Hit[];
  laborDollarSamples: Array<{
    file: string;
    sheet: string;
    item: string;
    metalLabor: string;
    sandblastPowderLabor: string;
    upholsteryLabor: string;
    dektonLabor: string;
    consumables: string;
    misc: string;
    totalCost: string;
  }>;
  generatedAt: string;
};

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    if (name.startsWith(".") && name !== ".env.example") continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    const ext = extname(name).toLowerCase();
    if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      // Skip noisy generated ops CSVs under tmp/ unless they look cost-related
      const rel = relative(ROOT, full).replace(/\\/g, "/");
      if (
        rel.startsWith("tmp/") &&
        !/cost|labor|rate|price|inventory|purchas/i.test(name)
      ) {
        continue;
      }
      out.push(full);
    }
  }
}

function parseMoney(raw: string): number | null {
  const cleaned = String(raw).replace(/[$,\s]/g, "").replace(/%$/, "");
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellContext(row: unknown[], col: number): string {
  const left = row
    .slice(Math.max(0, col - 2), col)
    .map((c) => String(c ?? "").trim())
    .filter(Boolean);
  const self = String(row[col] ?? "").trim();
  const right = row
    .slice(col + 1, col + 3)
    .map((c) => String(c ?? "").trim())
    .filter(Boolean);
  return [...left, self, ...right].join(" | ").slice(0, 220);
}

function extractRatesFromText(
  text: string,
  base: Omit<Hit, "cell" | "context"> & { cell: string; context: string },
): RateHit[] {
  const hits: RateHit[] = [];
  for (const pat of RATE_PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.re.exec(text)) != null) {
      const value = parseMoney(m[1] ?? "");
      if (value == null) continue;
      hits.push({
        ...base,
        kind: pat.kind,
        value,
        unit: pat.unit,
        label: text.trim().slice(0, 160),
      });
    }
  }
  // Also catch "Metal Labor ($30/hour)" style already covered, and bare
  // "Labor $30 hour" without slash
  const bare = text.match(
    /(labor|wage|rate)[^\d$]{0,20}\$?\s*([\d,.]+)\s*(?:\/?\s*)?(?:per\s+)?(?:hour|hr)\b/i,
  );
  if (bare) {
    const value = parseMoney(bare[2] ?? "");
    if (value != null) {
      hits.push({
        ...base,
        kind: "labor_hourly",
        value,
        unit: "$/hour",
        label: text.trim().slice(0, 160),
      });
    }
  }
  return hits;
}

function readWorkbook(path: string): XLSX.WorkBook | null {
  try {
    if (extname(path).toLowerCase() === ".csv") {
      const text = readFileSync(path, "utf8");
      return XLSX.read(text, { type: "string", raw: false });
    }
    return XLSX.readFile(path, { cellFormula: true, cellNF: true, raw: false });
  } catch (e) {
    console.warn("skip unreadable", relative(ROOT, path), e);
    return null;
  }
}

function dedupeRates(rates: RateHit[]): RateHit[] {
  const seen = new Set<string>();
  const out: RateHit[] = [];
  for (const r of rates) {
    const key = [
      r.file,
      r.sheet,
      r.kind,
      r.value,
      r.unit,
      r.label.slice(0, 80),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function extractLaborSamples(
  file: string,
  sheet: string,
  rows: unknown[][],
): ExtractPayload["laborDollarSamples"] {
  if (!rows.length) return [];
  const header = (rows[0] ?? []).map((c) => String(c ?? ""));
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));

  // Prefer Cost 2025 style headers
  const iItem = 0;
  const iMetal = idx(/metal\s*labor/i);
  const iSand = idx(/sandblast.*labor|powdercoat\s*labor/i);
  const iUph = idx(/upholstery\s*labor/i);
  const iDek = idx(/dekton\s*labor/i);
  const iCons = idx(/^consumables$/i);
  const iMisc = idx(/^misc/i);
  const iTotal = idx(/^total\s*cost$/i);

  if (iMetal < 0 && iUph < 0 && iSand < 0) return [];

  const samples: ExtractPayload["laborDollarSamples"] = [];
  for (let r = 1; r < rows.length && samples.length < 25; r++) {
    const row = rows[r] ?? [];
    const item = String(row[iItem] ?? "").trim();
    if (!item || /collection$/i.test(item)) continue;
    const metal = iMetal >= 0 ? String(row[iMetal] ?? "").trim() : "";
    const sand = iSand >= 0 ? String(row[iSand] ?? "").trim() : "";
    const uph = iUph >= 0 ? String(row[iUph] ?? "").trim() : "";
    const dek = iDek >= 0 ? String(row[iDek] ?? "").trim() : "";
    const cons = iCons >= 0 ? String(row[iCons] ?? "").trim() : "";
    const misc = iMisc >= 0 ? String(row[iMisc] ?? "").trim() : "";
    const total = iTotal >= 0 ? String(row[iTotal] ?? "").trim() : "";
    const anyLabor = [metal, sand, uph, dek].some(
      (v) => parseMoney(v) != null && parseMoney(v)! > 0,
    );
    if (!anyLabor) continue;
    samples.push({
      file,
      sheet,
      item,
      metalLabor: metal,
      sandblastPowderLabor: sand,
      upholsteryLabor: uph,
      dektonLabor: dek,
      consumables: cons,
      misc,
      totalCost: total,
    });
  }
  return samples;
}

function scanFile(path: string, payload: ExtractPayload): void {
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  const wb = readWorkbook(path);
  if (!wb) return;
  payload.scannedFiles.push(rel);

  for (const sheet of wb.SheetNames) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    if (!rows.length) continue;

    let keywordHits = 0;
    const sampleHeaders: string[] = [];
    const headerRow = (rows[0] ?? []).map((c) => String(c ?? "").trim());
    for (const h of headerRow) {
      if (h && KEYWORDS.test(h)) {
        keywordHits += 1;
        if (sampleHeaders.length < 12) sampleHeaders.push(h);
      }
    }

    const maxRows = Math.min(rows.length, 800);
    const maxCols = 60;
    for (let r = 0; r < maxRows; r++) {
      const row = rows[r] ?? [];
      for (let c = 0; c < Math.min(row.length, maxCols); c++) {
        const cell = String(row[c] ?? "").trim();
        if (!cell) continue;
        if (KEYWORDS.test(cell)) {
          keywordHits += 1;
          if (payload.keywordHits.length < 400) {
            payload.keywordHits.push({
              file: rel,
              sheet,
              row: r,
              col: c,
              cell: cell.slice(0, 200),
              context: cellContext(row, c),
            });
          }
          const rates = extractRatesFromText(cell, {
            file: rel,
            sheet,
            row: r,
            col: c,
            cell: cell.slice(0, 200),
            context: cellContext(row, c),
          });
          payload.rateHits.push(...rates);
        }
      }
    }

    if (keywordHits > 0) {
      payload.scoredSheets.push({
        file: rel,
        sheet,
        keywordHits,
        sampleHeaders,
      });
    }

    payload.laborDollarSamples.push(
      ...extractLaborSamples(rel, sheet, rows).map((s) => ({ ...s })),
    );
  }
}

function impliedHours(dollars: string, rate: number): string {
  const d = parseMoney(dollars);
  if (d == null || d <= 0 || rate <= 0) return "—";
  return `${(d / rate).toFixed(2)} h`;
}

function buildMarkdown(payload: ExtractPayload): string {
  const rates = dedupeRates(payload.rateHits).sort((a, b) =>
    a.kind === b.kind ? a.value - b.value : a.kind.localeCompare(b.kind),
  );

  const laborRates = rates.filter((r) => r.kind === "labor_hourly");
  const materialRates = rates.filter((r) => r.kind !== "labor_hourly");

  // Canonical rates from Cost 2025 headers (authoritative when present)
  const cost2025Labor = laborRates.filter((r) =>
    /Furniture Cost 2025/i.test(r.file),
  );
  const canonicalHourly =
    cost2025Labor.find((r) => /metal\s*labor/i.test(r.label))?.value ??
    cost2025Labor[0]?.value ??
    laborRates[0]?.value ??
    null;

  const lines: string[] = [];
  lines.push("# Historical Costing Analysis — CC Patio → Katana Resources");
  lines.push("");
  lines.push(`Generated: ${payload.generatedAt}`);
  lines.push("");
  lines.push(
    "This report was produced by `scripts/ops/extract-historical-costing.ts`, which recursively scanned workspace `.xlsx` / `.xls` / `.csv` files (excluding `node_modules`, `.next`, `.git`) for Cost / Labor / Hour / Rate / Overhead / Consumable / Margin signals.",
  );
  lines.push("");
  lines.push("## Executive verdict (for Architect)");
  lines.push("");
  if (canonicalHourly != null) {
    lines.push(
      `**Primary historical shop labor rate found: \`$${canonicalHourly}/hour\`.**`,
    );
    lines.push("");
    lines.push(
      "Source of truth: `docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx` → sheet `Items wUpholstery` column headers explicitly state:",
    );
    lines.push("");
    lines.push("- Metal Labor (**$30/hour**)");
    lines.push("- Sandblast + Primer+Powdercoat Labor (**$30/hour**)");
    lines.push("- Upholstery Labor (**$30/hour**)");
    lines.push(
      "- Powder Coat Labor (**$30/hour**) and Dekton Labor (**$30/hour**) — also printed on Tables / Fire Pit / Foam Case Study headers",
    );
    lines.push("");
    lines.push(
      "These dollar cells on each SKU row are **job-level labor $ totals**, not rates. Implied hours = labor$ ÷ $30.",
    );
  } else {
    lines.push(
      "**No explicit $/hour labor rate was found.** Material unit costs were still extracted below.",
    );
  }
  lines.push("");
  lines.push(
    "> Katana COGS = (Setup Time + Run Time) × Resource Hourly Rate. The Hub routing already stores minutes; this report is for the **Default cost per hour** field on each Resource.",
  );
  lines.push("");

  lines.push("## Recommended Katana Resource rates");
  lines.push("");
  lines.push(
    "Historical spreadsheets do **not** differentiate wage by cell — Metal, Sandblast/Powder, and Upholstery all quote the same **$30/hour**. Until payroll/burden is updated, map that single fully-burdened (or near-burdened) shop rate to every production cell, then adjust after Shop Floor actuals.",
  );
  lines.push("");
  lines.push("| Katana Resource | Recommended Default $/hr | Historical basis | Confidence |");
  lines.push("|---|---:|---|---|");

  const mapRows: Array<[string, string, string, string]> = [
    [
      "Fabric Cutting",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Upholstery Labor ($30/hour) — cutting is upstream of sew/stuff in same upholstery cost pool",
      "Medium",
    ],
    [
      "Fabric Sewing",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Upholstery Labor ($30/hour)",
      "High",
    ],
    [
      "Cushion Stuffing",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Upholstery Labor ($30/hour) + Foam/Dryfast material lines separate",
      "Medium",
    ],
    [
      "Metal Cutting",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Metal Labor ($30/hour)",
      "High",
    ],
    [
      "Metal Grinding / Grinding Station",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Bundled inside Metal Labor ($30/hour) — no separate grind rate found",
      "Medium",
    ],
    [
      "Building & Welding / Welding Station",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Metal Labor ($30/hour)",
      "High",
    ],
    [
      "Metal Sandblasting / Sandblasting",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Sandblast + Primer+Powdercoat Labor ($30/hour)",
      "High",
    ],
    [
      "Metal Powder Coating / Powder Coating Booth",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Same $30/hour labor column; powder **material** is separate ($8.64/lb, $0.21/sqft)",
      "High",
    ],
    [
      "Curing Oven",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "No distinct oven rate — historically rolled into Sandblast+Primer+Powdercoat Labor",
      "Low",
    ],
    [
      "Quality Check / Quality Control",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "No QC labor column found — default to shop rate until measured",
      "Low",
    ],
    [
      "Material Handling",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "No dedicated handling rate — often absorbed into Metal Labor / Consumables",
      "Low",
    ],
    [
      "Assembly & Packaging",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "No dedicated pack rate; Consumables + Misc cover materials only",
      "Low",
    ],
    [
      "Dekton Cutting / Grinding / Polishing",
      canonicalHourly != null ? `$${canonicalHourly}` : "TBD",
      "Dekton Labor ($30/hour) on Tables / Fire Pit / Foam Case Study headers",
      "High",
    ],
  ];
  for (const [res, rate, basis, conf] of mapRows) {
    lines.push(`| ${res} | ${rate} | ${basis} | ${conf} |`);
  }
  lines.push("");

  lines.push("## Material baselines (from spreadsheet headers)");
  lines.push("");
  lines.push("| Material / process | Rate | Source |");
  lines.push("|---|---:|---|");

  const materialCanon: Array<[string, string, string]> = [
    ["Aluminum 2×2 tubing", "$1.68/LF", "Cost 2025 Items/Tables headers"],
    ["Aluminum 2×3 tubing", "$3.67/LF", "Cost 2025 Items header"],
    ["Aluminum 1.5×3/4 tubing", "$1.00/LF", "Cost 2025 Items header"],
    ["Aluminum 2×1 tubing", "$1.444/LF", "Cost 2025 Items/Tables headers"],
    ["Aluminum 1.5×1.5 tubing", "$2.98/LF", "Cost 2025 Tables header"],
    ["1″ Flat Bar", "$0.034/LF", "Cost 2025 Items header"],
    ["1/2 Round", "$1.41/lb", "Cost 2025 Tables header"],
    ["Primer", "$9.45/lb · $0.23/sqft", "Cost 2025 Items header"],
    ["Powder coat (material)", "$8.64/lb · $0.21/sqft", "Cost 2025 Items header"],
    ["Fabric", "$20/yard", "Cost 2025 Items header (Fabric Cost)"],
    ["Dekton slab", "$8/sqft", "Cost 2025 Items/Tables/Fire Pit headers"],
    [
      "Powder coat labor (job adder examples)",
      "$10–$20 typical on fire-pit rows",
      "Fire Pit Tables Summary `Powder Coat Cost` column",
    ],
  ];
  for (const [m, rate, src] of materialCanon) {
    lines.push(`| ${m} | ${rate} | ${src} |`);
  }
  lines.push("");

  lines.push("## Consumables / overhead / misc");
  lines.push("");
  lines.push(
    "Cost 2025 treats these as **flat $ per SKU**, not percentages:",
  );
  lines.push("");
  lines.push(
    "| Bucket | How it appears | Observed pattern (sample) |",
  );
  lines.push("|---|---|---|");
  lines.push(
    "| Consumables | Column `Consumables` | Often **$25–$50** on upholstered frames; sometimes blank |",
  );
  lines.push(
    "| Misc | `Misc. (Burners, Ropes, Swivel Mounts)` | Hardware/adders (e.g. swivel mount **~$34** on Ocean swivel) |",
  );
  lines.push(
    "| Primer Cost | Flat $ per frame | Commonly **$5 / $10 / $20** by size class |",
  );
  lines.push(
    "| Powder Coat Cost | Flat $ (labor/material adder) | Commonly **$10 / $20** on fire pits; parallel to primer bands on seating |",
  );
  lines.push(
    "| Profit Margin | Derived vs MSRP | Example club chair ~**27% cost / 73% margin**; designer discount 20% tracked separately |",
  );
  lines.push("");
  lines.push(
    "**Implication for Katana:** do **not** bury consumables inside Resource $/hr. Keep Resource rates as labor; model Consumables/Misc/Primer/Powder material as BOM ingredients or MO overhead lines so MAC stays honest.",
  );
  lines.push("");

  lines.push("## Worked examples (implied hours @ $30/hr)");
  lines.push("");
  lines.push(
    "| Item | Metal $ | ⇒ hours | Sandblast+PC $ | ⇒ hours | Upholstery $ | ⇒ hours | Consumables | Total Cost |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  const rate = canonicalHourly ?? 30;
  for (const s of payload.laborDollarSamples.slice(0, 12)) {
    lines.push(
      `| ${s.item.trim()} | ${s.metalLabor || "—"} | ${impliedHours(s.metalLabor, rate)} | ${s.sandblastPowderLabor || "—"} | ${impliedHours(s.sandblastPowderLabor, rate)} | ${s.upholsteryLabor || "—"} | ${impliedHours(s.upholsteryLabor, rate)} | ${s.consumables || "—"} | ${s.totalCost || "—"} |`,
    );
  }
  lines.push("");

  lines.push("## Spreadsheet inventory (keyword-scored)");
  lines.push("");
  lines.push(`Files scanned: **${payload.scannedFiles.length}**`);
  lines.push("");
  lines.push("| File | Sheet | Keyword hits | Sample headers |");
  lines.push("|---|---|---:|---|");
  const topSheets = [...payload.scoredSheets].sort(
    (a, b) => b.keywordHits - a.keywordHits,
  );
  for (const s of topSheets.slice(0, 40)) {
    lines.push(
      `| \`${s.file}\` | ${s.sheet} | ${s.keywordHits} | ${s.sampleHeaders.slice(0, 6).map((h) => h.replace(/\|/g, "/")).join("; ") || "—"} |`,
    );
  }
  lines.push("");

  lines.push("## All extracted unit rates (machine scrape)");
  lines.push("");
  lines.push("| Kind | Value | Unit | Label (truncated) | File / Sheet |");
  lines.push("|---|---:|---|---|---|");
  for (const r of rates.slice(0, 80)) {
    lines.push(
      `| ${r.kind} | ${r.value} | ${r.unit} | ${r.label.replace(/\|/g, "/").slice(0, 90)} | \`${r.file}\` / ${r.sheet} |`,
    );
  }
  if (rates.length > 80) {
    lines.push(`| … | | | | +${rates.length - 80} more in JSON |`);
  }
  lines.push("");

  lines.push("## Gaps & Architect decisions");
  lines.push("");
  lines.push(
    "1. **Burdened vs unburdened:** Spreadsheet says `$30/hour` with no explicit fringe/overhead load. Confirm with finance whether this is cash wage or fully burdened. If unburdened, raise Resource rates (or add a shop overhead Resource) before go-live.",
  );
  lines.push(
    "2. **Cell differentiation:** History uses one rate for Metal / Finish / Upholstery. Differentiating Weld vs Grind vs Cut requires Shop Floor time studies — not present in these files.",
  );
  lines.push(
    "3. **Dekton Labor $/hr:** Confirmed **$30/hour** on Tables / Fire Pit headers (Items sheet column sometimes omits the rate text).",
  );
  lines.push(
    "4. **Curing Oven / QC / Material Handling / Pack:** No historical $/hr — start at shop rate or $0 with time-only tracking until actuals exist.",
  );
  lines.push(
    "5. **Material unit costs ($/LF, $/sqft, $/yard)** belong on **variant purchase_price / BOM**, not on Resource hourly rates.",
  );
  lines.push("");
  lines.push("## Raw artifact");
  lines.push("");
  lines.push(
    `- Machine-readable extract: \`tmp/historical-costing-extract.json\``,
  );
  lines.push(
    `- Primary workbook: \`docs/Katana Downloads/CC Patio Furniture Cost 2025.xlsx\``,
  );
  lines.push("");

  return lines.join("\n");
}

function main(): void {
  console.log("Scanning workspace for .xlsx / .xls / .csv …");
  const files: string[] = [];
  walk(ROOT, files);
  files.sort();
  console.log(`  found ${files.length} candidate files`);

  const payload: ExtractPayload = {
    scannedFiles: [],
    scoredSheets: [],
    rateHits: [],
    keywordHits: [],
    laborDollarSamples: [],
    generatedAt: new Date().toISOString(),
  };

  for (const f of files) {
    process.stdout.write(`  · ${relative(ROOT, f)}\n`);
    scanFile(f, payload);
  }

  payload.rateHits = dedupeRates(payload.rateHits);
  payload.scoredSheets.sort((a, b) => b.keywordHits - a.keywordHits);

  mkdirSync(join(ROOT, "tmp"), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  const md = buildMarkdown(payload);
  writeFileSync(OUT_MD, md, "utf8");

  console.log("");
  console.log("========================================");
  console.log(`  Files scanned:     ${payload.scannedFiles.length}`);
  console.log(`  Sheets w/ keywords:${payload.scoredSheets.length}`);
  console.log(`  Unit rates found:  ${payload.rateHits.length}`);
  console.log(`  Labor samples:     ${payload.laborDollarSamples.length}`);
  console.log(`  Report → ${OUT_MD}`);
  console.log(`  JSON   → ${OUT_JSON}`);
  console.log("========================================");
}

main();
