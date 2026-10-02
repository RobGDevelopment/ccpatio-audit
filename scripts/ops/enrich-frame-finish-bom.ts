/**
 * BOM enrichment (Architect-approved 2026-09-14):
 *   1. Remap RM-PWD-GENERIC → PWD-BLACK (live + draft)
 *   2. Inject PWD-BLACK + PWD-GRAY-ZINC-EPOXY-PRIMER on SA-*-FRAME
 *      missing finish, qty from tubing LF × Hub powderPounds()
 *   3. Mirror every write into product_bom_draft (Approve must not wipe)
 *
 * Does NOT touch RM-FAB-GENERIC or RM-DKT-GENERIC-SLAB.
 *
 * Dry-run default. Live: --confirm
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/enrich-frame-finish-bom.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/enrich-frame-finish-bom.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import { and, eq, like, sql } from "drizzle-orm";
import { powderPounds } from "../../src/lib/heuristic-bom";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm");

const POWDER_SKU = "PWD-BLACK";
const PRIMER_SKU = "PWD-GRAY-ZINC-EPOXY-PRIMER";
const LEGACY_POWDER = "RM-PWD-GENERIC";

/** Cost 2025 primer $/sqft ÷ powder $/sqft */
const PRIMER_TO_POWDER_AREA = 0.23 / 0.21;

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function primerPounds(powderLb: number): number {
  return round4(Math.max(0.1, powderLb * PRIMER_TO_POWDER_AREA));
}

function isTubingSku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  if (!s.includes("TUBING")) return false;
  return s.startsWith("RM-MET-") || s.startsWith("MET-");
}

function isPrimerChild(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return (
    s.startsWith("RM-PRM-") ||
    s.startsWith("PRM-") ||
    s.includes("PRIMER") ||
    s === PRIMER_SKU
  );
}

function isPowderChild(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  if (isPrimerChild(s)) return false;
  return s.startsWith("RM-PWD-") || s.startsWith("PWD-") || s === LEGACY_POWDER;
}

type BomLine = {
  parent_sku: string;
  child_sku: string;
  quantity: string;
  scrap_factor: string;
  unit_of_measure: string;
};

type FramePlan = {
  frameSku: string;
  tubingLf: number;
  powderLb: number;
  primerLb: number;
  hasPowder: boolean;
  hasPrimer: boolean;
  injectPowder: boolean;
  injectPrimer: boolean;
};

async function assertHubSku(sku: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ sku: sku_mappings.global_sku })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, sku))
    .limit(1);
  if (!row) {
    throw new Error(
      `Hub missing required material SKU ${sku} — refuse enrichment`,
    );
  }
}

function collectFramePlans(lines: BomLine[]): FramePlan[] {
  const byParent = new Map<string, BomLine[]>();
  for (const line of lines) {
    if (!line.parent_sku.toUpperCase().endsWith("-FRAME")) continue;
    if (!line.parent_sku.toUpperCase().startsWith("SA-")) continue;
    const list = byParent.get(line.parent_sku) ?? [];
    list.push(line);
    byParent.set(line.parent_sku, list);
  }

  const plans: FramePlan[] = [];
  for (const [frameSku, children] of byParent) {
    let tubingLf = 0;
    let hasPowder = false;
    let hasPrimer = false;
    for (const c of children) {
      if (isPowderChild(c.child_sku)) hasPowder = true;
      if (isPrimerChild(c.child_sku)) hasPrimer = true;
      if (!isTubingSku(c.child_sku)) continue;
      const qty = Number(c.quantity);
      const scrap = Number(c.scrap_factor);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const s = Number.isFinite(scrap) && scrap > 0 ? scrap : 1;
      tubingLf += qty * s;
    }
    tubingLf = round4(tubingLf);
    if (tubingLf <= 0) continue;

    const powderLb = powderPounds(tubingLf);
    const primerLb = primerPounds(powderLb);
    plans.push({
      frameSku,
      tubingLf,
      powderLb,
      primerLb,
      hasPowder,
      hasPrimer,
      injectPowder: !hasPowder,
      injectPrimer: !hasPrimer,
    });
  }
  return plans.sort((a, b) => a.frameSku.localeCompare(b.frameSku));
}

async function remapGenericPowder(live: boolean): Promise<number> {
  const db = getDb();
  const table = live ? product_bom : product_bom_draft;
  const label = live ? "product_bom" : "product_bom_draft";

  const existing = await db
    .select({
      parent: table.parent_sku,
      child: table.child_sku,
    })
    .from(table)
    .where(eq(table.child_sku, LEGACY_POWDER));

  if (existing.length === 0) {
    console.log(`  [${label}] remap ${LEGACY_POWDER} → ${POWDER_SKU}: 0 rows`);
    return 0;
  }

  if (!confirm) {
    console.log(
      `  [${label}] would remap ${existing.length} row(s) ${LEGACY_POWDER} → ${POWDER_SKU}`,
    );
    for (const r of existing.slice(0, 8)) {
      console.log(`    ${r.parent}`);
    }
    if (existing.length > 8) console.log(`    … +${existing.length - 8} more`);
    return existing.length;
  }

  // Avoid unique (parent, child) collisions if PWD-BLACK already exists
  let remapped = 0;
  let merged = 0;
  for (const row of existing) {
    const [conflict] = await db
      .select({ id: table.id, quantity: table.quantity })
      .from(table)
      .where(
        and(
          eq(table.parent_sku, row.parent),
          eq(table.child_sku, POWDER_SKU),
        ),
      )
      .limit(1);

    if (conflict) {
      await db
        .delete(table)
        .where(
          and(
            eq(table.parent_sku, row.parent),
            eq(table.child_sku, LEGACY_POWDER),
          ),
        );
      merged += 1;
    } else {
      await db
        .update(table)
        .set({
          child_sku: POWDER_SKU,
          unit_of_measure: "lb",
          notes: `remapped from ${LEGACY_POWDER}`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(table.parent_sku, row.parent),
            eq(table.child_sku, LEGACY_POWDER),
          ),
        );
      remapped += 1;
    }
  }
  console.log(
    `  [${label}] remapped ${remapped}, merged-deleted ${merged} (${LEGACY_POWDER} → ${POWDER_SKU})`,
  );
  return remapped + merged;
}

async function upsertFinishLine(opts: {
  live: boolean;
  parentSku: string;
  childSku: string;
  quantity: number;
  note: string;
  source?: "heuristic" | "manager";
}): Promise<"inserted" | "updated" | "dry"> {
  const db = getDb();
  const qty = opts.quantity.toFixed(4);
  const now = new Date();

  if (!confirm) return "dry";

  if (opts.live) {
    await db
      .insert(product_bom)
      .values({
        parent_sku: opts.parentSku,
        child_sku: opts.childSku,
        quantity: qty,
        scrap_factor: "1.0000",
        unit_of_measure: "lb",
        notes: opts.note,
        cut_list: [],
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          scrap_factor: sql`excluded.scrap_factor`,
          unit_of_measure: sql`excluded.unit_of_measure`,
          notes: sql`excluded.notes`,
          updated_at: sql`now()`,
        },
      });
    return "updated";
  }

  await db
    .insert(product_bom_draft)
    .values({
      parent_sku: opts.parentSku,
      child_sku: opts.childSku,
      quantity: qty,
      scrap_factor: "1.0000",
      unit_of_measure: "lb",
      notes: opts.note,
      cut_list: [],
      status: "edited",
      source: opts.source ?? "manager",
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [product_bom_draft.parent_sku, product_bom_draft.child_sku],
      set: {
        quantity: sql`excluded.quantity`,
        scrap_factor: sql`excluded.scrap_factor`,
        unit_of_measure: sql`excluded.unit_of_measure`,
        notes: sql`excluded.notes`,
        status: "edited",
        updated_at: sql`now()`,
      },
    });
  return "updated";
}

async function injectFrames(
  label: string,
  live: boolean,
  lines: BomLine[],
): Promise<{ powder: number; primer: number; frames: number }> {
  const plans = collectFramePlans(lines);
  let powder = 0;
  let primer = 0;
  let framesTouched = 0;

  for (const p of plans) {
    if (!p.injectPowder && !p.injectPrimer) continue;
    framesTouched += 1;
    if (!confirm) {
      console.log(
        `  [${label}] ${p.frameSku}: LF=${p.tubingLf} → pwd=${p.powderLb} lb` +
          `${p.injectPowder ? " [+powder]" : ""}` +
          ` prm=${p.primerLb} lb` +
          `${p.injectPrimer ? " [+primer]" : ""}`,
      );
    }
    if (p.injectPowder) {
      await upsertFinishLine({
        live,
        parentSku: p.frameSku,
        childSku: POWDER_SKU,
        quantity: p.powderLb,
        note: `Enrichment: powderPounds(${p.tubingLf} LF tubing) → ${POWDER_SKU}`,
      });
      powder += 1;
    }
    if (p.injectPrimer) {
      await upsertFinishLine({
        live,
        parentSku: p.frameSku,
        childSku: PRIMER_SKU,
        quantity: p.primerLb,
        note: `Enrichment: primer ≈ powder×(0.23/0.21) from ${p.tubingLf} LF tubing`,
      });
      primer += 1;
    }
  }

  console.log(
    `  [${label}] frames needing inject: ${framesTouched} | powder lines: ${powder} | primer lines: ${primer}`,
  );
  return { powder, primer, frames: framesTouched };
}

async function verify(): Promise<void> {
  const db = getDb();

  const legacyLive = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(product_bom)
    .where(eq(product_bom.child_sku, LEGACY_POWDER));
  const legacyDraft = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(product_bom_draft)
    .where(eq(product_bom_draft.child_sku, LEGACY_POWDER));

  const gap = await db.execute(sql`
    WITH frames AS (
      SELECT DISTINCT parent_sku
      FROM product_bom
      WHERE parent_sku LIKE 'SA-%-FRAME'
    ),
    frame_stats AS (
      SELECT
        f.parent_sku,
        bool_or(pb.child_sku = ${POWDER_SKU} OR pb.child_sku LIKE 'RM-PWD-%' OR (pb.child_sku LIKE 'PWD-%' AND pb.child_sku NOT ILIKE '%PRIMER%')) AS has_pwd,
        bool_or(pb.child_sku = ${PRIMER_SKU} OR pb.child_sku ILIKE '%PRIMER%') AS has_prm,
        bool_or(pb.child_sku LIKE 'RM-MET-%TUBING%' OR pb.child_sku LIKE 'MET-%TUBING%') AS has_met
      FROM frames f
      LEFT JOIN product_bom pb ON pb.parent_sku = f.parent_sku
      GROUP BY f.parent_sku
    )
    SELECT
      count(*)::int AS frames,
      count(*) FILTER (WHERE has_met AND has_pwd AND has_prm)::int AS complete,
      count(*) FILTER (WHERE has_met AND NOT has_pwd)::int AS missing_pwd,
      count(*) FILTER (WHERE has_met AND NOT has_prm)::int AS missing_prm
    FROM frame_stats
  `);
  const gapRows = Array.isArray(gap)
    ? gap
    : ((gap as { rows?: unknown[] }).rows ?? []);

  const pwdCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(product_bom)
    .where(eq(product_bom.child_sku, POWDER_SKU));
  const prmCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(product_bom)
    .where(eq(product_bom.child_sku, PRIMER_SKU));

  console.log("\n=== VERIFY ===");
  console.log(`  live ${LEGACY_POWDER} remaining: ${legacyLive[0]?.n ?? 0}`);
  console.log(`  draft ${LEGACY_POWDER} remaining: ${legacyDraft[0]?.n ?? 0}`);
  console.log(`  live ${POWDER_SKU} rows: ${pwdCount[0]?.n ?? 0}`);
  console.log(`  live ${PRIMER_SKU} rows: ${prmCount[0]?.n ?? 0}`);
  console.log("  frame finish gap:", JSON.stringify(gapRows[0] ?? {}));
}

async function main(): Promise<void> {
  console.log("Frame finish BOM enrichment");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  powder: ${POWDER_SKU}`);
  console.log(`  primer: ${PRIMER_SKU}`);
  console.log(`  remap:  ${LEGACY_POWDER} → ${POWDER_SKU}`);
  console.log("");

  await assertHubSku(POWDER_SKU);
  await assertHubSku(PRIMER_SKU);

  const db = getDb();

  console.log("→ Remap generic powder");
  await remapGenericPowder(true);
  await remapGenericPowder(false);

  console.log("\n→ Inject finish on SA-*-FRAME");
  const liveAfter = await db
    .select({
      parent_sku: product_bom.parent_sku,
      child_sku: product_bom.child_sku,
      quantity: product_bom.quantity,
      scrap_factor: product_bom.scrap_factor,
      unit_of_measure: product_bom.unit_of_measure,
    })
    .from(product_bom)
    .where(like(product_bom.parent_sku, "SA-%-FRAME"));

  const draftAfter = await db
    .select({
      parent_sku: product_bom_draft.parent_sku,
      child_sku: product_bom_draft.child_sku,
      quantity: product_bom_draft.quantity,
      scrap_factor: product_bom_draft.scrap_factor,
      unit_of_measure: product_bom_draft.unit_of_measure,
    })
    .from(product_bom_draft)
    .where(like(product_bom_draft.parent_sku, "SA-%-FRAME"));

  // After remap, re-read so hasPowder reflects PWD-BLACK
  const liveForPlan = confirm
    ? await db
        .select({
          parent_sku: product_bom.parent_sku,
          child_sku: product_bom.child_sku,
          quantity: product_bom.quantity,
          scrap_factor: product_bom.scrap_factor,
          unit_of_measure: product_bom.unit_of_measure,
        })
        .from(product_bom)
        .where(like(product_bom.parent_sku, "SA-%-FRAME"))
    : liveAfter;

  const draftForPlan = confirm
    ? await db
        .select({
          parent_sku: product_bom_draft.parent_sku,
          child_sku: product_bom_draft.child_sku,
          quantity: product_bom_draft.quantity,
          scrap_factor: product_bom_draft.scrap_factor,
          unit_of_measure: product_bom_draft.unit_of_measure,
        })
        .from(product_bom_draft)
        .where(like(product_bom_draft.parent_sku, "SA-%-FRAME"))
    : draftAfter;

  await injectFrames("product_bom", true, liveForPlan);
  await injectFrames("product_bom_draft", false, draftForPlan);

  // Critical: every live finish inject must land on draft too, even when the
  // draft frame tree lacks tubing / already existed without finish lines.
  if (confirm) {
    const livePlans = collectFramePlans(liveForPlan);
    let mirrored = 0;
    for (const p of livePlans) {
      if (!p.injectPowder && !p.injectPrimer) continue;
      if (p.injectPowder) {
        await upsertFinishLine({
          live: false,
          parentSku: p.frameSku,
          childSku: POWDER_SKU,
          quantity: p.powderLb,
          note: `Enrichment mirror: powderPounds(${p.tubingLf} LF) → ${POWDER_SKU}`,
        });
      }
      if (p.injectPrimer) {
        await upsertFinishLine({
          live: false,
          parentSku: p.frameSku,
          childSku: PRIMER_SKU,
          quantity: p.primerLb,
          note: `Enrichment mirror: primer from ${p.tubingLf} LF tubing`,
        });
      }
      mirrored += 1;
    }
    console.log(
      `  draft mirror upserts for ${mirrored} live frame plan(s) (Approve-safe)`,
    );
  }

  await verify();

  if (!confirm) {
    console.log("\nDry-run only. Re-run with --confirm to write.");
  } else {
    console.log("\n✅ Enrichment writes complete.");
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
