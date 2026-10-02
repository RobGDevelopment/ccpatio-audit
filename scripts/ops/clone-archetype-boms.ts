/**
 * Archetype Cloning — populate empty active FIN-* BOMs from Golden Templates.
 *
 * Architect-approved (2026-09-14): Seating / Table / Daybed only (no Golden Steel).
 * Nested clone: FG → minted ASM-*-FRAME (+ ASM-*-CUSH) → RMs from golden.
 * Always mirrors product_bom_draft so Factory Approve cannot wipe clones.
 *
 * Dry-run default. Writes require --confirm.
 *   --limit=N   process at most N empty FGs (after classify, skip excluded)
 *   --dry-run   explicit dry-run (default when --confirm absent)
 *
 *   npm run ops:clone-archetype-boms -- --limit=25
 *   npm run ops:clone-archetype-boms -- --limit=25 --confirm
 *   npm run ops:clone-archetype-boms:confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { subAssemblySku } from "../../src/lib/heuristic-bom";
import { STANDARD_TRACKS } from "../../src/lib/factory-routing/resources";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

/** Architect-validated Golden Archetypes */
const GOLDEN_SEATING = "FIN-OCN-SOF-72X38";
const GOLDEN_TABLE = "FIN-BRV-COF-TAB-36X36";
const GOLDEN_DAYBED = "FIN-OCN-DOU-CHS-58X79";

const confirm = process.argv.includes("--confirm");
const explicitDryRun = process.argv.includes("--dry-run");
const dryRun = !confirm || explicitDryRun;

function parseLimit(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

const limit = parseLimit();

export type ArchetypeFamily = "seating" | "table" | "daybed" | "skip";

type BomLine = {
  parent_sku: string;
  child_sku: string;
  quantity: string;
  scrap_factor: string;
  unit_of_measure: string;
  notes: string | null;
};

type OpRow = {
  item_sku: string;
  work_center: string;
  sequence: number;
  setup_time_mins: string | null;
  run_time_mins: string | null;
};

type GoldenBundle = {
  fg: string;
  family: Exclude<ArchetypeFamily, "skip">;
  frameSku: string;
  cushSku: string | null;
  topLines: BomLine[];
  frameLines: BomLine[];
  cushLines: BomLine[];
  frameOps: OpRow[];
};

type EmptyFg = {
  sku: string;
  name: string;
  category: string;
  family: ArchetypeFamily;
};

type PlanRow = {
  targetFg: string;
  family: ArchetypeFamily;
  golden: string;
  frameSku: string;
  cushSku: string;
  topEdges: number;
  frameEdges: number;
  cushEdges: number;
  frameOps: number;
  action: string;
};

function provenance(golden: string): string {
  return `archetype clone from ${golden}`;
}

/**
 * Categorize empty FIN-* for archetype selection.
 * Daybed before seating so CHS/DYB are not swallowed by CHA.
 */
export function classifyArchetype(sku: string, name: string): ArchetypeFamily {
  const s = `${sku} ${name}`.toUpperCase();

  if (
    /\b(UMB|UMBRELLA|COVER|SHADE|LAMP|RISER|WEIGHT|UNFABRICATED|WEATHERPROOF)\b/.test(
      s,
    )
  ) {
    return "skip";
  }

  if (
    /\b(DYB|DAYBED|DOU-CHS|SGL-CHS|COR-CHS|OVS-CHS|CHS|CHAISE|CABANA|CADA)\b/.test(
      s,
    )
  ) {
    return "daybed";
  }

  if (
    /COF-TAB|SID-TAB|DIN-TAB|BAR-TAB|CNT-TAB|FIR-TAB|RND-TAB/.test(s) ||
    /(?:^|-)TAB(?:-|$)/.test(sku.toUpperCase()) ||
    /\b(TABLE|FIRE\s*PIT)\b/.test(s)
  ) {
    return "table";
  }

  if (
    /\b(SOF|LOV|ARM-SOF|COR-SOF|MIN-LOV|SWV-CHA|CLB-CHA|DIN-CHA|CHA|OTT|BST|BCH|SWV|CLB|SECTIONAL|SOFA|LOVESEAT|CHAIR|OTTOMAN|BARSTOOL|BENCH)\b/.test(
      s,
    )
  ) {
    return "seating";
  }

  return "skip";
}

function goldenForFamily(
  family: Exclude<ArchetypeFamily, "skip">,
): string {
  if (family === "seating") return GOLDEN_SEATING;
  if (family === "table") return GOLDEN_TABLE;
  return GOLDEN_DAYBED;
}

async function loadBomChildren(parentSku: string): Promise<BomLine[]> {
  const db = getDb();
  return db
    .select({
      parent_sku: product_bom.parent_sku,
      child_sku: product_bom.child_sku,
      quantity: product_bom.quantity,
      scrap_factor: product_bom.scrap_factor,
      unit_of_measure: product_bom.unit_of_measure,
      notes: product_bom.notes,
    })
    .from(product_bom)
    .where(eq(product_bom.parent_sku, parentSku));
}

async function loadOps(itemSku: string): Promise<OpRow[]> {
  const db = getDb();
  return db
    .select({
      item_sku: item_operations.item_sku,
      work_center: item_operations.work_center,
      sequence: item_operations.sequence,
      setup_time_mins: item_operations.setup_time_mins,
      run_time_mins: item_operations.run_time_mins,
    })
    .from(item_operations)
    .where(eq(item_operations.item_sku, itemSku));
}

function leanFrameOpsFallback(frameSku: string): OpRow[] {
  return STANDARD_TRACKS.aluminum_frame.map((step) => ({
    item_sku: frameSku,
    work_center: step.resource,
    sequence: step.sequence,
    setup_time_mins: step.setupTimeMins.toFixed(4),
    run_time_mins: step.runTimeMins.toFixed(4),
  }));
}

async function loadGolden(
  family: Exclude<ArchetypeFamily, "skip">,
): Promise<GoldenBundle> {
  const fg = goldenForFamily(family);
  const topLines = await loadBomChildren(fg);
  if (topLines.length === 0) {
    throw new Error(`Golden ${fg} has no product_bom rows`);
  }

  const frameEdge = topLines.find((l) =>
    l.child_sku.toUpperCase().endsWith("-FRAME"),
  );
  if (!frameEdge) {
    throw new Error(`Golden ${fg} missing *-FRAME child`);
  }
  const cushEdge =
    topLines.find((l) => l.child_sku.toUpperCase().endsWith("-CUSH")) ?? null;

  const frameLines = await loadBomChildren(frameEdge.child_sku);
  const cushLines = cushEdge
    ? await loadBomChildren(cushEdge.child_sku)
    : [];

  const hasPwd = frameLines.some((l) => l.child_sku === "PWD-BLACK");
  const hasPrm = frameLines.some(
    (l) => l.child_sku === "PWD-GRAY-ZINC-EPOXY-PRIMER",
  );
  const hasMet = frameLines.some(
    (l) =>
      l.child_sku.toUpperCase().includes("TUBING") &&
      (l.child_sku.startsWith("RM-MET-") || l.child_sku.startsWith("MET-")),
  );

  if (!hasMet || !hasPwd || !hasPrm) {
    throw new Error(
      `Golden ${fg} FRAME incomplete (met=${hasMet} pwd=${hasPwd} prm=${hasPrm})`,
    );
  }

  if (family === "seating" || family === "daybed") {
    if (!cushEdge) {
      throw new Error(`Golden ${fg} (${family}) missing *-CUSH child`);
    }
    const hasFab = cushLines.some((l) => l.child_sku === "RM-FAB-GENERIC");
    if (!hasFab) {
      throw new Error(`Golden ${fg} CUSH missing RM-FAB-GENERIC`);
    }
  }

  let frameOps = await loadOps(frameEdge.child_sku);
  if (frameOps.length === 0) {
    frameOps = leanFrameOpsFallback(frameEdge.child_sku);
  }

  return {
    fg,
    family,
    frameSku: frameEdge.child_sku,
    cushSku: cushEdge?.child_sku ?? null,
    topLines,
    frameLines,
    cushLines,
    frameOps,
  };
}

async function ensureSubAssembly(
  saSku: string,
  targetFg: string,
  role: "FRAME" | "CUSH",
): Promise<void> {
  if (dryRun) return;
  const db = getDb();
  const [existing] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, saSku))
    .limit(1);
  if (existing) return;

  const [fg] = await db
    .select({
      category: sku_mappings.category,
      name: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, targetFg))
    .limit(1);

  await db.insert(sku_mappings).values({
    global_sku: saSku,
    category: fg?.category || "Sub Assembly",
    item_type: "sub_assembly",
    original_name: `${fg?.name || targetFg} ${role}`,
    source_file: "archetype_clone",
    is_active: true,
    uom_purchase: "ea",
    uom_consume: "ea",
  });
}

async function upsertLiveBom(opts: {
  parent: string;
  child: string;
  quantity: string;
  scrap: string;
  uom: string;
  notes: string;
}): Promise<void> {
  if (dryRun) return;
  const db = getDb();
  await db
    .insert(product_bom)
    .values({
      parent_sku: opts.parent,
      child_sku: opts.child,
      quantity: opts.quantity,
      scrap_factor: opts.scrap,
      unit_of_measure: opts.uom,
      notes: opts.notes,
      cut_list: [],
      updated_at: new Date(),
    })
    .onConflictDoNothing({
      target: [product_bom.parent_sku, product_bom.child_sku],
    });
}

async function upsertDraftBom(opts: {
  parent: string;
  child: string;
  quantity: string;
  scrap: string;
  uom: string;
  notes: string;
}): Promise<void> {
  if (dryRun) return;
  const db = getDb();
  await db
    .insert(product_bom_draft)
    .values({
      parent_sku: opts.parent,
      child_sku: opts.child,
      quantity: opts.quantity,
      scrap_factor: opts.scrap,
      unit_of_measure: opts.uom,
      notes: opts.notes,
      cut_list: [],
      status: "edited",
      source: "manager",
      updated_at: new Date(),
    })
    .onConflictDoNothing({
      target: [product_bom_draft.parent_sku, product_bom_draft.child_sku],
    });
}

async function upsertBomBoth(opts: {
  parent: string;
  child: string;
  quantity: string;
  scrap: string;
  uom: string;
  notes: string;
}): Promise<void> {
  await upsertLiveBom(opts);
  await upsertDraftBom(opts);
}

async function upsertFrameOps(
  targetFrame: string,
  ops: OpRow[],
  goldenFg: string,
): Promise<void> {
  if (dryRun) return;
  const db = getDb();
  const note = provenance(goldenFg);
  for (const op of ops) {
    await db
      .insert(item_operations)
      .values({
        item_sku: targetFrame,
        work_center: op.work_center,
        sequence: op.sequence,
        setup_time_mins: op.setup_time_mins,
        run_time_mins: op.run_time_mins,
        updated_at: new Date(),
      })
      .onConflictDoNothing({
        target: [
          item_operations.item_sku,
          item_operations.work_center,
          item_operations.sequence,
        ],
      });

    const [existingDraft] = await db
      .select({ id: item_operations_draft.id })
      .from(item_operations_draft)
      .where(
        and(
          eq(item_operations_draft.item_sku, targetFrame),
          eq(item_operations_draft.work_center, op.work_center),
          eq(item_operations_draft.sequence, op.sequence),
        ),
      )
      .limit(1);
    if (!existingDraft) {
      await db.insert(item_operations_draft).values({
        item_sku: targetFrame,
        work_center: op.work_center,
        sequence: op.sequence,
        setup_time_mins: op.setup_time_mins,
        run_time_mins: op.run_time_mins,
        status: "edited",
        source: "manager",
        notes: note,
        updated_at: new Date(),
      });
    }
  }
}

async function cloneOne(
  target: EmptyFg,
  golden: GoldenBundle,
): Promise<PlanRow> {
  const note = provenance(golden.fg);
  const frameSku = subAssemblySku(target.sku, "FRAME");
  const needCush = golden.cushSku != null;
  const cushSku = needCush ? subAssemblySku(target.sku, "CUSH") : "";

  // Mint ASM hub rows first (product_bom child FK → sku_mappings)
  await ensureSubAssembly(frameSku, target.sku, "FRAME");
  if (cushSku) await ensureSubAssembly(cushSku, target.sku, "CUSH");

  // Top-level: map golden FRAME/CUSH children → minted SAs; copy other FG RMs as-is
  let topEdges = 0;
  for (const line of golden.topLines) {
    const childUpper = line.child_sku.toUpperCase();
    let child = line.child_sku;
    if (childUpper.endsWith("-FRAME")) child = frameSku;
    else if (childUpper.endsWith("-CUSH") && cushSku) child = cushSku;
    else if (childUpper.startsWith("SA-") || childUpper.startsWith("ASM-")) {
      // Unexpected weldment sibling — skip to avoid orphan SAs on target FG
      continue;
    }
    topEdges += 1;
    await upsertBomBoth({
      parent: target.sku,
      child,
      quantity: line.quantity,
      scrap: line.scrap_factor,
      uom: line.unit_of_measure,
      notes: note,
    });
  }

  for (const line of golden.frameLines) {
    await upsertBomBoth({
      parent: frameSku,
      child: line.child_sku,
      quantity: line.quantity,
      scrap: line.scrap_factor,
      uom: line.unit_of_measure,
      notes: note,
    });
  }

  if (cushSku) {
    for (const line of golden.cushLines) {
      await upsertBomBoth({
        parent: cushSku,
        child: line.child_sku,
        quantity: line.quantity,
        scrap: line.scrap_factor,
        uom: line.unit_of_measure,
        notes: note,
      });
    }
  }

  await upsertFrameOps(frameSku, golden.frameOps, golden.fg);

  return {
    targetFg: target.sku,
    family: target.family,
    golden: golden.fg,
    frameSku,
    cushSku: cushSku || "",
    topEdges,
    frameEdges: golden.frameLines.length,
    cushEdges: cushSku ? golden.cushLines.length : 0,
    frameOps: golden.frameOps.length,
    action: dryRun ? "would_clone" : "cloned",
  };
}

function writeCsv(rows: PlanRow[]): string {
  const dir = join(process.cwd(), "tmp");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "archetype-clone-plan.csv");
  const header =
    "target_fg,family,golden,frame_sku,cush_sku,top_edges,frame_edges,cush_edges,frame_ops,action";
  const lines = [header];
  for (const r of rows) {
    lines.push(
      [
        r.targetFg,
        r.family,
        r.golden,
        r.frameSku,
        r.cushSku,
        r.topEdges,
        r.frameEdges,
        r.cushEdges,
        r.frameOps,
        r.action,
      ].join(","),
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

async function main(): Promise<void> {
  if (confirm && explicitDryRun) {
    console.error("Refuse both --confirm and --dry-run");
    process.exit(1);
  }

  console.log("Archetype BOM cloning");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log(`  GOLDEN_SEATING = ${GOLDEN_SEATING}`);
  console.log(`  GOLDEN_TABLE   = ${GOLDEN_TABLE}`);
  console.log(`  GOLDEN_DAYBED  = ${GOLDEN_DAYBED}`);
  console.log("");

  console.log("→ Validating golden archetypes…");
  const seating = await loadGolden("seating");
  const table = await loadGolden("table");
  const daybed = await loadGolden("daybed");
  console.log(
    `  seating OK  frame=${seating.frameSku} cush=${seating.cushSku} frameLines=${seating.frameLines.length} ops=${seating.frameOps.length}`,
  );
  console.log(
    `  table OK    frame=${table.frameSku} cush=${table.cushSku ?? "(none)"} frameLines=${table.frameLines.length} ops=${table.frameOps.length}`,
  );
  console.log(
    `  daybed OK   frame=${daybed.frameSku} cush=${daybed.cushSku} frameLines=${daybed.frameLines.length} ops=${daybed.frameOps.length}`,
  );

  const byFamily: Record<Exclude<ArchetypeFamily, "skip">, GoldenBundle> = {
    seating,
    table,
    daybed,
  };

  const db = getDb();
  const emptyRaw = await db.execute(sql`
    SELECT
      sm.global_sku AS sku,
      sm.original_name AS name,
      sm.category AS category
    FROM sku_mappings sm
    WHERE sm.item_type = 'finished_good'
      AND sm.is_active = true
      AND sm.global_sku LIKE 'FIN-%'
      AND NOT EXISTS (
        SELECT 1 FROM product_bom pb WHERE pb.parent_sku = sm.global_sku
      )
    ORDER BY sm.global_sku
  `);
  const emptyRows = (
    Array.isArray(emptyRaw) ? emptyRaw : ((emptyRaw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ sku: string; name: string; category: string }>;

  const classified: EmptyFg[] = emptyRows.map((r) => ({
    sku: r.sku,
    name: r.name ?? "",
    category: r.category ?? "",
    family: classifyArchetype(r.sku, r.name ?? ""),
  }));

  const counts = { seating: 0, table: 0, daybed: 0, skip: 0 };
  for (const c of classified) counts[c.family] += 1;

  console.log("\n→ Empty FIN-* inventory");
  console.log(`  total empty: ${classified.length}`);
  console.log(`  seating: ${counts.seating}  ← ${GOLDEN_SEATING}`);
  console.log(`  table:   ${counts.table}  ← ${GOLDEN_TABLE}`);
  console.log(`  daybed:  ${counts.daybed}  ← ${GOLDEN_DAYBED}`);
  console.log(`  skip:    ${counts.skip}`);

  let work = classified.filter((c) => c.family !== "skip");
  if (limit != null) work = work.slice(0, limit);

  console.log(
    `\n→ Processing ${work.length} target(s)${limit != null ? ` (limit=${limit})` : ""}`,
  );

  const plans: PlanRow[] = [];
  for (const target of work) {
    const golden = byFamily[target.family as Exclude<ArchetypeFamily, "skip">];
    const plan = await cloneOne(target, golden);
    plans.push(plan);
    console.log(
      `  ${plan.action} ${target.sku} [${target.family}] ← ${golden.fg} → ${plan.frameSku}` +
        (plan.cushSku ? ` + ${plan.cushSku}` : ""),
    );
  }

  const csvPath = writeCsv(plans);
  console.log(`\nCSV: ${csvPath}`);

  if (dryRun) {
    console.log("\nDry-run only. Re-run with --confirm to write.");
  } else {
    const left = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM sku_mappings sm
      WHERE sm.item_type = 'finished_good'
        AND sm.is_active = true
        AND sm.global_sku LIKE 'FIN-%'
        AND NOT EXISTS (
          SELECT 1 FROM product_bom pb WHERE pb.parent_sku = sm.global_sku
        )
    `);
    const leftRows = Array.isArray(left)
      ? left
      : ((left as { rows?: unknown[] }).rows ?? []);
    console.log(
      `\n✅ Clone complete. Remaining empty active FIN-*: ${(leftRows[0] as { n?: number })?.n ?? "?"}`,
    );
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
