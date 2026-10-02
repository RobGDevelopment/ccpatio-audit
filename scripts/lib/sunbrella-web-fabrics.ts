/**
 * Extract locked e-comm Sunbrella fabrics (name + swatch image) from the
 * "CC Patio Core Sunbrella Fabric Colors" Word doc.
 *
 * Each uppercase fabric name is paired with the largest image that appears
 * before the next fabric name (handles section-break deco images).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const SUNBRELLA_FABRIC_DOCX = path.resolve(
  process.cwd(),
  "CC Patio Core Sunbrella Fabric Colors.docx",
);

export const WEB_FABRICS_DIR = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/web-fabrics",
);

/** CSV / dictionary name aliases for display-name matching. */
const NAME_ALIASES: Record<string, string> = {
  "RUE COASTAL": "RUE COSTAL",
};

export type WebFabricSelection = {
  /** Display name as printed in the colors doc (may include (C)/(P)). */
  displayName: string;
  /** Name with parenthetical code stripped, for SKU matching. */
  matchName: string;
  /** Absolute path to extracted swatch JPEG/PNG, or null if missing. */
  imagePath: string | null;
  /** Original media file name inside the docx. */
  sourceImage: string | null;
};

export function stripFabricCode(name: string): string {
  return name
    .replace(/\s*\([A-Z0-9]+\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function normalizeFabricMatchKey(name: string): string {
  const stripped = stripFabricCode(name);
  return NAME_ALIASES[stripped] ?? stripped;
}

/**
 * Match a web-fabric display name to a FAB-* dictionary row.
 * Returns null when the colorway is not in the master dictionary yet
 * (e.g. SOLVE LINEN).
 */
export function matchFabricSku(
  displayName: string,
  dictionary: ReadonlyArray<{ sku: string; name: string }>,
): { sku: string; name: string } | null {
  const key = normalizeFabricMatchKey(displayName);
  const exact = dictionary.find(
    (row) => stripFabricCode(row.name).toUpperCase() === key,
  );
  if (exact) return exact;

  // Soft fallback: dictionary name contained in display, or vice versa
  const soft = dictionary.find((row) => {
    const dictKey = stripFabricCode(row.name).toUpperCase();
    return dictKey === key || key.includes(dictKey) || dictKey.includes(key);
  });
  return soft ?? null;
}

function unzipDocx(docxPath: string): string {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Sunbrella fabric docx not found: ${docxPath}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccpatio-sunbrella-"));
  const zipPath = path.join(tmp, "doc.zip");
  fs.copyFileSync(docxPath, zipPath);

  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${path.join(tmp, "out").replace(/'/g, "''")}' -Force`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } else {
    execFileSync("unzip", ["-q", zipPath, "-d", path.join(tmp, "out")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return path.join(tmp, "out");
}

type DocEvent =
  | { type: "name"; value: string }
  | { type: "image"; value: string; size: number };

function parseDocEvents(extractedRoot: string): DocEvent[] {
  const xml = fs.readFileSync(
    path.join(extractedRoot, "word/document.xml"),
    "utf8",
  );
  const rels = fs.readFileSync(
    path.join(extractedRoot, "word/_rels/document.xml.rels"),
    "utf8",
  );
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(
    /Id="(rId\d+)"[^>]*Target="media\/([^"]+)"/g,
  )) {
    relMap.set(m[1]!, m[2]!);
  }

  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1];
  if (!body) throw new Error("Invalid docx: missing w:body");

  const paras = [...body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) => m[0]!);
  const events: DocEvent[] = [];

  for (const pxml of paras) {
    const text = pxml
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .trim();
    const embeds = [...pxml.matchAll(/r:embed="(rId\d+)"/g)]
      .map((m) => relMap.get(m[1]!))
      .filter((v): v is string => Boolean(v));

    if (text && !/[a-z]/.test(text)) {
      const tokens = [
        ...text.matchAll(
          /[A-Z][A-Z0-9]*(?:\s+[A-Z0-9]+)*(?:\s*\([A-Z0-9]+\))?/g,
        ),
      ].map((m) =>
        m[0]!.replace(/\s+/g, " ").replace(/([A-Z0-9])\(/g, "$1 (").trim(),
      );
      for (const t of tokens) events.push({ type: "name", value: t });
    }

    for (const img of embeds) {
      const fp = path.join(extractedRoot, "word/media", img);
      const size = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
      if (size < 500) continue;
      events.push({ type: "image", value: img, size });
    }
  }
  return events;
}

/**
 * Parse fabric name → best swatch image from the colors docx (in memory).
 * Does not write files.
 */
export function parseSunbrellaWebFabricsFromDocx(
  docxPath = SUNBRELLA_FABRIC_DOCX,
): Array<{ displayName: string; sourceImage: string | null; imageBytes: Buffer | null }> {
  const extractedRoot = unzipDocx(docxPath);
  try {
    const events = parseDocEvents(extractedRoot);
    const rows: Array<{
      displayName: string;
      sourceImage: string | null;
      imageBytes: Buffer | null;
    }> = [];

    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i]!;
      if (ev.type !== "name") continue;
      const gapImages: Array<{ value: string; size: number }> = [];
      for (let j = i + 1; j < events.length; j += 1) {
        const next = events[j]!;
        if (next.type === "name") break;
        gapImages.push(next);
      }
      gapImages.sort((a, b) => b.size - a.size);
      const best = gapImages[0] ?? null;
      let imageBytes: Buffer | null = null;
      if (best) {
        const fp = path.join(extractedRoot, "word/media", best.value);
        if (fs.existsSync(fp)) imageBytes = fs.readFileSync(fp);
      }
      rows.push({
        displayName: ev.value,
        sourceImage: best?.value ?? null,
        imageBytes,
      });
    }
    return rows;
  } finally {
    fs.rmSync(path.dirname(extractedRoot), { recursive: true, force: true });
  }
}

/**
 * Extract swatches to disk under docs/Vividworks/Handoff/web-fabrics/ and
 * return the selection list used by workbook generators.
 */
export function extractSunbrellaWebFabrics(
  docxPath = SUNBRELLA_FABRIC_DOCX,
  outDir = WEB_FABRICS_DIR,
): WebFabricSelection[] {
  const parsed = parseSunbrellaWebFabricsFromDocx(docxPath);
  fs.mkdirSync(outDir, { recursive: true });
  for (const existing of fs.readdirSync(outDir)) {
    fs.rmSync(path.join(outDir, existing), { force: true });
  }

  const selections: WebFabricSelection[] = parsed.map((row, i) => {
    let imagePath: string | null = null;
    if (row.imageBytes && row.sourceImage) {
      const ext = path.extname(row.sourceImage).toLowerCase() || ".jpg";
      const safe = stripFabricCode(row.displayName)
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const fileName = `${String(i + 1).padStart(2, "0")}-${safe}${ext}`;
      imagePath = path.join(outDir, fileName);
      fs.writeFileSync(imagePath, row.imageBytes);
    }
    return {
      displayName: row.displayName,
      matchName: stripFabricCode(row.displayName),
      imagePath,
      sourceImage: row.sourceImage,
    };
  });

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        source: path.basename(docxPath),
        extractedAt: new Date().toISOString(),
        count: selections.length,
        fabrics: selections.map((s) => ({
          displayName: s.displayName,
          matchName: s.matchName,
          image: s.imagePath ? path.basename(s.imagePath) : null,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  return selections;
}
