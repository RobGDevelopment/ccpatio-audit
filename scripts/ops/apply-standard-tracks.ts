/**
 * Bulk-assign Standard Tracks to Hub producible SKUs (Phase 2).
 *
 * Scans sku_mappings for finished_good + sub_assembly, resolves track via
 * assignStandardTrack, and upserts item_operations (live) behind --confirm.
 *
 * Default: --dry-run (plan CSV only, no DB writes).
 *
 *   npm run ops:apply-standard-tracks
 *   npm run ops:apply-standard-tracks -- --dry-run
 *   npm run ops:apply-standard-tracks -- --confirm
 *   npm run ops:apply-standard-tracks -- --confirm --limit=25
 *   npm run ops:apply-standard-tracks -- --mode=fill_gaps
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { assignStandardTrack } from "../../src/lib/factory-routing/assign-track";
import {
  getStandardTrack,
  type StandardTrackId,
} from "../../src/lib/factory-routing/resources";
import { escapeKatanaCsvField } from "../../src/lib/katana-bom-csv";
import { closeDb, getDb } from "../../src/server/db/client";
import { item_operations, sku_mappings } from "../../src/server/db/schema";

loadEnvConfig(process.cwd());

const explicitDryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm") && !explicitDryRun;
const dryRun = !confirm;

function parseLimit(): number | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return null;
}

function parseMode(): "replace" | "fill_gaps" {
  for (const arg of process.argv.slice(2)) {
    if (arg === "--mode=fill_gaps") return "fill_gaps";
    if (arg === "--mode=replace") return "replace";
  }
  return "replace";
}

const limit = parseLimit();
const mode = parseMode();

type PlanAction =
  | "would_assign"
  | "assigned"
  | "skipped_no_track"
  | "skipped_fill_gaps"
  | "failed";

type PlanRow = {
  action: PlanAction;
  sku: string;
  name: string;
  item_type: string;
  track_id: string;
  reason: string;
  steps: number;
  removed: number;
  inserted: number;
  status: string;
};

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function toCsv(rows: PlanRow[]): string {
  const headers = [
    "action",
    "sku",
    "name",
    "item_type",
    "track_id",
    "reason",
    "steps",
    "removed",
    "inserted",
    "status",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.action,
        r.sku,
        r.name,
        r.item_type,
        r.track_id,
        r.reason,
        r.steps,
        r.removed,
        r.inserted,
        r.status,
      ]
        .map((v) => escapeKatanaCsvField(v))
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

async function assignOne(
  db: ReturnType<typeof getDb>,
  sku: string,
  trackId: StandardTrackId,
  applyMode: "replace" | "fill_gaps",
): Promise<{ removed: number; inserted: number; skipped: number }> {
  const track = getStandardTrack(trackId);
  const now = new Date();
  let removed = 0;

  if (applyMode === "replace") {
    const deleted = await db
      .delete(item_operations)
      .where(eq(item_operations.item_sku, sku))
      .returning({ id: item_operations.id });
    removed = deleted.length;
  }

  const existing = await db
    .select({
      workCenter: item_operations.work_center,
      sequence: item_operations.sequence,
    })
    .from(item_operations)
    .where(eq(item_operations.item_sku, sku));

  const existingKeys = new Set(
    existing.map((row) => `${row.workCenter}::${row.sequence}`),
  );

  let inserted = 0;
  let skipped = 0;
  for (const step of track) {
    const key = `${step.resource}::${step.sequence}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    await db.insert(item_operations).values({
      item_sku: sku,
      work_center: step.resource,
      sequence: step.sequence,
      setup_time_mins:
        step.setupTimeMins > 0 ? step.setupTimeMins.toFixed(4) : "0.0000",
      run_time_mins: step.runTimeMins.toFixed(4),
      updated_at: now,
    });
    existingKeys.add(key);
    inserted += 1;
  }

  return { removed, inserted, skipped };
}

async function main(): Promise<void> {
  console.log("Apply Standard Tracks (Hub item_operations)");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log(`  upsert: ${mode}`);
  console.log(`  limit: ${limit ?? "(none)"}`);
  console.log("");

  const db = getDb();
  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      name: sku_mappings.original_name,
      itemType: sku_mappings.item_type,
    })
    .from(sku_mappings)
    .where(
      and(
        inArray(sku_mappings.item_type, ["finished_good", "sub_assembly"]),
        sql`coalesce(${sku_mappings.is_active}, true) = true`,
      ),
    )
    .orderBy(asc(sku_mappings.global_sku));

  console.log(`→ Producible active SKUs: ${rows.length}`);

  const plan: PlanRow[] = [];
  let workCount = 0;

  for (const row of rows) {
    const resolved = assignStandardTrack({
      sku: row.sku,
      name: row.name,
      itemType: row.itemType,
    });

    if (!resolved.trackId) {
      plan.push({
        action: "skipped_no_track",
        sku: resolved.sku,
        name: row.name ?? "",
        item_type: row.itemType,
        track_id: "",
        reason: resolved.reason,
        steps: 0,
        removed: 0,
        inserted: 0,
        status: dryRun ? "dry_run" : "skipped",
      });
      continue;
    }

    if (limit != null && workCount >= limit) {
      break;
    }
    workCount += 1;

    const track = getStandardTrack(resolved.trackId);
    const base: PlanRow = {
      action: dryRun ? "would_assign" : "assigned",
      sku: resolved.sku,
      name: row.name ?? "",
      item_type: row.itemType,
      track_id: resolved.trackId,
      reason: resolved.reason,
      steps: track.length,
      removed: 0,
      inserted: dryRun ? track.length : 0,
      status: dryRun ? "dry_run" : "ok",
    };

    if (dryRun) {
      plan.push(base);
      continue;
    }

    try {
      const result = await assignOne(db, resolved.sku, resolved.trackId, mode);
      if (mode === "fill_gaps" && result.inserted === 0) {
        plan.push({
          ...base,
          action: "skipped_fill_gaps",
          removed: result.removed,
          inserted: 0,
          status: `skipped_existing:${result.skipped}`,
        });
      } else {
        plan.push({
          ...base,
          action: "assigned",
          removed: result.removed,
          inserted: result.inserted,
          status: `ok_skipped:${result.skipped}`,
        });
        console.log(
          `  assigned ${resolved.sku} → ${resolved.trackId} (+${result.inserted}/-${result.removed})`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      plan.push({
        ...base,
        action: "failed",
        inserted: 0,
        status: message,
      });
      console.error(`  FAILED ${resolved.sku}: ${message}`);
    }
  }

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `apply-standard-tracks-${stamp()}.csv`);
  writeFileSync(reportPath, toCsv(plan), "utf8");

  const assigned = plan.filter(
    (p) => p.action === "assigned" || p.action === "would_assign",
  ).length;
  const skipped = plan.filter((p) => p.action.startsWith("skipped")).length;
  const failed = plan.filter((p) => p.action === "failed").length;

  console.log("");
  console.log("Summary");
  console.log(`  scanned:     ${rows.length}`);
  console.log(`  work rows:   ${workCount}`);
  console.log(`  assignable:  ${assigned}`);
  console.log(`  skipped:     ${skipped}`);
  console.log(`  failed:      ${failed}`);
  console.log(`  report: ${reportPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to write item_operations.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => undefined);
  });
