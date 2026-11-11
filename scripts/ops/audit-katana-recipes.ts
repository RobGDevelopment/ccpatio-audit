/**
 * Forensic audit of live Katana recipes vs the Hub + September baselines,
 * focused on the 2026-10-29 manual CSV bulk edit.
 *
 * READ-ONLY: Katana GETs only, Hub SELECTs only. Writes report CSVs to tmp/.
 *
 *   npx tsx scripts/ops/audit-katana-recipes.ts
 *   npx tsx scripts/ops/audit-katana-recipes.ts --from=2026-10-29T07:00:00Z --to=2026-10-31T07:00:00Z
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KatanaApiError,
  katanaFetch,
  resolveLiveKatanaApiBase,
} from "../../src/lib/katana";
import { closeDb, getDb } from "../../src/server/db/client";
import { product_bom, sku_mappings } from "../../src/server/db/schema";
import { REQUEST_DELAY_MS, delay, readCsvRecords, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

type Row = Record<string, unknown>;

function argValue(name: string): string | null {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Thursday 2026-10-29 00:00 through Friday 2026-10-30 23:59 local (UTC-7). */
const WINDOW_FROM = Date.parse(argValue("from") ?? "2026-10-29T07:00:00Z");
const WINDOW_TO = Date.parse(argValue("to") ?? "2026-10-31T07:00:00Z");
const LOCAL_OFFSET_HOURS = -7;
const QTY_TOLERANCE = 0.01;
const SEPT_BASELINE_FILES = [
  "docs/Katana Downloads/Add-new-recipes.csv",
  "docs/Katana Downloads/Add-Level2-Recipes.csv",
];

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();
const ts = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
const inWindow = (v: unknown) => {
  const t = ts(v);
  return Number.isFinite(t) && t >= WINDOW_FROM && t < WINDOW_TO;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function writeCsv(path: string, headers: string[], rows: unknown[][]): void {
  const lines = [headers.join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  writeFileSync(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

async function paginate(path: string, label: string): Promise<Row[]> {
  const pageSize = 250;
  const all: Row[] = [];
  for (let page = 1; page <= 2000; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=${pageSize}&page=${page}`;
    let rows: Row[] | null = null;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const { data } = await katanaFetch(url, {
          baseUrl: resolveLiveKatanaApiBase(),
        });
        rows = unwrapList<Row>(data);
        break;
      } catch (err) {
        const status = err instanceof KatanaApiError ? err.status : 0;
        if ([429, 502, 503, 504].includes(status) && attempt < 6) {
          await delay(3000 * 2 ** (attempt - 1));
          continue;
        }
        throw err;
      }
    }
    all.push(...(rows ?? []));
    if (page % 20 === 0) console.log(`  ${label}: ${all.length} rows so far`);
    if ((rows ?? []).length < pageSize) {
      console.log(`  ${label}: ${all.length} rows`);
      return all;
    }
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(`${label}: pagination cap hit (${all.length} rows) — refusing a partial list`);
}

type Line = { child: string; qty: number; alt?: number };

function aggregate(lines: Line[]): Map<string, Line> {
  const out = new Map<string, Line>();
  for (const l of lines) {
    const prev = out.get(l.child);
    if (prev) {
      prev.qty += l.qty;
      if (prev.alt != null && l.alt != null) prev.alt += l.alt;
    } else {
      out.set(l.child, { ...l });
    }
  }
  return out;
}

const qtyMatches = (live: number, base: Line) => {
  const close = (a: number, b: number) =>
    Math.abs(a - b) <= QTY_TOLERANCE * Math.max(Math.abs(b), 1e-9);
  return close(live, base.qty) || (base.alt != null && close(live, base.alt));
};

type ParentVerdict =
  | "INTACT"
  | "EXTRA_LINES_ONLY"
  | "QTY_CHANGED"
  | "LINES_MISSING"
  | "RECIPE_EMPTY"
  | "PARENT_RENAMED"
  | "PARENT_DELETED"
  | "PARENT_MISSING";

type Comparison = {
  parent: string;
  verdict: ParentVerdict;
  liveSku: string;
  baselineLines: number;
  liveLines: number;
  missing: string[];
  extra: string[];
  qtyChanged: string[];
  touchedInWindow: boolean;
};

const DAMAGED: ReadonlySet<ParentVerdict> = new Set([
  "QTY_CHANGED",
  "LINES_MISSING",
  "RECIPE_EMPTY",
  "PARENT_RENAMED",
  "PARENT_DELETED",
  "PARENT_MISSING",
]);

function family(sku: string, name: string): string | null {
  if (!sku.startsWith("FIN-")) return null;
  const s = `${sku} ${name}`.toUpperCase();
  if (/CUSH/.test(s)) return "Cushions";
  if (/\bSEC\b|SECTIONAL/.test(s)) return "Sectionals";
  if (/\bDIN\b|DINING/.test(s) && /\bTAB\b|TABLE/.test(s)) return "Dining tables";
  if (/\bTAB\b|TABLE/.test(s)) return "Other tables";
  return null;
}

function localDay(t: number): string {
  return new Date(t + LOCAL_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}
function localHour(t: number): string {
  return new Date(t + LOCAL_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 13).replace("T", " ") + ":00";
}

async function main(): Promise<void> {
  console.log("Katana recipe forensic audit (READ-ONLY)");
  console.log(`  Katana base : ${resolveLiveKatanaApiBase()}`);
  console.log(
    `  Window (UTC): ${new Date(WINDOW_FROM).toISOString()} → ${new Date(WINDOW_TO).toISOString()}`,
  );
  console.log("");

  console.log("→ Fetching Katana catalog");
  const variants = await paginate("/variants?include_deleted=true", "variants (incl. deleted)");
  await delay(REQUEST_DELAY_MS);
  const products = await paginate("/products?include_deleted=true", "products (incl. deleted)");
  await delay(REQUEST_DELAY_MS);
  const materials = await paginate("/materials?include_deleted=true", "materials (incl. deleted)");
  await delay(REQUEST_DELAY_MS);
  const bomRows = await paginate("/bom_rows", "bom_rows");
  console.log("");

  // ---------- Katana indexes ----------
  const variantById = new Map<number, Row>();
  const liveBySku = new Map<string, Row>();
  const deletedSkus = new Map<string, Row>();
  const dupSkus = new Map<string, number>();
  for (const v of variants) {
    const id = Number(v.id);
    variantById.set(id, v);
    const sku = norm(v.sku);
    if (v.deleted_at) {
      if (sku) deletedSkus.set(sku, v);
      continue;
    }
    if (!sku) continue;
    if (liveBySku.has(sku)) dupSkus.set(sku, (dupSkus.get(sku) ?? 1) + 1);
    else liveBySku.set(sku, v);
  }
  const itemById = new Map<string, Row>();
  for (const p of products) itemById.set(`p${p.id}`, p);
  for (const m of materials) itemById.set(`m${m.id}`, m);
  const itemOf = (v: Row | undefined) =>
    v ? itemById.get(v.product_id != null ? `p${v.product_id}` : `m${v.material_id}`) : undefined;
  const nameOf = (v: Row | undefined) => String(itemOf(v)?.name ?? "");
  const isLive = (v: Row | undefined) => {
    if (!v || v.deleted_at) return false;
    const item = itemOf(v);
    return !!item && !item.deleted_at;
  };

  const liveProducts = products.filter((p) => !p.deleted_at && !p.archived_at);
  const archivedProducts = products.filter((p) => !p.deleted_at && p.archived_at);
  const liveMaterials = materials.filter((m) => !m.deleted_at && !m.archived_at);
  const liveVariants = variants.filter((v) => !v.deleted_at);
  const liveProductVariants = liveVariants.filter((v) => v.type === "product");
  const liveMaterialVariants = liveVariants.filter((v) => v.type === "material");

  // Recipe rows per parent variant
  const rowsByParent = new Map<number, Row[]>();
  for (const r of bomRows) {
    const pid = Number(r.product_variant_id);
    const list = rowsByParent.get(pid) ?? [];
    list.push(r);
    rowsByParent.set(pid, list);
  }
  const liveLinesFor = (variantId: number): Line[] =>
    (rowsByParent.get(variantId) ?? []).map((r) => ({
      child: norm(variantById.get(Number(r.ingredient_variant_id))?.sku) ||
        `#${String(r.ingredient_variant_id)}`,
      qty: Number(r.quantity ?? 0),
    }));

  // ---------- Orphans ----------
  type Orphan = { rowId: string; side: string; parentSku: string; ingredientSku: string; reason: string; updatedAt: string };
  const orphans: Orphan[] = [];
  for (const r of bomRows) {
    const parent = variantById.get(Number(r.product_variant_id));
    const ing = variantById.get(Number(r.ingredient_variant_id));
    const base = {
      rowId: String(r.id),
      parentSku: String(parent?.sku ?? `#${r.product_variant_id}`),
      ingredientSku: String(ing?.sku ?? `#${r.ingredient_variant_id}`),
      updatedAt: String(r.updated_at ?? ""),
    };
    if (!isLive(parent)) {
      orphans.push({ ...base, side: "parent", reason: parent ? "parent variant/item deleted" : "parent variant id unknown" });
    }
    if (!isLive(ing)) {
      orphans.push({ ...base, side: "ingredient", reason: ing ? "ingredient variant/item deleted" : "ingredient variant id unknown" });
    }
    if (Number(r.quantity ?? 0) <= 0) {
      orphans.push({ ...base, side: "quantity", reason: "zero/negative quantity" });
    }
  }

  // ---------- Window activity ----------
  const windowVariants = variants.filter(
    (v) => inWindow(v.updated_at) || inWindow(v.created_at) || inWindow(v.deleted_at),
  );
  const windowItems = [...products, ...materials].filter(
    (i) => inWindow(i.updated_at) || inWindow(i.created_at) || inWindow(i.deleted_at) || inWindow(i.archived_at),
  );
  const windowRows = bomRows.filter((r) => inWindow(r.updated_at) || inWindow(r.created_at));
  const windowRowsCreated = windowRows.filter((r) => inWindow(r.created_at));
  const windowDeletedVariants = variants.filter((v) => inWindow(v.deleted_at));
  const windowCreatedVariants = variants.filter((v) => inWindow(v.created_at));

  const touchedParentIds = new Set<number>();
  for (const r of windowRows) touchedParentIds.add(Number(r.product_variant_id));
  for (const v of windowVariants) touchedParentIds.add(Number(v.id));
  for (const v of variants) {
    const item = itemOf(v);
    if (item && (inWindow(item.updated_at) || inWindow(item.deleted_at) || inWindow(item.archived_at))) {
      touchedParentIds.add(Number(v.id));
    }
  }

  // Daily histogram of updates (local) across a 3-week span
  const dayCounts = new Map<string, { variants: number; items: number; rows: number }>();
  const bumpDay = (t: number, key: "variants" | "items" | "rows") => {
    if (!Number.isFinite(t) || t < Date.parse("2026-10-20T07:00:00Z")) return;
    const d = localDay(t);
    const e = dayCounts.get(d) ?? { variants: 0, items: 0, rows: 0 };
    e[key] += 1;
    dayCounts.set(d, e);
  };
  for (const v of variants) bumpDay(ts(v.updated_at), "variants");
  for (const i of [...products, ...materials]) bumpDay(ts(i.updated_at), "items");
  for (const r of bomRows) bumpDay(ts(r.updated_at), "rows");

  const hourCounts = new Map<string, number>();
  for (const x of [...windowVariants, ...windowItems, ...windowRows]) {
    const t = Math.max(ts(x.updated_at) || 0, ts(x.created_at) || 0, ts(x.deleted_at) || 0);
    if (inWindow(new Date(t).toISOString())) hourCounts.set(localHour(t), (hourCounts.get(localHour(t)) ?? 0) + 1);
  }

  // ---------- Hub baseline ----------
  console.log("→ Loading Hub baseline (sku_mappings + product_bom)");
  const db = getDb();
  const hubSkus = await db
    .select({
      sku: sku_mappings.global_sku,
      itemType: sku_mappings.item_type,
      isActive: sku_mappings.is_active,
      katanaVariantId: sku_mappings.katana_variant_id,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings);
  const hubBom = await db
    .select({
      parent: product_bom.parent_sku,
      child: product_bom.child_sku,
      qty: product_bom.quantity,
      scrap: product_bom.scrap_factor,
    })
    .from(product_bom);
  console.log(`  sku_mappings: ${hubSkus.length}, product_bom lines: ${hubBom.length}`);

  const hubBySku = new Map(hubSkus.map((h) => [norm(h.sku), h]));
  const hubPrefixes = new Set(hubSkus.map((h) => norm(h.sku).split("-")[0]));

  // Hub-linked variants whose Katana SKU drifted
  type Drift = { hubSku: string; variantId: number; katanaSku: string; status: string; when: string };
  const drift: Drift[] = [];
  for (const h of hubSkus) {
    if (!h.isActive || h.katanaVariantId == null) continue;
    const v = variantById.get(h.katanaVariantId);
    const hubSku = norm(h.sku);
    if (!v) {
      if (!liveBySku.has(hubSku)) drift.push({ hubSku, variantId: h.katanaVariantId, katanaSku: "", status: "VARIANT_GONE", when: "" });
      continue;
    }
    if (v.deleted_at) {
      if (!liveBySku.has(hubSku)) drift.push({ hubSku, variantId: h.katanaVariantId, katanaSku: String(v.sku ?? ""), status: "VARIANT_DELETED", when: String(v.deleted_at) });
      continue;
    }
    if (norm(v.sku) !== hubSku) {
      drift.push({ hubSku, variantId: h.katanaVariantId, katanaSku: String(v.sku ?? ""), status: "SKU_RENAMED", when: String(v.updated_at ?? "") });
    }
  }
  const hubActiveFg = hubSkus.filter((h) => h.isActive && h.itemType === "finished_good");
  const hubFgMissingInKatana = hubActiveFg.filter((h) => !liveBySku.has(norm(h.sku)));

  const hubLinesByParent = new Map<string, Line[]>();
  for (const b of hubBom) {
    const qty = Number(b.qty);
    const scrap = Number(b.scrap ?? 1);
    const list = hubLinesByParent.get(norm(b.parent)) ?? [];
    list.push({ child: norm(b.child), qty, alt: qty * (Number.isFinite(scrap) && scrap > 0 ? scrap : 1) });
    hubLinesByParent.set(norm(b.parent), list);
  }

  // ---------- September CSV baseline ----------
  const septLinesByParent = new Map<string, Line[]>();
  for (const rel of SEPT_BASELINE_FILES) {
    const path = join(process.cwd(), rel);
    if (!existsSync(path)) {
      console.warn(`  missing September baseline file: ${rel}`);
      continue;
    }
    for (const rec of readCsvRecords(path)) {
      const parent = norm(rec["Product variant code / SKU"]);
      const child = norm(rec["Ingredient variant code / SKU"]);
      const qty = Number(rec["Quantity"]);
      if (!parent || !child || !Number.isFinite(qty)) continue;
      const list = septLinesByParent.get(parent) ?? [];
      list.push({ child, qty });
      septLinesByParent.set(parent, list);
    }
  }
  console.log(`  September CSV parents: ${septLinesByParent.size}`);
  console.log("");

  function compare(parent: string, baseLines: Line[]): Comparison {
    const base = aggregate(baseLines);
    let live = liveBySku.get(parent);
    let verdict: ParentVerdict | null = null;
    let liveSku = parent;
    if (!live) {
      const hub = hubBySku.get(parent);
      const linked = hub?.katanaVariantId != null ? variantById.get(hub.katanaVariantId) : undefined;
      if (linked && !linked.deleted_at) {
        live = linked;
        liveSku = String(linked.sku ?? "");
        verdict = "PARENT_RENAMED";
      } else if (deletedSkus.has(parent) || linked?.deleted_at) {
        verdict = "PARENT_DELETED";
        live = deletedSkus.get(parent) ?? linked;
      } else {
        verdict = "PARENT_MISSING";
      }
    }
    const liveId = live ? Number(live.id) : NaN;
    const liveAgg = aggregate(Number.isFinite(liveId) ? liveLinesFor(liveId) : []);
    const missing = [...base.keys()].filter((c) => !liveAgg.has(c));
    const extra = [...liveAgg.keys()].filter((c) => !base.has(c));
    const qtyChanged = [...base.entries()]
      .filter(([c, b]) => liveAgg.has(c) && !qtyMatches(liveAgg.get(c)!.qty, b))
      .map(([c, b]) => `${c}:${b.qty}->${liveAgg.get(c)!.qty}`);
    if (!verdict) {
      if (liveAgg.size === 0) verdict = "RECIPE_EMPTY";
      else if (missing.length > 0) verdict = "LINES_MISSING";
      else if (qtyChanged.length > 0) verdict = "QTY_CHANGED";
      else if (extra.length > 0) verdict = "EXTRA_LINES_ONLY";
      else verdict = "INTACT";
    }
    return {
      parent,
      verdict,
      liveSku,
      baselineLines: base.size,
      liveLines: liveAgg.size,
      missing,
      extra,
      qtyChanged,
      touchedInWindow: Number.isFinite(liveId) && touchedParentIds.has(liveId),
    };
  }

  const hubCmp = [...hubLinesByParent.entries()].map(([p, l]) => compare(p, l));
  const septCmp = [...septLinesByParent.entries()].map(([p, l]) => compare(p, l));

  // ---------- Core finished goods ----------
  type FamStat = { total: number; withRecipe: number; empty: string[]; touched: number };
  const famStats = new Map<string, FamStat>();
  for (const v of liveProductVariants) {
    if (!isLive(v)) continue;
    const sku = norm(v.sku);
    const fam = family(sku, nameOf(v));
    if (!fam) continue;
    const s = famStats.get(fam) ?? { total: 0, withRecipe: 0, empty: [], touched: 0 };
    s.total += 1;
    if ((rowsByParent.get(Number(v.id)) ?? []).length > 0) s.withRecipe += 1;
    else s.empty.push(sku);
    if (touchedParentIds.has(Number(v.id))) s.touched += 1;
    famStats.set(fam, s);
  }

  // ---------- SKU format ----------
  const SKU_SHAPE = /^[A-Z0-9]+(-[A-Z0-9.]+)*$/;
  type BadSku = { sku: string; type: string; reason: string; updatedAt: string; inWindow: boolean };
  const badSkus: BadSku[] = [];
  for (const v of liveVariants) {
    const raw = String(v.sku ?? "");
    const reasons: string[] = [];
    if (!raw.trim()) reasons.push("blank SKU");
    else {
      if (raw !== raw.trim()) reasons.push("leading/trailing whitespace");
      if (/[a-z]/.test(raw)) reasons.push("lowercase");
      if (!SKU_SHAPE.test(raw.trim().toUpperCase())) reasons.push("illegal characters/shape");
      if (!hubPrefixes.has(norm(raw).split("-")[0])) reasons.push(`prefix ${norm(raw).split("-")[0]} unknown to Hub`);
      if (!hubBySku.has(norm(raw))) reasons.push("not in Hub sku_mappings");
    }
    const structural = reasons.filter((r) => r !== "not in Hub sku_mappings");
    if (structural.length === 0 && !(inWindow(v.updated_at) || inWindow(v.created_at))) continue;
    if (reasons.length === 0) continue;
    badSkus.push({
      sku: raw,
      type: String(v.type ?? ""),
      reason: reasons.join("; "),
      updatedAt: String(v.updated_at ?? ""),
      inWindow: inWindow(v.updated_at) || inWindow(v.created_at),
    });
  }

  // ---------- Write detail CSVs ----------
  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const st = stamp();
  const cmpHeaders = ["baseline", "parent_sku", "verdict", "live_sku", "touched_in_window", "baseline_lines", "live_lines", "missing_children", "extra_children", "qty_changed"];
  const cmpRows = (label: string, list: Comparison[]) =>
    list.map((c) => [label, c.parent, c.verdict, c.liveSku, c.touchedInWindow, c.baselineLines, c.liveLines, c.missing.join(" | "), c.extra.join(" | "), c.qtyChanged.join(" | ")]);
  const cmpPath = join(tmpDir, `katana-recipe-audit-${st}-parents.csv`);
  writeCsv(cmpPath, cmpHeaders, [...cmpRows("hub", hubCmp), ...cmpRows("sept_csv", septCmp)]);
  const orphanPath = join(tmpDir, `katana-recipe-audit-${st}-orphans.csv`);
  writeCsv(orphanPath, ["row_id", "side", "parent_sku", "ingredient_sku", "reason", "updated_at"], orphans.map((o) => [o.rowId, o.side, o.parentSku, o.ingredientSku, o.reason, o.updatedAt]));
  const windowPath = join(tmpDir, `katana-recipe-audit-${st}-window-changes.csv`);
  writeCsv(
    windowPath,
    ["kind", "id", "sku_or_name", "parent_sku", "created_at", "updated_at", "deleted_at"],
    [
      ...windowVariants.map((v) => ["variant", v.id, v.sku, "", v.created_at, v.updated_at, v.deleted_at]),
      ...windowItems.map((i) => [String(i.type ?? "item"), i.id, i.name, "", i.created_at, i.updated_at, i.deleted_at ?? i.archived_at]),
      ...windowRows.map((r) => ["bom_row", r.id, variantById.get(Number(r.ingredient_variant_id))?.sku, variantById.get(Number(r.product_variant_id))?.sku, r.created_at, r.updated_at, ""]),
    ],
  );
  const driftPath = join(tmpDir, `katana-recipe-audit-${st}-sku-drift.csv`);
  writeCsv(
    driftPath,
    ["hub_sku", "katana_variant_id", "katana_sku", "status", "when", "", "bad_sku", "type", "reason", "updated_at", "in_window"],
    [
      ...drift.map((d) => [d.hubSku, d.variantId, d.katanaSku, d.status, d.when]),
      ...badSkus.map((b) => ["", "", "", "", "", "", b.sku, b.type, b.reason, b.updatedAt, b.inWindow]),
    ],
  );

  const damagedHub = hubCmp.filter((c) => DAMAGED.has(c.verdict));
  const damagedHubWindow = damagedHub.filter((c) => c.touchedInWindow);
  const restorePath = join(tmpDir, `katana-recipe-restore-from-hub-${st}.csv`);
  writeCsv(
    restorePath,
    ["Product variant code / SKU", "Ingredient variant code / SKU", "Quantity"],
    damagedHub.flatMap((c) =>
      [...aggregate(hubLinesByParent.get(c.parent) ?? []).values()].map((l) => [c.parent, l.child, l.alt ?? l.qty]),
    ),
  );

  // ---------- Report ----------
  const tally = (list: Comparison[]) => {
    const m = new Map<ParentVerdict, { n: number; touched: number }>();
    for (const c of list) {
      const e = m.get(c.verdict) ?? { n: 0, touched: 0 };
      e.n += 1;
      if (c.touchedInWindow) e.touched += 1;
      m.set(c.verdict, e);
    }
    return m;
  };
  const printTally = (title: string, list: Comparison[]) => {
    console.log(`\n${title}  (${list.length} parents)`);
    const order: ParentVerdict[] = ["INTACT", "EXTRA_LINES_ONLY", "QTY_CHANGED", "LINES_MISSING", "RECIPE_EMPTY", "PARENT_RENAMED", "PARENT_DELETED", "PARENT_MISSING"];
    const t = tally(list);
    for (const v of order) {
      const e = t.get(v);
      if (!e) continue;
      console.log(`  ${v.padEnd(18)} ${String(e.n).padStart(6)}   (touched in window: ${e.touched})`);
    }
  };
  const sample = <T,>(list: T[], fmt: (x: T) => string, n = 15) => {
    for (const x of list.slice(0, n)) console.log(`    ${fmt(x)}`);
    if (list.length > n) console.log(`    … ${list.length - n} more`);
  };

  console.log("================ KATANA INVENTORY ================");
  console.log(`  Products  live ${liveProducts.length}   archived ${archivedProducts.length}   deleted ${products.filter((p) => p.deleted_at).length}`);
  console.log(`  Materials live ${liveMaterials.length}   deleted ${materials.filter((m) => m.deleted_at).length}`);
  console.log(`  Variants  live ${liveVariants.length} (product ${liveProductVariants.length}, material ${liveMaterialVariants.length})   deleted ${variants.length - liveVariants.length}`);
  console.log(`  Duplicate live SKUs: ${dupSkus.size}`);
  sample([...dupSkus.entries()], ([s, n]) => `${s} ×${n}`, 10);

  console.log("\n================ RECIPES / BOMs ==================");
  const parentsWithRows = [...rowsByParent.keys()];
  const liveParentsWithRows = parentsWithRows.filter((id) => isLive(variantById.get(id)));
  console.log(`  Recipe rows total: ${bomRows.length}`);
  console.log(`  Parent variants with ≥1 row: ${parentsWithRows.length} (live parents: ${liveParentsWithRows.length})`);
  const orphanBy = new Map<string, number>();
  for (const o of orphans) orphanBy.set(o.reason, (orphanBy.get(o.reason) ?? 0) + 1);
  console.log(`  Orphan / broken rows: ${orphans.length}`);
  for (const [r, n] of orphanBy) console.log(`    ${r.padEnd(34)} ${n}`);
  sample(orphans, (o) => `${o.parentSku} ← ${o.ingredientSku}  [${o.reason}]`, 10);

  console.log("\n================ CORE FINISHED GOODS =============");
  for (const fam of ["Sectionals", "Dining tables", "Other tables", "Cushions"]) {
    const s = famStats.get(fam);
    if (!s) {
      console.log(`  ${fam.padEnd(14)} (no live FIN-* SKUs matched)`);
      continue;
    }
    console.log(`  ${fam.padEnd(14)} total ${String(s.total).padStart(4)}   with recipe ${String(s.withRecipe).padStart(4)}   EMPTY ${String(s.empty.length).padStart(4)}   touched in window ${s.touched}`);
    sample(s.empty, (x) => `empty: ${x}`, 5);
  }

  console.log("\n================ OCT 29 WINDOW ACTIVITY ==========");
  console.log(`  Variants touched: ${windowVariants.length}  (created ${windowCreatedVariants.length}, deleted ${windowDeletedVariants.length})`);
  console.log(`  Products/materials touched: ${windowItems.length}`);
  console.log(`  Recipe rows touched: ${windowRows.length}  (created ${windowRowsCreated.length})`);
  console.log("  Hourly (local UTC-7) activity inside window:");
  for (const [h, n] of [...hourCounts.entries()].sort()) console.log(`    ${h}  ${n}`);
  console.log("  Daily updated_at counts since 2026-10-20 (local) [variants / items / recipe rows]:");
  for (const [d, e] of [...dayCounts.entries()].sort()) {
    const mark = d === "2026-10-29" || d === "2026-10-30" ? "  ◄" : "";
    console.log(`    ${d}  ${String(e.variants).padStart(6)} / ${String(e.items).padStart(6)} / ${String(e.rows).padStart(6)}${mark}`);
  }

  console.log("\n================ SKU DRIFT vs HUB ================");
  const driftBy = new Map<string, Drift[]>();
  for (const d of drift) driftBy.set(d.status, [...(driftBy.get(d.status) ?? []), d]);
  console.log(`  Hub-linked active SKUs drifted: ${drift.length}`);
  for (const [s, list] of driftBy) {
    console.log(`    ${s.padEnd(16)} ${list.length}   (in window: ${list.filter((d) => inWindow(d.when)).length})`);
    sample(list, (d) => `${d.hubSku} → ${d.katanaSku || "(gone)"}  @ ${d.when}`, 8);
  }
  console.log(`  Active Hub finished goods with no live Katana SKU: ${hubFgMissingInKatana.length} / ${hubActiveFg.length}`);
  sample(hubFgMissingInKatana, (h) => h.sku, 8);
  const structuralBad = badSkus.filter((b) => !/^not in Hub sku_mappings$/.test(b.reason));
  console.log(`  Live SKUs with malformed/unknown format: ${structuralBad.length} (in window: ${structuralBad.filter((b) => b.inWindow).length})`);
  sample(structuralBad, (b) => `${JSON.stringify(b.sku)}  [${b.reason}]${b.inWindow ? "  ◄window" : ""}`, 12);
  const windowNotInHub = badSkus.filter((b) => b.inWindow);
  console.log(`  SKUs created/edited in window that the Hub doesn't know: ${windowNotInHub.length}`);
  sample(windowNotInHub, (b) => `${b.sku}  (${b.type})`, 12);

  console.log("\n================ BASELINE COMPARISON =============");
  printTally("Hub product_bom (source of truth)", hubCmp);
  sample(damagedHub, (c) => `${c.verdict.padEnd(15)} ${c.parent}${c.liveSku !== c.parent ? ` (now ${c.liveSku})` : ""}  missing=${c.missing.length} qtyΔ=${c.qtyChanged.length}${c.touchedInWindow ? "  ◄window" : ""}`, 20);
  printTally("September Katana CSV exports (secondary)", septCmp);

  // ---------- Forensics: who/what/when ----------
  console.log("\n================ FORENSICS =======================");
  const prefix = (sku: unknown) => norm(sku).split("-")[0] || "(blank)";
  const wave = (t: number) => {
    const local = new Date(t + LOCAL_OFFSET_HOURS * 3_600_000);
    const day = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours();
    if (day === "2026-10-29" && hour >= 17) return "Thu 10/29 evening";
    if (day === "2026-10-30" && hour < 17) return "Fri 10/30 daytime";
    return `${day} other`;
  };
  const waveTally = new Map<string, Map<string, number>>();
  const bumpWave = (w: string, key: string) => {
    const m = waveTally.get(w) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + 1);
    waveTally.set(w, m);
  };
  for (const v of variants) {
    if (inWindow(v.deleted_at)) bumpWave(wave(ts(v.deleted_at)), `variant DELETED ${v.type} ${prefix(v.sku)}`);
    else if (inWindow(v.created_at)) bumpWave(wave(ts(v.created_at)), `variant CREATED ${v.type} ${prefix(v.sku)}`);
    else if (inWindow(v.updated_at)) bumpWave(wave(ts(v.updated_at)), `variant UPDATED ${v.type} ${prefix(v.sku)}`);
  }
  for (const i of [...products, ...materials]) {
    const cat = String(i.category_name ?? "(none)");
    if (inWindow(i.deleted_at)) bumpWave(wave(ts(i.deleted_at)), `item DELETED ${i.type} cat=${cat}`);
    else if (inWindow(i.created_at)) bumpWave(wave(ts(i.created_at)), `item CREATED ${i.type} cat=${cat}`);
    else if (inWindow(i.updated_at)) bumpWave(wave(ts(i.updated_at)), `item UPDATED ${i.type} cat=${cat}`);
  }
  for (const [w, m] of [...waveTally.entries()].sort()) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    console.log(`  ${w}: ${total} events`);
    for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
      console.log(`    ${String(n).padStart(5)}  ${k}`);
    }
  }

  const normName = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const liveItemByName = new Map<string, Row>();
  for (const i of [...products, ...materials]) {
    if (!i.deleted_at && !i.archived_at) liveItemByName.set(normName(i.name), i);
  }
  const deletedInWindow = variants.filter((v) => inWindow(v.deleted_at));
  const withSuccessor = deletedInWindow.filter((v) => {
    const item = itemOf(v);
    return item && liveItemByName.has(normName(item.name));
  });
  const deletedHubParents = deletedInWindow.filter((v) => hubLinesByParent.has(norm(v.sku)));
  const deletedSeptParents = deletedInWindow.filter((v) => septLinesByParent.has(norm(v.sku)));
  console.log(`\n  Variants deleted in window: ${deletedInWindow.length}`);
  console.log(`    …that were Hub BOM parents: ${deletedHubParents.length}; Sept-CSV parents: ${deletedSeptParents.length}`);
  console.log(`    …with a live item of the same name today (recreated/renamed): ${withSuccessor.length}`);
  sample(withSuccessor, (v) => {
    const succ = liveItemByName.get(normName(itemOf(v)?.name))!;
    const succSku = liveVariants.find((lv) => itemOf(lv) === succ)?.sku ?? "?";
    return `${v.sku} → ${succSku}  "${String(succ.name)}"`;
  }, 10);
  const delByPrefix = new Map<string, number>();
  for (const v of deletedInWindow) delByPrefix.set(`${v.type} ${prefix(v.sku)}`, (delByPrefix.get(`${v.type} ${prefix(v.sku)}`) ?? 0) + 1);
  console.log("    Deleted-in-window by type/prefix:");
  for (const [k, n] of [...delByPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`      ${String(n).padStart(5)}  ${k}`);

  const rowsByCreatedDay = new Map<string, number>();
  for (const r of bomRows) {
    const d = localDay(ts(r.created_at));
    rowsByCreatedDay.set(d, (rowsByCreatedDay.get(d) ?? 0) + 1);
  }
  console.log("\n  Live recipe rows by created_at day (local):");
  for (const [d, n] of [...rowsByCreatedDay.entries()].sort()) console.log(`    ${d}  ${n}`);

  const liveParentPrefix = new Map<string, number>();
  for (const id of liveParentsWithRows) {
    const k = prefix(variantById.get(id)?.sku);
    liveParentPrefix.set(k, (liveParentPrefix.get(k) ?? 0) + 1);
  }
  console.log("  Live recipe parents by SKU prefix:");
  for (const [k, n] of [...liveParentPrefix.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(8)} ${n}`);

  const missingChild = new Map<string, number>();
  for (const c of hubCmp.filter((x) => x.verdict === "LINES_MISSING")) {
    for (const m of c.missing) missingChild.set(m, (missingChild.get(m) ?? 0) + 1);
  }
  const childStatus = (sku: string) =>
    liveBySku.has(sku) ? "live" : deletedSkus.has(sku) ? `deleted ${String(deletedSkus.get(sku)!.deleted_at).slice(0, 10)}` : "never in Katana";
  console.log("\n  LINES_MISSING (Hub): most frequently missing components");
  for (const [k, n] of [...missingChild.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${String(n).padStart(4)}  ${k.padEnd(34)} ${childStatus(k)}`);
  }
  const missingStatusTally = new Map<string, number>();
  for (const [k, n] of missingChild) {
    const del = deletedSkus.get(k);
    const s = liveBySku.has(k)
      ? "live (line removed)"
      : del
        ? inWindow(del.deleted_at) ? "deleted in window" : "deleted outside window"
        : "never in Katana";
    missingStatusTally.set(s, (missingStatusTally.get(s) ?? 0) + n);
  }
  console.log("  Missing component lines by component status:");
  for (const [k, n] of missingStatusTally) console.log(`    ${k.padEnd(28)} ${n}`);

  console.log("\n================ RECOMMENDATION ==================");
  const damagedSept = septCmp.filter((c) => DAMAGED.has(c.verdict));
  const windowRecipeActivity = windowRows.length + windowDeletedVariants.length;
  const rebuilt = hubCmp.filter((c) => c.verdict === "LINES_MISSING" && c.extra.length > 0);
  const lostNotRebuilt = hubCmp.filter(
    (c) => c.verdict === "RECIPE_EMPTY" || (c.verdict === "LINES_MISSING" && c.extra.length === 0),
  );
  const deletedParents = hubCmp.filter((c) => c.verdict === "PARENT_DELETED");
  const restoreLines = damagedHub.flatMap((c) => [...aggregate(hubLinesByParent.get(c.parent) ?? []).values()]);
  const restoreDead = restoreLines.filter((l) => !liveBySku.has(l.child)).length;
  const postWindowRows = bomRows.filter((r) => ts(r.created_at) >= WINDOW_TO).length;

  console.log(`  Hub-baseline parents not matching live Katana: ${damagedHub.length} / ${hubCmp.length}  (Sept CSV: ${damagedSept.length} / ${septCmp.length})`);
  console.log(`    Rebuilt on new taxonomy after the window (old lines replaced): ${rebuilt.length}`);
  console.log(`    Live parent, recipe lost and NOT rebuilt:                     ${lostNotRebuilt.length}`);
  console.log(`    Parent variant deleted (FIN/SA/ASM):                          ${deletedParents.length}  (in window: ${deletedParents.filter((c) => c.touchedInWindow).length})`);
  console.log(`  Recipe rows created after the window (rebuild): ${postWindowRows} of ${bomRows.length}`);
  console.log(`  Restore CSV lines: ${restoreLines.length}; referencing SKUs no longer live in Katana: ${restoreDead}`);
  if (windowRecipeActivity === 0 && damagedHubWindow.length === 0) {
    console.log("  → NO ROLLBACK NEEDED for recipes: the window shows no recipe-row writes or variant deletions.");
  } else if (postWindowRows > bomRows.length / 2 || restoreDead > restoreLines.length / 2) {
    console.log("  → DO NOT BULK-ROLLBACK. Katana was rebuilt on a new SKU taxonomy after the window and the");
    console.log("    Hub restore CSV mostly points at deleted SKUs — importing it would fail or clobber the rebuild.");
    console.log(`    Do targeted repair instead: rebuild the ${lostNotRebuilt.length} live-but-empty recipes on the new taxonomy,`);
    console.log(`    confirm whether the ${deletedParents.length} deleted parents were an intentional prune, then re-sync the Hub from Katana.`);
  } else if (damagedHubWindow.length <= 25) {
    console.log("  → TARGETED REPAIR: re-publish only the affected parents from the Hub (no bulk rollback).");
  } else {
    console.log("  → ROLLBACK REQUIRED: use the generated restore CSV (Hub baseline) after review.");
  }

  console.log("\nDetail files:");
  for (const p of [cmpPath, orphanPath, windowPath, driftPath, restorePath]) console.log(`  ${p}`);

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
