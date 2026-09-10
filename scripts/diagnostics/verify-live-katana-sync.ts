/**
 * Approve sketchup_geometry drafts → live product_bom, push nested recipes to
 * Katana (or E2E mirror), then compare chop-saw notes hub vs API payload.
 *
 * Usage:
 *   npx tsx scripts/diagnostics/verify-live-katana-sync.ts
 *
 * Requires POSTGRES_URL + Katana env (KATANA_E2E_MIRROR=true uses local mirror).
 * For mirror GET /captures the Next server must be reachable at KATANA_API_BASE.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { and, eq, inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/server/db/client";
import {
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  sku_mappings,
} from "../../src/server/db/schema";
import { syncBOMToKatana, katanaFetch } from "../../src/lib/katana";

const TARGETS = [
  "FIN-BRV-CLB-CHA-34X34",
  "FIN-WFT-DIN-TAB-72X28",
] as const;

const OPERATOR = "cutlist-verify@ccpatio.com";

async function collectDraftParents(rootSku: string): Promise<string[]> {
  const db = getDb();
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({
        child: product_bom_draft.child_sku,
        type: sku_mappings.item_type,
      })
      .from(product_bom_draft)
      .leftJoin(sku_mappings, eq(product_bom_draft.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom_draft.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }
  return [...found];
}

/** Same copy path as approveDraftRecipe — no session (diagnostic). */
async function approveDraftToLive(rootSku: string): Promise<{
  ok: boolean;
  lines: number;
  error?: string;
}> {
  const sku = rootSku.trim().toUpperCase();
  const db = getDb();
  const parents = await collectDraftParents(sku);
  const lines = await db
    .select()
    .from(product_bom_draft)
    .where(inArray(product_bom_draft.parent_sku, parents));

  if (lines.length === 0) {
    return { ok: false, lines: 0, error: `No draft lines for ${sku}` };
  }

  const now = new Date();
  for (const line of lines) {
    let cutList: unknown[] = [];
    let notesText: string | null = line.notes;
    if (line.notes) {
      const jsonMatch = line.notes.match(/\n(\{[\s\S]*"cut_list"[\s\S]*\})\s*$/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]!) as { cut_list?: unknown[] };
          if (Array.isArray(parsed.cut_list)) cutList = parsed.cut_list;
        } catch {
          /* keep notes */
        }
        notesText = line.notes
          .replace(/\n\{[\s\S]*"cut_list"[\s\S]*\}\s*$/, "")
          .trim();
      }
    }

    await db
      .insert(product_bom)
      .values({
        parent_sku: line.parent_sku,
        child_sku: line.child_sku,
        quantity: line.quantity,
        scrap_factor: line.scrap_factor,
        unit_of_measure: line.unit_of_measure,
        notes: notesText,
        cut_list: cutList as typeof product_bom.$inferInsert.cut_list,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [product_bom.parent_sku, product_bom.child_sku],
        set: {
          quantity: sql`excluded.quantity`,
          scrap_factor: sql`excluded.scrap_factor`,
          unit_of_measure: sql`excluded.unit_of_measure`,
          notes: sql`excluded.notes`,
          cut_list: sql`excluded.cut_list`,
          updated_at: sql`now()`,
        },
      });
  }

  const ops = await db
    .select()
    .from(item_operations_draft)
    .where(inArray(item_operations_draft.item_sku, parents));
  for (const op of ops) {
    const [exists] = await db
      .select({ id: item_operations.id })
      .from(item_operations)
      .where(
        and(
          eq(item_operations.item_sku, op.item_sku),
          eq(item_operations.work_center, op.work_center),
          eq(item_operations.sequence, op.sequence),
        ),
      )
      .limit(1);
    if (exists) continue;
    await db.insert(item_operations).values({
      item_sku: op.item_sku,
      work_center: op.work_center,
      sequence: op.sequence,
      setup_time_mins: op.setup_time_mins,
      run_time_mins: op.run_time_mins,
      updated_at: now,
    });
  }

  await db
    .update(product_bom_draft)
    .set({
      status: "factory_approved",
      reviewed_by: OPERATOR,
      reviewed_at: now,
      updated_at: now,
    })
    .where(inArray(product_bom_draft.parent_sku, parents));

  return { ok: true, lines: lines.length };
}

async function loadLiveNotes(rootSku: string): Promise<
  Array<{ parent: string; child: string; notes: string; qty: string; uom: string }>
> {
  const parents = await collectDraftParents(rootSku);
  // After approve, walk live graph
  const db = getDb();
  const found = new Set<string>([rootSku]);
  const queue = [rootSku];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const kids = await db
      .select({
        child: product_bom.child_sku,
        type: sku_mappings.item_type,
      })
      .from(product_bom)
      .leftJoin(sku_mappings, eq(product_bom.child_sku, sku_mappings.global_sku))
      .where(eq(product_bom.parent_sku, current));
    for (const kid of kids) {
      if (kid.type === "sub_assembly" && !found.has(kid.child)) {
        found.add(kid.child);
        queue.push(kid.child);
      }
    }
  }

  const rows = await db
    .select({
      parent: product_bom.parent_sku,
      child: product_bom.child_sku,
      notes: product_bom.notes,
      qty: product_bom.quantity,
      uom: product_bom.unit_of_measure,
    })
    .from(product_bom)
    .where(inArray(product_bom.parent_sku, [...found]));

  void parents;
  return rows.map((r) => ({
    parent: r.parent,
    child: r.child,
    notes: (r.notes ?? "").trim(),
    qty: String(r.qty),
    uom: r.uom,
  }));
}

type CapturedRecipeRow = {
  product_sku?: string;
  ingredient_sku?: string;
  quantity?: number;
  notes?: string;
  product_variant_id?: number;
  ingredient_variant_id?: number;
};

async function fetchCapturedRecipes(): Promise<
  Array<{ path: string; at: string; rows: CapturedRecipeRow[] }>
> {
  const base = (process.env.KATANA_API_BASE || "").replace(/\/$/, "");
  if (!base) return [];

  // Prefer captures endpoint on the mirror
  try {
    const res = await fetch(`${base.replace(/\/v1$/, "")}/captures`);
    if (res.ok) {
      const json = (await res.json()) as {
        captures?: Array<{ method: string; path: string; body: unknown; at: string }>;
      };
      return (json.captures ?? [])
        .filter((c) => c.method === "POST" && String(c.path).includes("recipes"))
        .map((c) => {
          const body = c.body as { rows?: CapturedRecipeRow[] } | null;
          return {
            path: c.path,
            at: c.at,
            rows: Array.isArray(body?.rows) ? body!.rows! : [],
          };
        });
    }
  } catch {
    /* fall through */
  }

  try {
    const { data } = await katanaFetch<{ data?: unknown[] }>("/recipes");
    const list = Array.isArray(data.data) ? data.data : [];
    return [
      {
        path: "/recipes",
        at: new Date().toISOString(),
        rows: list as CapturedRecipeRow[],
      },
    ];
  } catch {
    return [];
  }
}

async function clearMirrorCaptures(): Promise<void> {
  const base = (process.env.KATANA_API_BASE || "").replace(/\/v1$/, "");
  if (!base) return;
  try {
    await fetch(base.replace(/\/$/, "") + "/captures", { method: "DELETE" });
  } catch {
    /* mirror may be down until next start */
  }
}

function printReport(
  sku: string,
  hubLines: Array<{ parent: string; child: string; notes: string; qty: string; uom: string }>,
  capturedRows: CapturedRecipeRow[],
): { matched: number; missing: number } {
  console.log(`\n╔══════════════════════════════════════════════════════════════`);
  console.log(`║ ${sku}`);
  console.log(`╚══════════════════════════════════════════════════════════════`);

  let matched = 0;
  let missing = 0;

  const metalNotes = hubLines.filter(
    (l) => l.child.startsWith("RM-MET-") && l.notes.length > 0,
  );

  console.log(`\n  Hub product_bom chop-saw notes (${metalNotes.length} metal lines):`);
  for (const line of metalNotes) {
    console.log(`    ${line.parent} → ${line.child}`);
    console.log(`      qty=${line.qty} ${line.uom}`);
    console.log(`      notes: ${line.notes.slice(0, 120)}${line.notes.length > 120 ? "…" : ""}`);
  }

  console.log(`\n  Katana recipe payload notes:`);
  if (capturedRows.length === 0) {
    console.log("    (no captured recipe rows — is the Next mirror server up?)");
  }

  for (const line of metalNotes) {
    const hit = capturedRows.find(
      (r) =>
        String(r.product_sku ?? "").toUpperCase() === line.parent &&
        String(r.ingredient_sku ?? "").toUpperCase() === line.child,
    );
    if (hit) {
      const notesMatch =
        (hit.notes ?? "").includes(line.notes.slice(0, 40)) ||
        line.notes.includes((hit.notes ?? "").slice(0, 40));
      const status = notesMatch ? "PASS" : "MISMATCH";
      if (notesMatch) matched += 1;
      else missing += 1;
      console.log(
        `    [${status}] ${line.parent} → ${line.child}: katana.notes="${String(hit.notes ?? "").slice(0, 100)}"`,
      );
    } else {
      missing += 1;
      console.log(`    [MISS] ${line.parent} → ${line.child} not in Katana payload`);
    }
  }

  // FG nesting proof
  const saChildren = hubLines.filter(
    (l) => l.parent === sku && l.child.startsWith("SA-"),
  );
  console.log(`\n  Nested FG → SA edges (${saChildren.length}):`);
  for (const line of saChildren) {
    const hit = capturedRows.find(
      (r) =>
        String(r.product_sku ?? "").toUpperCase() === sku &&
        String(r.ingredient_sku ?? "").toUpperCase() === line.child,
    );
    console.log(
      `    ${hit ? "PASS" : "MISS"} ${sku} → ${line.child} qty=${line.qty}`,
    );
  }

  return { matched, missing };
}

async function main(): Promise<void> {
  console.log("=== verify-live-katana-sync ===");
  console.log(
    `ORDER_PIPELINE_MODE=${process.env.ORDER_PIPELINE_MODE} KATANA_E2E_MIRROR=${process.env.KATANA_E2E_MIRROR}`,
  );
  console.log(`KATANA_API_BASE=${process.env.KATANA_API_BASE ?? "(default)"}`);

  await clearMirrorCaptures();

  let totalMatched = 0;
  let totalMissing = 0;
  const allCaptured: CapturedRecipeRow[] = [];

  for (const sku of TARGETS) {
    console.log(`\n── Approve ${sku} ──`);
    const approved = await approveDraftToLive(sku);
    if (!approved.ok) {
      console.error(`  FAIL: ${approved.error}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  copied ${approved.lines} draft lines → product_bom`);

    console.log(`── Sync ${sku} → Katana ──`);
    const sync = await syncBOMToKatana(sku);
    if (!sync.ok) {
      console.error(`  FAIL: ${sync.error}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  ${sync.message ?? "ok"}`);
  }

  const captures = await fetchCapturedRecipes();
  for (const cap of captures) {
    allCaptured.push(...cap.rows);
  }
  console.log(`\nCaptured recipe POSTs: ${captures.length} (${allCaptured.length} rows)`);

  for (const sku of TARGETS) {
    const hub = await loadLiveNotes(sku);
    const relevant = allCaptured.filter((r) => {
      const parent = String(r.product_sku ?? "").toUpperCase();
      return (
        parent === sku ||
        parent.startsWith(`SA-${sku.replace(/^FIN-/, "")}`) ||
        parent === "SA-BRV-ARM" ||
        parent.includes("WFT-DIN-TAB-72X28") ||
        parent.includes("BRV-CLB-CHA-34X34")
      );
    });
    const { matched, missing } = printReport(sku, hub, relevant.length ? relevant : allCaptured);
    totalMatched += matched;
    totalMissing += missing;
  }

  console.log("\n════════════════════════════════════════");
  console.log(`SUMMARY  notes matched=${totalMatched}  missing/mismatch=${totalMissing}`);
  if (totalMissing > 0 || totalMatched === 0) {
    process.exitCode = 1;
    console.log("RESULT: FAIL");
  } else {
    console.log("RESULT: PASS — chop-saw notes survived Approve → Katana recipe payload");
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
