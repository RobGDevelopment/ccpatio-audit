/**
 * finishes:process — CV safe-square / illumination / seamless-tile + 32-SKU match audit.
 * Raw + processed media live under C:\Workspace\ccpatio-media-staging\ (outside git).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ECOMMERCE_32_FINISHES,
  type EcommerceFinishDefinition,
  type EcommerceFinishFamily,
} from "../../src/server/ecommerce/ecommerce-32-finish-roster";
import { deriveFinishPhysicalScale } from "../../src/server/assets/finish-assets";
import {
  listRawStudioPhotos,
  processStudioPhoto,
  synthesizeCabanaClassic,
  synthesizeSolidTexture,
  OUT_ROOT,
  STAGING_ROOT,
  TEXTURE_DIR,
  THUMB_DIR,
  OVERLAY_DIR,
  type CvProcessResult,
} from "./lib/swatch-cv-pipeline";
import { verifyAllProcessed } from "./lib/swatch-pixel-qa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const REF_FABRICS = path.join(REPO_ROOT, "docs", "Vividworks", "Handoff", "web-fabrics");
const GREY_SUNBRELLA_FALLBACK = "FAB-CRU-ASH";

export type ManifestEntry = {
  sku: string;
  display_name: string;
  family: EcommerceFinishFamily;
  category: string;
  hex: string;
  source_type: "studio_photo" | "synthetic_fallback";
  source_file: string | null;
  duplicate_of?: string | null;
  confidence: "high" | "medium" | "low";
  lookalikes: string[];
  pixels_per_inch: number | null;
  cropped_width_in: number | null;
  repeat_inches: number;
  texture_scale: number;
  sample_width_in: number;
  sample_height_in: number;
  pattern_repeat_w_in: number | null;
  pattern_repeat_h_in: number | null;
  texture_path: string;
  thumb_path: string;
  overlay_path: string | null;
  lab: number[] | null;
  notes: string[];
};

const REF_NAME_BY_SKU: Record<string, string> = {
  "FAB-CAB-CLA": "02-CABANA-CLASSIC.jpg",
  "FAB-CAN-BLA": "03-CANVAS-BLACK.jpg",
  "FAB-CAN-WHI": "05-CANVAS-WHITE.jpg",
  "FAB-CRU-ASH": "09-CRUSH-ASH.jpg",
  "FAB-DUM-STU": "11-DUMONT-STUCCO.jpg",
  "FAB-HER-PAP": "14-HERITAGE-PAPYRUS.jpg",
  "FAB-KIN-SIL": "15-KINDLE-SILK.jpg",
  "FAB-MET-CLO": "19-METAMORPHIC-CLOUD.jpg",
  "FAB-POS-SAP": "26-POSH-SAPPHIRE.jpg",
  "FAB-PRE-FAW": "27-PRECISE-FAWN.jpg",
  "FAB-RUE-COS": "29-RUE-COASTAL.jpg",
  "FAB-RIT-ROS": "31-RITSY-ROSEMARY.jpg",
  "FAB-RIT-NEC": "32-RITSY-NECTAR.jpg",
  "FAB-SHE-LIN": "34-SHELTER-LINEN.jpg",
};

function hexToLab(hex: string): number[] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047);
  const fy = f(Y / 1.0);
  const fz = f(Z / 1.08883);
  const L = (116 * fy - 16) * (255 / 100);
  const a = 500 * (fx - fy) * (255 / 256) + 128;
  const bb = 200 * (fy - fz) * (255 / 256) + 128;
  return [L, a, bb];
}

function labDist(a: number[], b: number[]): number {
  const dL = a[0]! - b[0]!;
  const da = a[1]! - b[1]!;
  const db = a[2]! - b[2]!;
  return Math.sqrt(dL * dL + da * da + db * db);
}

async function refLab(sku: string): Promise<number[] | null> {
  const name = REF_NAME_BY_SKU[sku];
  if (!name) return null;
  const p = path.join(REF_FABRICS, name);
  if (!fs.existsSync(p)) return null;
  const { data, info } = await sharp(p)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
  }
  r = Math.round(r / n);
  g = Math.round(g / n);
  b = Math.round(b / n);
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  return hexToLab(hex);
}

function familyForFolder(folder: string): EcommerceFinishFamily[] {
  if (folder === "Fabrics") return ["sunbrella"];
  if (folder === "Dekton") return ["dekton"];
  if (folder === "PowderCoat") return ["powder"];
  return [];
}

function lookalikesFor(def: EcommerceFinishDefinition): string[] {
  const powderLooks: Record<string, string[]> = {
    "PWD-WHITE": ["PWD-BONE", "PWD-LITE-BEIGE"],
    "PWD-BONE": ["PWD-WHITE", "PWD-LITE-BEIGE"],
    "PWD-LITE-BEIGE": ["PWD-BONE", "PWD-WHITE"],
    "PWD-BLACK": ["PWD-OIL-RUB-BRONZE"],
    "PWD-OIL-RUB-BRONZE": ["PWD-BLACK"],
    "PWD-FANUC-GRAY": ["DKT-ALDEM", "DKT-STRATO"],
  };
  const fabricLooks: Record<string, string[]> = {
    "FAB-CAN-WHI": ["FAB-KIN-SIL", "FAB-HER-PAP"],
    "FAB-KIN-SIL": ["FAB-CAN-WHI", "FAB-HER-PAP"],
    "FAB-HER-PAP": ["FAB-SHE-LIN", "FAB-KIN-SIL"],
    "FAB-SHE-LIN": ["FAB-HER-PAP", "FAB-DUM-STU"],
    "FAB-CAN-BLA": ["FAB-CAN-NAV", "PWD-BLACK"],
    "FAB-CAN-NAV": ["FAB-POS-SAP", "FAB-CAN-BLA"],
    "FAB-RIT-NEC": ["FAB-PRE-FAW", "FAB-CAN-HEN"],
    "FAB-RIT-ROS": ["FAB-RUE-COS"],
    "FAB-CRU-ASH": ["FAB-MET-CLO", "FAB-DUM-STU"],
  };
  return powderLooks[def.sku] ?? fabricLooks[def.sku] ?? [];
}

function confidenceFromDist(d: number, hasRef: boolean): "high" | "medium" | "low" {
  if (hasRef) {
    if (d < 28) return "high";
    if (d < 48) return "medium";
    return "low";
  }
  if (d < 35) return "high";
  if (d < 55) return "medium";
  return "low";
}

function isCopyName(row: CvProcessResult): boolean {
  return (row.relative ?? "").toLowerCase().includes("copy");
}

function preferCanonical(a: CvProcessResult, b: CvProcessResult): CvProcessResult {
  if (isCopyName(a) !== isCopyName(b)) return isCopyName(a) ? b : a;
  return (a.relative ?? "").localeCompare(b.relative ?? "") <= 0 ? a : b;
}

async function renameOutputs(tmpId: string, sku: string): Promise<{ texture: string; thumb: string }> {
  const texSrc = path.join(TEXTURE_DIR, `${tmpId}.jpg`);
  const thSrc = path.join(THUMB_DIR, `${tmpId}.jpg`);
  const texDst = path.join(TEXTURE_DIR, `${sku}.jpg`);
  const thDst = path.join(THUMB_DIR, `${sku}.jpg`);
  if (fs.existsSync(texDst)) fs.unlinkSync(texDst);
  if (fs.existsSync(thDst)) fs.unlinkSync(thDst);
  fs.renameSync(texSrc, texDst);
  fs.renameSync(thSrc, thDst);
  const meta = await sharp(texDst).metadata();
  if (meta.width !== 2048 || meta.height !== 2048) {
    throw new Error(`${sku} texture not 2048x2048 (${meta.width}x${meta.height})`);
  }
  const tm = await sharp(thDst).metadata();
  if (tm.width !== 512 || tm.height !== 512) {
    throw new Error(`${sku} thumb not 512x512`);
  }
  return { texture: texDst, thumb: thDst };
}

function fileToDataUri(p: string | null | undefined): string {
  if (!p || !fs.existsSync(p)) return "";
  const buf = fs.readFileSync(p);
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

async function buildTilePreview(texturePath: string, outPath: string): Promise<string> {
  const cell = await sharp(texturePath).resize(170, 170).jpeg().toBuffer();
  const overlays: sharp.OverlayOptions[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      overlays.push({ input: cell, left: col * 170, top: row * 170 });
    }
  }
  await sharp({
    create: { width: 510, height: 510, channels: 3, background: "#111" },
  })
    .composite(overlays)
    .jpeg({ quality: 85 })
    .toFile(outPath);
  return outPath;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeContactSheet(entries: ManifestEntry[]): Promise<string> {
  const groups: Array<{ title: string; family: EcommerceFinishFamily; expect: number }> = [
    { title: "Sunbrella (16)", family: "sunbrella", expect: 16 },
    { title: "Ultraleather (4)", family: "ultraleather", expect: 4 },
    { title: "Dekton (6)", family: "dekton", expect: 6 },
    { title: "Frame Powder Coat (6)", family: "powder", expect: 6 },
  ];
  const tileDir = path.join(OUT_ROOT, "tiles");
  fs.mkdirSync(tileDir, { recursive: true });

  let body = "";
  for (const g of groups) {
    const rows = entries.filter((e) => e.family === g.family);
    body += `<section><h2>${escapeHtml(g.title)} — ${rows.length}/${g.expect}</h2>`;
    for (const e of rows) {
      const tilePath = path.join(tileDir, `${e.sku}.jpg`);
      await buildTilePreview(e.texture_path, tilePath);
      const col1 =
        e.source_type === "synthetic_fallback"
          ? `<div class="badge">SYNTHETIC FALLBACK</div>
             <img src="${fileToDataUri(e.overlay_path)}" alt="synthetic"/>
             <div class="meta">no studio photo</div>`
          : `<img src="${fileToDataUri(e.overlay_path)}" alt="original+crop"/>
             <div class="meta">${escapeHtml(e.source_file ?? "")}<br/>px/in: ${e.pixels_per_inch ?? "n/a"}</div>`;
      body += `<div class="row">
        <div class="col">${col1}</div>
        <div class="col">
          <img src="${fileToDataUri(e.texture_path)}" alt="2048"/>
          <div class="meta"><strong>${escapeHtml(e.sku)}</strong><br/>${escapeHtml(e.display_name)}<br/>
          confidence: <span class="c-${e.confidence}">${e.confidence}</span>
          ${e.lookalikes.length ? `<br/>lookalikes: ${escapeHtml(e.lookalikes.join(", "))}` : ""}
          </div>
        </div>
        <div class="col">
          <img src="${fileToDataUri(tilePath)}" alt="3x3"/>
          <div class="meta">repeat_inches: ${e.repeat_inches}<br/>texture_scale: ${e.texture_scale}</div>
        </div>
      </div>`;
    }
    body += `</section>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>High-Rez Finish QA Contact Sheet</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;background:#0f1115;color:#e8e8e8;margin:0;padding:24px}
  h1{font-weight:600;letter-spacing:.02em}
  h2{margin-top:36px;border-bottom:1px solid #333;padding-bottom:8px}
  .row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin:18px 0;padding:14px;background:#1a1d24;border-radius:8px}
  .col img{width:100%;height:auto;border-radius:4px;background:#000}
  .meta{font-size:12px;line-height:1.45;margin-top:8px;color:#c9c9c9}
  .badge{display:inline-block;background:#b45309;color:#fff;padding:6px 10px;border-radius:4px;font-weight:700;margin-bottom:8px}
  .c-high{color:#4ade80}.c-medium{color:#fbbf24}.c-low{color:#f87171}
</style></head>
<body>
<h1>32-Finish High-Rez QA Contact Sheet</h1>
<p>Edit <code>processed/manifest.json</code> source_file ↔ sku pairings before <code>finishes:upload -- --apply</code>.</p>
${body}
</body></html>`;
  const out = path.join(OUT_ROOT, "qa-contact-sheet.html");
  fs.writeFileSync(out, html, "utf8");
  return out;
}

async function runCvOnAllRaw(): Promise<CvProcessResult[]> {
  const photos = await listRawStudioPhotos();
  const rows: CvProcessResult[] = [];
  let i = 0;
  for (const p of photos) {
    i++;
    const tmpId = `tmp_${String(i).padStart(3, "0")}`;
    const families = familyForFolder(p.categoryFolder);
    const familyHint = families[0];
    console.log(`[cv] ${i}/${photos.length} ${p.relative}`);
    try {
      const row = await processStudioPhoto({
        filePath: p.filePath,
        relative: p.relative,
        categoryFolder: p.categoryFolder,
        tmpId,
        familyHint,
      });
      rows.push(row);
    } catch (err) {
      console.warn(`[cv-error] ${p.relative}:`, err);
      rows.push({
        source_file: p.filePath,
        relative: p.relative,
        category_folder: p.categoryFolder,
        sha1: "",
        error: err instanceof Error ? err.message : String(err),
        pixels_per_inch: null,
        ppi_method: "error",
        deskew_deg: 0,
        crop_box: { x: 0, y: 0, side: 0 },
        cropped_width_in: null,
        overlay_path: "",
        tmp_id: tmpId,
        texture_path: "",
        thumb_path: "",
        lab: [],
        stripe: {
          vertical_energy: 0,
          horizontal_energy: 0,
          vertical_period_px: 0,
          horizontal_period_px: 0,
          is_striped: false,
          L_p10: 0,
          L_p90: 0,
          bimodal: false,
        },
      });
    }
  }
  const outJson = path.join(OUT_ROOT, "cv-results.json");
  fs.writeFileSync(outJson, JSON.stringify(rows, null, 2), "utf8");
  return rows;
}

async function matchAndBuild(cvRows: CvProcessResult[]): Promise<ManifestEntry[]> {
  const valid = cvRows.filter((row) => {
    if (row.error) {
      console.warn(`[cv-error] ${row.relative}: ${row.error}`);
      return false;
    }
    return Boolean(row.lab?.length && row.tmp_id);
  });

  const duplicates: string[] = [];
  const uniqueRows: CvProcessResult[] = [];
  const dropped = new Set<CvProcessResult>();

  const byHash = new Map<string, CvProcessResult[]>();
  for (const row of valid) {
    const list = byHash.get(row.sha1 ?? "") ?? [];
    list.push(row);
    byHash.set(row.sha1 ?? "", list);
  }
  for (const [, group] of byHash) {
    if (group.length < 2) continue;
    let keep = group[0]!;
    for (const g of group.slice(1)) keep = preferCanonical(keep, g);
    for (const g of group) {
      if (g === keep) continue;
      dropped.add(g);
      duplicates.push(g.relative ?? "unknown");
    }
  }

  const PERCEPTUAL_LAB_DUP = 15;
  const remaining = valid.filter((r) => !dropped.has(r));
  for (const copy of remaining.filter(isCopyName)) {
    if (dropped.has(copy)) continue;
    let best: { row: CvProcessResult; dist: number } | null = null;
    for (const other of remaining) {
      if (other === copy || dropped.has(other)) continue;
      if ((other.category_folder ?? "") !== (copy.category_folder ?? "")) continue;
      if (!copy.lab?.length || !other.lab?.length) continue;
      const d = labDist(copy.lab, other.lab);
      if (d > PERCEPTUAL_LAB_DUP) continue;
      if (!best || d < best.dist) best = { row: other, dist: d };
    }
    dropped.add(copy);
    duplicates.push(copy.relative ?? "unknown");
    if (best) {
      console.log(
        `[dup] perceptual duplicate (ΔE=${best.dist.toFixed(2)}): ${copy.relative} ≈ ${best.row.relative}`,
      );
    }
  }

  for (const row of valid) {
    if (!dropped.has(row)) uniqueRows.push(row);
  }

  // Bimodal stripe scan — never bind FAB-CAB-CLA to solid grey (e.g. PV205084)
  const bimodalRows = uniqueRows.filter(
    (r) =>
      r.category_folder === "Fabrics" &&
      r.stripe?.bimodal &&
      r.stripe.L_p90 > 75 &&
      r.stripe.L_p10 < 25 &&
      r.stripe.is_striped,
  );
  const bannedCabanaFiles = new Set(
    uniqueRows
      .filter((r) => /PV205084/i.test(r.relative ?? ""))
      .map((r) => r.relative),
  );

  const refLabs = new Map<string, number[]>();
  for (const def of ECOMMERCE_32_FINISHES) {
    const lab = await refLab(def.sku);
    if (lab) refLabs.set(def.sku, lab);
  }

  type Cand = { def: EcommerceFinishDefinition; row: CvProcessResult; dist: number; hasRef: boolean };
  const candidates: Cand[] = [];
  for (const row of uniqueRows) {
    if (!row.lab?.length || row.error) continue;
    const families = familyForFolder(row.category_folder ?? "");
    for (const def of ECOMMERCE_32_FINISHES) {
      if (!families.includes(def.family)) continue;
      // Hard ban: Cabana Classic must never match solid grey PV205084
      if (def.sku === "FAB-CAB-CLA" && bannedCabanaFiles.has(row.relative)) continue;
      if (def.sku === "FAB-CAB-CLA" && !(row.stripe?.bimodal && row.stripe.L_p90 > 75 && row.stripe.L_p10 < 25)) {
        continue;
      }
      const rosterLab = hexToLab(def.hex);
      let dist = labDist(row.lab, rosterLab);
      const ref = refLabs.get(def.sku);
      if (ref) dist = labDist(row.lab, ref) * 0.65 + dist * 0.35;
      if (row.stripe?.is_striped && def.patternRepeatIn) dist *= 0.75;
      if (!row.stripe?.is_striped && !def.patternRepeatIn) dist *= 0.95;
      // Prefer true cabana photo if present
      if (def.sku === "FAB-CAB-CLA" && bimodalRows.includes(row)) dist *= 0.5;
      candidates.push({ def, row, dist, hasRef: Boolean(ref) });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);

  const assignedSku = new Set<string>();
  const assignedRow = new Set<CvProcessResult>();
  const matches = new Map<string, Cand>();

  for (const c of candidates) {
    if (assignedSku.has(c.def.sku) || assignedRow.has(c.row)) continue;
    assignedSku.add(c.def.sku);
    assignedRow.add(c.row);
    matches.set(c.def.sku, c);
  }

  // If PV205084 was not assigned (banned from Cabana), bind it to Crush Ash grey if free
  const greyRow = uniqueRows.find((r) => /PV205084/i.test(r.relative ?? ""));
  if (greyRow && !assignedRow.has(greyRow)) {
    const greySku = GREY_SUNBRELLA_FALLBACK;
    if (!assignedSku.has(greySku)) {
      const def = ECOMMERCE_32_FINISHES.find((d) => d.sku === greySku)!;
      matches.set(greySku, {
        def,
        row: greyRow,
        dist: labDist(greyRow.lab, hexToLab(def.hex)),
        hasRef: Boolean(refLabs.get(greySku)),
      });
      assignedSku.add(greySku);
      assignedRow.add(greyRow);
      console.log(`[match] reassigned ${greyRow.relative} → ${greySku} (true grey Sunbrella)`);
    }
  }

  const entries: ManifestEntry[] = [];
  const missing: EcommerceFinishDefinition[] = [];
  const matchAudit: Array<Record<string, unknown>> = [];

  for (const def of ECOMMERCE_32_FINISHES) {
    const m = matches.get(def.sku);
    if (!m || def.sku === "FAB-CAB-CLA") {
      // Cabana handled specially below unless true bimodal photo matched
      if (def.sku === "FAB-CAB-CLA" && m && m.row.stripe?.bimodal) {
        // fall through to studio path
      } else if (def.sku === "FAB-CAB-CLA") {
        missing.push(def);
        continue;
      } else if (!m) {
        missing.push(def);
        continue;
      }
    }
    if (!m) continue;

    const scale = deriveFinishPhysicalScale({ sku: def.sku, family: def.family });
    const renamed = await renameOutputs(m.row.tmp_id, def.sku);
    let overlay = m.row.overlay_path ?? null;
    if (overlay && fs.existsSync(overlay)) {
      const dest = path.join(OVERLAY_DIR, `${def.sku}.jpg`);
      fs.copyFileSync(overlay, dest);
      overlay = dest;
    }
    const entry: ManifestEntry = {
      sku: def.sku,
      display_name: def.displayName,
      family: def.family,
      category: def.category,
      hex: def.hex,
      source_type: "studio_photo",
      source_file: m.row.relative ?? null,
      confidence: confidenceFromDist(m.dist, m.hasRef),
      lookalikes: lookalikesFor(def),
      pixels_per_inch: m.row.pixels_per_inch ?? null,
      cropped_width_in: scale.sample_width_in,
      ...scale,
      texture_path: renamed.texture,
      thumb_path: renamed.thumb,
      overlay_path: overlay,
      lab: m.row.lab ?? null,
      notes: [
        `match_dist=${m.dist.toFixed(2)}`,
        `ppi_method=${m.row.ppi_method ?? ""}`,
        `uniform_scale=${scale.texture_scale}`,
      ],
    };
    entries.push(entry);
    matchAudit.push({
      sku: def.sku,
      display_name: def.displayName,
      source_file: entry.source_file,
      source_type: entry.source_type,
      texture_scale: entry.texture_scale,
      hex_target: def.hex,
      lab: entry.lab,
      confidence: entry.confidence,
    });
  }

  // Cabana Classic: synthesize if no true B&W stripe photo
  const cabanaDef = ECOMMERCE_32_FINISHES.find((d) => d.sku === "FAB-CAB-CLA")!;
  if (!entries.some((e) => e.sku === "FAB-CAB-CLA")) {
    console.log("[cabana] No bimodal B&W stripe photo — synthesizing woven Cabana Classic 2048²");
    const synth = await synthesizeCabanaClassic("FAB-CAB-CLA");
    const scale = deriveFinishPhysicalScale({ sku: "FAB-CAB-CLA" });
    entries.push({
      sku: "FAB-CAB-CLA",
      display_name: cabanaDef.displayName,
      family: "sunbrella",
      category: "fabric",
      hex: cabanaDef.hex,
      source_type: "synthetic_fallback",
      source_file: null,
      confidence: "high",
      lookalikes: [],
      pixels_per_inch: null,
      cropped_width_in: 7,
      ...scale,
      texture_path: synth.texture_path,
      thumb_path: synth.thumb_path,
      overlay_path: synth.overlay_path,
      lab: synth.lab,
      notes: ["synthetic_cabana_classic", "2x7in_vertical_stripe_repeats", "banned_PV205084_grey"],
    });
    matchAudit.push({
      sku: "FAB-CAB-CLA",
      source_type: "synthetic_fallback",
      reason: "no_bimodal_stripe_photo_in_batch",
      banned_files: [...bannedCabanaFiles],
      texture_scale: 7,
      stripe: synth.stripe,
    });
    // Remove from missing list
    const idx = missing.findIndex((d) => d.sku === "FAB-CAB-CLA");
    if (idx >= 0) missing.splice(idx, 1);
  }

  console.log(`[match] studio matched ${entries.length}/32; synthesizing ${missing.length} fallbacks`);
  console.log(`[dup] duplicates flagged: ${duplicates.length ? duplicates.join(", ") : "none"}`);

  for (const def of missing) {
    if (def.sku === "FAB-CAB-CLA") continue;
    const kind =
      def.family === "ultraleather"
        ? "ultraleather"
        : def.family === "powder"
          ? "powder"
          : def.family === "dekton"
            ? "dekton"
            : "fabric";
    const synth = await synthesizeSolidTexture({ sku: def.sku, hex: def.hex, kind });
    const scale = deriveFinishPhysicalScale({ sku: def.sku, family: def.family });
    entries.push({
      sku: def.sku,
      display_name: def.displayName,
      family: def.family,
      category: def.category,
      hex: def.hex,
      source_type: "synthetic_fallback",
      source_file: null,
      confidence: "medium",
      lookalikes: lookalikesFor(def),
      pixels_per_inch: null,
      cropped_width_in: scale.sample_width_in,
      ...scale,
      texture_path: synth.texture_path,
      thumb_path: synth.thumb_path,
      overlay_path: synth.overlay_path,
      lab: synth.lab,
      notes: [`synthetic:${kind}`, `missing_from_studio_batch`],
    });
    matchAudit.push({
      sku: def.sku,
      source_type: "synthetic_fallback",
      texture_scale: scale.texture_scale,
      hex_target: def.hex,
    });
  }

  const order = new Map(ECOMMERCE_32_FINISHES.map((d, i) => [d.sku, i]));
  entries.sort((a, b) => (order.get(a.sku) ?? 0) - (order.get(b.sku) ?? 0));

  // Enforce uniform scales on every entry
  for (const e of entries) {
    const scale = deriveFinishPhysicalScale({ sku: e.sku, family: e.family });
    Object.assign(e, scale);
    e.cropped_width_in = scale.sample_width_in;
  }

  for (const f of fs.readdirSync(TEXTURE_DIR)) {
    if (f.startsWith("tmp_")) fs.unlinkSync(path.join(TEXTURE_DIR, f));
  }
  for (const f of fs.readdirSync(THUMB_DIR)) {
    if (f.startsWith("tmp_")) fs.unlinkSync(path.join(THUMB_DIR, f));
  }

  fs.writeFileSync(path.join(OUT_ROOT, "match-audit.json"), JSON.stringify(matchAudit, null, 2), "utf8");
  return entries;
}

function printSummary(entries: ManifestEntry[]): void {
  console.log("\n=== 32-Finish Match Summary ===");
  console.log(
    "SKU".padEnd(22) + "Name".padEnd(22) + "Source".padEnd(20) + "Scale".padEnd(8) + "File",
  );
  for (const e of entries) {
    console.log(
      e.sku.padEnd(22) +
        e.display_name.slice(0, 20).padEnd(22) +
        e.source_type.padEnd(20) +
        String(e.texture_scale).padEnd(8) +
        (e.source_file ?? "(synthetic)"),
    );
  }
  const studio = entries.filter((e) => e.source_type === "studio_photo").length;
  const synth = entries.filter((e) => e.source_type === "synthetic_fallback").length;
  console.log(`\nTotals: ${entries.length}/32 | studio=${studio} | synthetic=${synth}`);
}

async function postfixExistingTextures(): Promise<ManifestEntry[]> {
  const { finalizeSeamlessTexture } = await import("./lib/swatch-cv-pipeline");
  const manifestPath = path.join(OUT_ROOT, "manifest.json");
  let prior: ManifestEntry[] | null = null;
  if (fs.existsSync(manifestPath)) {
    prior = (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { entries: ManifestEntry[] }).entries;
  }
  const entries: ManifestEntry[] = [];
  for (const def of ECOMMERCE_32_FINISHES) {
    const texture_path = path.join(TEXTURE_DIR, `${def.sku}.jpg`);
    const thumb_path = path.join(THUMB_DIR, `${def.sku}.jpg`);
    if (!fs.existsSync(texture_path)) {
      throw new Error(`postfix missing texture ${texture_path}`);
    }
    if (def.family !== "dekton" && def.sku !== "FAB-CAB-CLA") {
      const { data } = await sharp(texture_path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const fixed = finalizeSeamlessTexture(Buffer.from(data), 2048);
      await sharp(fixed, { raw: { width: 2048, height: 2048, channels: 3 } })
        .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toFile(texture_path);
      const thumbRgb = await sharp(fixed, { raw: { width: 2048, height: 2048, channels: 3 } })
        .resize(512, 512, { kernel: "lanczos3" })
        .raw()
        .toBuffer();
      await sharp(thumbRgb, { raw: { width: 512, height: 512, channels: 3 } })
        .jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toFile(thumb_path);
      console.log(`[postfix] ${def.sku}`);
    } else {
      console.log(`[postfix] skip finalize ${def.sku}`);
    }
    const scale = deriveFinishPhysicalScale({ sku: def.sku, family: def.family });
    const prev = prior?.find((e) => e.sku === def.sku);
    entries.push({
      sku: def.sku,
      display_name: def.displayName,
      family: def.family,
      category: def.category,
      hex: def.hex,
      source_type: prev?.source_type ?? "studio_photo",
      source_file: prev?.source_file ?? null,
      confidence: prev?.confidence ?? "medium",
      lookalikes: lookalikesFor(def),
      pixels_per_inch: prev?.pixels_per_inch ?? null,
      cropped_width_in: scale.sample_width_in,
      ...scale,
      texture_path,
      thumb_path,
      overlay_path: prev?.overlay_path ?? path.join(OVERLAY_DIR, `${def.sku}.jpg`),
      lab: prev?.lab ?? null,
      notes: [...(prev?.notes ?? []), "postfix_finalize"],
    });
  }
  return entries;
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(STAGING_ROOT, "HighRezImages"))) {
    throw new Error(`Raw staging missing: ${path.join(STAGING_ROOT, "HighRezImages")}`);
  }
  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });

  const postfix = process.env.FINISHES_POSTFIX === "1" || process.argv.includes("--postfix");
  let entries: ManifestEntry[];
  if (postfix) {
    console.log("[finishes:process] postfix finalize on existing SKU textures…");
    entries = await postfixExistingTextures();
  } else {
  const reuseCv = process.env.FINISHES_REUSE_CV === "1";
  const cvJson = path.join(OUT_ROOT, "cv-results.json");
  let cvRows: CvProcessResult[];
  if (reuseCv && fs.existsSync(cvJson)) {
    console.log("[finishes:process] reusing existing cv-results.json");
    cvRows = JSON.parse(fs.readFileSync(cvJson, "utf8")) as CvProcessResult[];
  } else {
    console.log("[finishes:process] running sharp/RGB safe-square pipeline…");
    cvRows = await runCvOnAllRaw();
  }
  console.log(`[finishes:process] CV rows: ${cvRows.length}`);

  entries = await matchAndBuild(cvRows);
  }
  if (entries.length !== 32) {
    throw new Error(`Expected 32 manifest entries, got ${entries.length}`);
  }

  const qa = await verifyAllProcessed(entries);
  if (!qa.ok) {
    console.error("[pixel-qa] FAILED:");
    for (const issue of qa.issues) {
      console.error(`  ${issue.sku} ${issue.code}: ${issue.detail}`);
    }
    throw new Error(`Pixel QA gate failed with ${qa.issues.length} issue(s)`);
  }
  console.log("[pixel-qa] PASS — all 32 textures");

  const manifestPath = path.join(OUT_ROOT, "manifest.json");
  const manifest = {
    generated_at: new Date().toISOString(),
    staging_root: STAGING_ROOT,
    count: entries.length,
    studio_photo: entries.filter((e) => e.source_type === "studio_photo").length,
    synthetic_fallback: entries.filter((e) => e.source_type === "synthetic_fallback").length,
    entries,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const qaPath = await writeContactSheet(entries);
  printSummary(entries);
  console.log(`\nmanifest: ${manifestPath}`);
  console.log(`match-audit: ${path.join(OUT_ROOT, "match-audit.json")}`);
  console.log(`qa-contact-sheet: ${qaPath}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { matchAndBuild, STAGING_ROOT as STAGING, OUT_ROOT };
