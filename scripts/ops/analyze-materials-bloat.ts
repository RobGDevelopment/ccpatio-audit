/**
 * Forensic bloat analysis of a Katana Materials CSV export.
 *
 * Source: docs/Katana Downloads/MaterialList-2026-09-14-14_46.csv
 * (~1,025 materials: Name, Variant code / SKU, barcode, Category, supplier, price)
 *
 * The export has NO UoM column. UoM findings are inferred from SKU prefix +
 * name keywords (same dictionary as the Phase 1/2 material sync) and flagged
 * as risk, not as observed Katana uom values.
 *
 *   npm run ops:analyze-materials-bloat
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inferMaterialUom } from "../../src/lib/katana-material-uom";
import { col, readCsvRecords } from "./lib/csv";

const SOURCE = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "MaterialList-2026-09-14-14_46.csv",
);
const OUT_PATH = join(process.cwd(), "tmp", "material-bloat-report.md");

type MaterialRow = {
  line: number;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  supplier: string;
  price: string;
};

type Group = { key: string; rows: MaterialRow[] };

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function normalizeName(raw: string): string {
  return raw
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function compactSize(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[""'']/g, "")
    .replace(/\s+/g, "")
    .replace(/×/g, "X")
    .replace(/\//g, "X");
}

function skuPrefix(sku: string): string {
  if (!sku) return "(blank SKU)";
  const cut = sku.indexOf("-");
  return cut === -1 ? sku : sku.slice(0, cut + 1);
}

function isHardwareName(name: string, sku: string): boolean {
  const n = `${name} ${sku}`.toUpperCase();
  return (
    sku.startsWith("RM-HRD-") ||
    sku.startsWith("HRD-") ||
    /\b(CAP|SPACER|PLUG|RING|HOLDER|BLADE|RAGS?|WIRE|MASKING)\b/.test(n)
  );
}

function isWeldmentSku(sku: string): boolean {
  return /^(SA-|FIN-|ASM-|CUT-)/.test(sku);
}

function looksLikeTubing(row: MaterialRow): boolean {
  if (isWeldmentSku(row.sku) || isHardwareName(row.name, row.sku)) return false;
  const blob = `${row.name} ${row.sku}`.toUpperCase();
  if (/TUBING|\bTUBE\b/.test(blob)) return true;
  return (
    (row.sku.startsWith("RM-MET-") || row.sku.startsWith("MET-")) &&
    /(^|[^0-9])2X2([^0-9]|$)/.test(compactSize(blob))
  );
}

function looksLikeFlatbar(row: MaterialRow): boolean {
  if (isWeldmentSku(row.sku)) return false;
  const blob = `${row.name} ${row.sku}`.toUpperCase();
  if (isHardwareName(row.name, row.sku) && !/FLAT/.test(blob)) return false;
  return /FLAT\s*BAR|FLATBAR|\bFLAT\b/.test(blob);
}

function looksLikeFabric(row: MaterialRow): boolean {
  const n = row.name.toUpperCase();
  return (
    row.sku.startsWith("FAB-") ||
    row.sku.startsWith("RM-FAB-") ||
    row.category.toLowerCase() === "fabric" ||
    n.includes("SUNBRELLA") ||
    n === "FABRIC" ||
    n.includes("FABRIC")
  );
}

function looksLikeMetalExtrusion(row: MaterialRow): boolean {
  if (isHardwareName(row.name, row.sku)) return false;
  if (looksLikeTubing(row) || looksLikeFlatbar(row)) return true;
  if (row.sku.startsWith("RM-MET-")) return true;
  const n = row.name.toUpperCase();
  return (
    (row.sku.startsWith("MET-") && /TUBE|TUBING|FLAT/.test(n)) ||
    (row.category.toLowerCase() === "metal" && /TUBE|TUBING|FLATBAR|FLAT BAR/.test(n))
  );
}

function looksLikeFabricUom(row: MaterialRow): boolean {
  return looksLikeFabric(row);
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function collisions(map: Map<string, MaterialRow[]>): Group[] {
  return [...map.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
}

function table(headers: string[], rows: string[][], limit = 40): string {
  const shown = rows.slice(0, limit);
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...shown.map((r) => `| ${r.map(mdEscape).join(" | ")} |`),
  ];
  if (rows.length > limit) {
    lines.push("");
    lines.push(`_Showing ${limit} of ${rows.length}._`);
  }
  return lines.join("\n");
}

function rowCells(r: MaterialRow): string[] {
  return [
    r.name || "(blank)",
    r.sku || "(blank SKU)",
    r.barcode || "",
    r.category || "(none)",
    r.price || "",
  ];
}

function loadRows(): MaterialRow[] {
  const records = readCsvRecords(SOURCE);
  if (records.length === 0) {
    throw new Error(`No rows in ${SOURCE}`);
  }
  return records.map((rec, i) => ({
    line: i + 2,
    name: col(rec, "Name"),
    sku: normalizeSku(col(rec, "Variant code / SKU")),
    barcode: col(rec, "Internal barcode"),
    category: col(rec, "Category"),
    supplier: col(rec, "Default supplier"),
    price: col(rec, "Default purchase price"),
  }));
}

function hasSizeToken(blob: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(blob);
}

function tubingSizeKey(row: MaterialRow): string {
  const raw = `${row.name} ${row.sku}`.toUpperCase();
  const blob = compactSize(raw);
  if (/2\s*[X×]\s*3\s*\/\s*4|2X3X4|2X075/.test(`${raw} ${blob}`)) return "2X3/4";
  if (/1\.5\s*[X×]\s*3\s*\/\s*4|15X075|1\.5X075|1\.5X3X4/.test(`${raw} ${blob}`)) {
    return "1.5X3/4";
  }
  const ordered = ["2X2", "2X1", "2X3", "4X2", "3X2", "3X3", "1X1"];
  for (const p of ordered) {
    if (hasSizeToken(blob, p)) return p;
  }
  return "other-tube";
}

function fabricColorKey(row: MaterialRow): string {
  return normalizeName(row.name)
    .replace(/\bSUNBRELLA\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function expectedUom(row: MaterialRow): { expected: string; rule: string } {
  if (isHardwareName(row.name, row.sku)) {
    return { expected: "ea/pcs", rule: "hardware (cap/plug/wire/blade/rag)" };
  }
  if (looksLikeFabricUom(row)) {
    return { expected: "yd", rule: "fabric" };
  }
  if (
    row.sku.startsWith("PWD-") &&
    !/POWDER|PRIMER/.test(row.name.toUpperCase()) &&
    !row.sku.includes("PRIMER")
  ) {
    return { expected: "ea/pcs", rule: "PWD-* but not a powder/primer" };
  }
  if (row.sku) {
    const inferred = inferMaterialUom(row.sku);
    return { expected: inferred.uom, rule: inferred.rule };
  }
  if (looksLikeMetalExtrusion(row)) {
    return { expected: "ft", rule: "blank-SKU metal extrusion (name)" };
  }
  if (/FOAM/.test(row.name.toUpperCase())) {
    return { expected: "boardft", rule: "foam (name)" };
  }
  if (/DEKTON|SLAB/.test(row.name.toUpperCase())) {
    return { expected: "slab", rule: "dekton (name)" };
  }
  if (/POWDER|PRIMER/.test(row.name.toUpperCase())) {
    return { expected: "lb", rule: "powder (name)" };
  }
  return { expected: "unknown", rule: "no sku / no keyword" };
}

function uomRisk(row: MaterialRow): string | null {
  const { expected, rule } = expectedUom(row);
  if (looksLikeMetalExtrusion(row) && expected === "ft") {
    if (!row.sku) {
      return `metal extrusion with blank SKU — Katana factory placeholders historically default to pcs; expected ft (${rule})`;
    }
    if (row.sku.startsWith("MET-") || row.sku.startsWith("RM-MET-")) {
      return `linear metal SKU ${row.sku} — expected ft, not pcs`;
    }
  }
  if (looksLikeFabricUom(row) && expected === "yd") {
    if (!row.sku) {
      return `fabric with blank SKU — expected yd, Katana default is often pcs`;
    }
    return `fabric SKU ${row.sku} — expected yd, not pcs`;
  }
  if (rule === "PWD-* but not a powder/primer") {
    return `SKU parked in PWD-* but name is not powder — do not consume as lb`;
  }
  if (
    row.sku.startsWith("MET-") &&
    isHardwareName(row.name, row.sku) &&
    inferMaterialUom(row.sku).uom === "ft"
  ) {
    return `MET-* prefix dictionary would assign ft, but this is hardware/consumable — expected ea/pcs`;
  }
  return null;
}

function main(): void {
  const rows = loadRows();
  const blankSku = rows.filter((r) => !r.sku);
  const withSku = rows.filter((r) => r.sku);

  const skuGroups = collisions(groupBy(withSku, (r) => r.sku));
  const nameGroups = collisions(groupBy(rows, (r) => normalizeName(r.name))).filter(
    (g) => new Set(g.rows.map((r) => r.sku || `blank:${r.barcode}`)).size > 1,
  );

  const prefixCounts = [...groupBy(rows, (r) => skuPrefix(r.sku)).entries()]
    .map(([prefix, list]) => ({ prefix, n: list.length }))
    .sort((a, b) => b.n - a.n || a.prefix.localeCompare(b.prefix));

  const categoryCounts = [...groupBy(rows, (r) => r.category || "(none)").entries()]
    .map(([category, list]) => ({ category, n: list.length }))
    .sort((a, b) => b.n - a.n);

  const tubing = rows.filter(looksLikeTubing);
  const tubingBySize = [...groupBy(tubing, tubingSizeKey).entries()]
    .map(([key, list]) => ({ key, rows: list }))
    .sort((a, b) => b.rows.length - a.rows.length);

  const flatbars = rows.filter(looksLikeFlatbar);
  const fabrics = rows.filter(looksLikeFabric);
  const sunbrella = fabrics.filter((r) =>
    /SUNBRELLA/.test(`${r.name} ${r.sku}`.toUpperCase()),
  );
  const fabricNameDups = collisions(
    groupBy(fabrics, fabricColorKey),
  ).filter((g) => g.rows.length > 1);

  const wrongType = rows.filter((r) => isWeldmentSku(r.sku));

  const uomFlags = rows
    .map((r) => ({ row: r, note: uomRisk(r) }))
    .filter((x): x is { row: MaterialRow; note: string } => x.note != null);

  const metalFtRisk = uomFlags.filter((x) => x.note.includes("expected ft"));
  const fabricYdRisk = uomFlags.filter((x) => x.note.includes("expected yd"));
  const prefixLie = uomFlags.filter(
    (x) =>
      x.note.includes("PWD-*") || x.note.includes("MET-* prefix dictionary"),
  );

  const generated = new Date().toISOString();

  const parts: string[] = [];
  parts.push("# Katana Material Catalog Bloat Report");
  parts.push("");
  parts.push(`Generated: ${generated}`);
  parts.push("");
  parts.push(`Source: \`${SOURCE}\``);
  parts.push("");
  parts.push("## Executive verdict");
  parts.push("");
  parts.push(
    `The export contains **${rows.length} material rows**. This catalog is bloated in three different ways: (1) **blank-SKU factory placeholders** sitting next to the reminted \`RM-*\` / \`MET-*\` twins, (2) **purchasing-cousin steel/aluminum SKUs** that describe the same extrusion as Hub \`RM-MET-*\` recipes, and (3) **${wrongType.length} sub-assemblies / finished goods** (\`SA-*\` / \`FIN-*\` / \`ASM-*\`) that should never have been materials.`,
  );
  parts.push("");
  parts.push(
    `The CSV **does not include a UoM column**, so UoM findings below are **inferred risk** from SKU prefix + name (metals/extrusions → ft, fabric → yd, powder → lb, hardware → ea). Katana's historical default for a new material is **pcs**.`,
  );
  parts.push("");
  parts.push("| Metric | Count |");
  parts.push("| --- | ---: |");
  parts.push(`| Material rows | ${rows.length} |`);
  parts.push(`| Blank Variant code / SKU | ${blankSku.length} |`);
  parts.push(`| Rows with a SKU | ${withSku.length} |`);
  parts.push(`| Exact SKU collisions | ${skuGroups.length} SKUs |`);
  parts.push(`| Exact name collisions (different SKUs) | ${nameGroups.length} names |`);
  parts.push(`| Tubing / tube / 2x2 cluster | ${tubing.length} |`);
  parts.push(`| Flatbar cluster | ${flatbars.length} |`);
  parts.push(`| Fabric cluster | ${fabrics.length} |`);
  parts.push(`| Sunbrella-named fabrics | ${sunbrella.length} |`);
  parts.push(`| SA-/FIN-/ASM-/CUT- parked as materials | ${wrongType.length} |`);
  parts.push(`| UoM risk flags | ${uomFlags.length} |`);
  parts.push("");
  parts.push("## 1. Exact SKU collisions");
  parts.push("");
  if (skuGroups.length === 0) {
    parts.push(
      "No non-blank Variant code / SKU appears on more than one row in this export. Collisions here are **name-level and blank-SKU**, not duplicate SKU strings.",
    );
  } else {
    parts.push(
      `${skuGroups.length} SKU(s) appear on multiple rows.`,
    );
    parts.push("");
    parts.push(
      table(
        ["SKU", "n", "names", "barcodes"],
        skuGroups.map((g) => [
          g.key,
          String(g.rows.length),
          g.rows.map((r) => r.name).join(" · "),
          g.rows.map((r) => r.barcode).join(" · "),
        ]),
      ),
    );
  }
  parts.push("");
  parts.push("## 2. Exact name collisions (same Name, different SKUs)");
  parts.push("");
  parts.push(
    `**${nameGroups.length}** names are reused across different SKUs (or blank SKU vs reminted SKU). Worst offenders are the original factory placeholders next to Hub \`RM-*\` rows.`,
  );
  parts.push("");
  parts.push(
    table(
      ["Name", "n", "SKU / barcode / price"],
      nameGroups.map((g) => [
        g.key,
        String(g.rows.length),
        g.rows
          .map(
            (r) =>
              `${r.sku || "(blank)"} · barcode ${r.barcode || "—"} · $${r.price || "0"}`,
          )
          .join("; "),
      ]),
      30,
    ),
  );
  parts.push("");
  parts.push("## 3. Blank SKUs (factory placeholders)");
  parts.push("");
  parts.push(
    `**${blankSku.length}** materials have an empty Variant code / SKU. These are the original Katana cut-list placeholders. Several were later reminted with \`RM-*\` SKUs, leaving both copies live.`,
  );
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Barcode", "Category", "Price"],
      blankSku.map(rowCells),
      20,
    ),
  );
  parts.push("");
  parts.push("## 4. Fuzzy bloat — Tubing / Tube / 2x2");
  parts.push("");
  parts.push(
    `**${tubing.length}** rows mention tubing/tube/2x2 (hardware caps excluded). This is the densest physical-item collision: blank-SKU factory tube, Hub \`RM-MET-*-TUBING\`, and purchasing \`MET-TB*\` / \`MET-SQT*\` cousins for the same section.`,
  );
  parts.push("");
  for (const cluster of tubingBySize.slice(0, 8)) {
    parts.push(`### ${cluster.key} (${cluster.rows.length})`);
    parts.push("");
    parts.push(
      table(
        ["Name", "SKU", "Barcode", "Category", "Price"],
        cluster.rows.map(rowCells),
        25,
      ),
    );
    parts.push("");
  }
  parts.push("## 5. Fuzzy bloat — Flatbar / Flat bar");
  parts.push("");
  parts.push(
    `**${flatbars.length}** rows look like flat bar (factory \`Flatbar\`, Hub \`RM-MET-FLATBAR\` if present, and purchasing \`MET-FH*\` / \`MET-10019*\` HR flats).`,
  );
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Barcode", "Category", "Price"],
      flatbars.map(rowCells),
      30,
    ),
  );
  parts.push("");
  parts.push("## 6. Fuzzy bloat — Fabric / Sunbrella / color twins");
  parts.push("");
  parts.push(
    `**${fabrics.length}** fabric-like rows (${sunbrella.length} with "Sunbrella" in the name). Most are legitimate \`FAB-*\` colorways at $20/yd. Bloat is the generic placeholders plus near-duplicate color names.`,
  );
  parts.push("");
  parts.push("Exact fabric name collisions:");
  parts.push("");
  if (fabricNameDups.length === 0) {
    parts.push("None after name normalization.");
  } else {
    parts.push(
      table(
        ["Normalized name", "n", "SKUs"],
        fabricNameDups.map((g) => [
          g.key,
          String(g.rows.length),
          g.rows.map((r) => r.sku || "(blank)").join(" · "),
        ]),
      ),
    );
  }
  parts.push("");
  parts.push("Near-duplicate fabric names (prefix / one-edit):");
  parts.push("");
  const nearPairs = uniqueNearPairs(fabrics);
  if (nearPairs.length === 0) {
    parts.push("None detected.");
  } else {
    parts.push(
      table(
        ["Name A", "SKU A", "Name B", "SKU B"],
        nearPairs.map((p) => [p.a.name, p.a.sku, p.b.name, p.b.sku]),
        25,
      ),
    );
  }
  parts.push("");
  const fabricPlaceholders = fabrics.filter(
    (r) => !r.sku || r.sku.startsWith("RM-FAB-") || r.name.toUpperCase() === "FABRIC",
  );
  parts.push("Fabric placeholders vs colorways:");
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Barcode", "Category", "Price"],
      fabricPlaceholders.map(rowCells),
    ),
  );
  parts.push("");
  parts.push("## 7. UoM inconsistencies (inferred — export has no UoM column)");
  parts.push("");
  parts.push(
    "Katana's material export used here only has Name / SKU / barcode / Category / supplier / price. **Actual UoM is not in the file.** Flags below are the items that *will be wrong* if they are still on Katana's default **pcs**, or if the MET-/PWD- prefix dictionary is applied blindly.",
  );
  parts.push("");
  parts.push(`| Risk class | Count |`);
  parts.push(`| --- | ---: |`);
  parts.push(`| Metal / extrusion expected **ft** (not pcs) | ${metalFtRisk.length} |`);
  parts.push(`| Fabric expected **yd** (not pcs) | ${fabricYdRisk.length} |`);
  parts.push(`| Prefix lies (PWD- non-powder, MET- hardware) | ${prefixLie.length} |`);
  parts.push("");
  parts.push("### Metals / extrusions expected ft");
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Category", "Price", "Risk"],
      metalFtRisk.map((x) => [
        x.row.name,
        x.row.sku || "(blank SKU)",
        x.row.category,
        x.row.price,
        x.note,
      ]),
      35,
    ),
  );
  parts.push("");
  parts.push("### Fabrics expected yd");
  parts.push("");
  parts.push(
    `All **${fabricYdRisk.length}** fabric rows are expected **yd**. Worst offenders for a pcs trap are the blank-SKU generic \`Fabric\` and \`RM-FAB-GENERIC\` placeholder.`,
  );
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Barcode", "Category", "Price"],
      fabricYdRisk.slice(0, 8).map((x) => rowCells(x.row)),
    ),
  );
  parts.push("");
  parts.push("### Prefix dictionary would assign the wrong UoM");
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Category", "Price", "Risk"],
      prefixLie.map((x) => [
        x.row.name,
        x.row.sku || "(blank SKU)",
        x.row.category,
        x.row.price,
        x.note,
      ]),
    ),
  );
  parts.push("");
  parts.push("## 8. Wrong item type — SA-/FIN-/ASM parked as materials");
  parts.push("");
  parts.push(
    `**${wrongType.length}** rows use sub-assembly or finished-good SKUs inside the **Materials** export. These inflate the catalog, collide with product variants, and are the duplicate-SKU problem seen on the live tenant (two variant IDs per SA-FRAME). They are not raw materials.`,
  );
  parts.push("");
  const wrongPrefix = [...groupBy(wrongType, (r) => skuPrefix(r.sku)).entries()]
    .map(([prefix, list]) => [prefix, String(list.length)]);
  parts.push(table(["Prefix", "Count"], wrongPrefix));
  parts.push("");
  parts.push("Examples:");
  parts.push("");
  parts.push(
    table(
      ["Name", "SKU", "Barcode", "Category", "Price"],
      wrongType.map(rowCells),
      20,
    ),
  );
  parts.push("");
  parts.push("## 9. Prefix and category mix");
  parts.push("");
  parts.push(table(["SKU prefix", "Count"], prefixCounts.map((p) => [p.prefix, String(p.n)])));
  parts.push("");
  parts.push(table(["Category", "Count"], categoryCounts.map((c) => [c.category, String(c.n)])));
  parts.push("");
  parts.push("## Recommended next actions");
  parts.push("");
  parts.push("1. **Do not POST duplicates.** The six missing Hub materials from `katana-material-sync` (`RM-HRD-SPACERS`, `RM-HRD-UMBRELLA-HOLDER`, `RM-MET-2X075-TUBING`, `RM-MET-FLATBAR`, `RM-RAW-FOAM`, `RM-RAW-IRON-WOOD`) must be created on the *blank-SKU placeholders if they still exist*, or as new SKUs — not as a third 2x2/foam/wood copy.");
  parts.push("2. **Archive blank-SKU factory twins** once the `RM-*` remint is the recipe ingredient (e.g. blank `2x2 Tubing` barcode 10023 vs `RM-MET-2X2-TUBING`).");
  parts.push("3. **Keep purchasing `MET-TB*` / `MET-SQT*` / `MET-FH*` as buy-side SKUs**; do not use them as BOM ingredients. Recipes stay on `RM-MET-*`.");
  parts.push("4. **Move `SA-*` / `FIN-*` out of Materials** (convert or archive). They belong on Products.");
  parts.push("5. **Fix UoM on remaining factory metals/fabrics to ft / yd** before the BOM re-import, especially blank-SKU tubing/flatbar/fabric.");
  parts.push("6. **Rename or archive PWD- miskeys** (`PWD-HIGH-TEMP-SILICONE-TAPERED-MASKING-PLUGS`, `PWD-METAL-WIRE-FOR-HANGING-FRAMES`) — they are not powder and must not consume as lb.");
  parts.push("");

  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(OUT_PATH, `${parts.join("\n")}\n`, "utf8");

  console.log("Katana material bloat analysis");
  console.log(`  source: ${SOURCE}`);
  console.log(`  rows: ${rows.length}`);
  console.log(`  blank SKU: ${blankSku.length}`);
  console.log(`  exact SKU collisions: ${skuGroups.length}`);
  console.log(`  exact name collisions: ${nameGroups.length}`);
  console.log(`  tubing cluster: ${tubing.length}`);
  console.log(`  flatbar cluster: ${flatbars.length}`);
  console.log(`  fabric cluster: ${fabrics.length}`);
  console.log(`  SA/FIN/ASM as materials: ${wrongType.length}`);
  console.log(`  UoM risk flags: ${uomFlags.length}`);
  console.log(`  near fabric pairs: ${nearPairs.length}`);
  console.log(`  report: ${OUT_PATH}`);
}

function levenshteinish(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a.length < 8 || b.length < 8) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 2) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  edits += a.length - i + (b.length - j);
  return edits > 0 && edits <= 2;
}

function uniqueNearPairs(
  fabrics: MaterialRow[],
): Array<{ a: MaterialRow; b: MaterialRow }> {
  const out: Array<{ a: MaterialRow; b: MaterialRow }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < fabrics.length; i += 1) {
    const a = fabrics[i]!;
    const ka = fabricColorKey(a);
    for (let j = i + 1; j < fabrics.length; j += 1) {
      const b = fabrics[j]!;
      const kb = fabricColorKey(b);
      if (ka === kb) continue;
      const close =
        (ka.startsWith(kb) || kb.startsWith(ka)) &&
        Math.abs(ka.length - kb.length) <= 3 &&
        Math.min(ka.length, kb.length) >= 8;
      if (!close && !levenshteinish(ka, kb)) continue;
      const key = [ka, kb].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b });
    }
  }
  return out.sort((x, y) => x.a.name.localeCompare(y.a.name));
}

main();
