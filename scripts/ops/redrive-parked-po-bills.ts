/**
 * Phase 15 — Read-only operator CLI for parked `katana_po_bills` rows (§VII S-4, D-14).
 *
 * Usage:
 *   npm run ops:po-bills -- list [--po <katanaPoId>] [--reason <park_reason>] [--json]
 *   npm run ops:po-bills -- list --vendor-gaps [--json]
 *   npm run ops:po-bills -- status --id <billRowId> [--json]
 *   npm run ops:po-bills -- retry (--id <id> | --po <poId> | --reason <reason>) --operator <email> [--approve-price-drift] [--limit N] [--execute]
 *   npm run ops:po-bills -- resolve --id <id> --kind <entered_by_hand|vendor_credit_issued|katana_correction> --operator <email> --note "<text>" [--qbo-ref <id>] [--allow-amount-difference] [--execute]
 *
 * Invariants:
 *  - Strictly read-only against Postgres (`SELECT` only). All state transitions run inside Inngest.
 *  - Zero external HTTP calls to Katana or QuickBooks Online.
 *  - Never outputs secrets, supplier comments, or customer PII.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { scrubSecretText } from "@/inngest/dlq";
import { closeDb, getDb, type MiddlewareDb } from "@/server/db/client";
import {
  KATANA_PO_BILL_PARK_REASONS,
  KATANA_PO_BILL_RESOLUTION_KINDS,
  katana_po_bills,
  type KatanaPoBillParkReason,
  type KatanaPoBillResolutionKind,
} from "@/server/db/schema";
import {
  KATANA_PO_BILL_REDRIVE_EVENT,
  KATANA_PO_BILL_RESOLVE_EVENT,
  evaluateResolveEligibility,
  evaluateRetryEligibility,
  formatPoBillDocNumber,
} from "@/server/katana/po-receipt-ledger";

type ReadOnlyPoBillsDb = Pick<MiddlewareDb, "select">;

export type OutboundPoBillDomainEvent = {
  id: string;
  name: typeof KATANA_PO_BILL_REDRIVE_EVENT | typeof KATANA_PO_BILL_RESOLVE_EVENT;
  data: Record<string, unknown>;
};

export type PoBillsCliDeps = {
  getDb?: () => ReadOnlyPoBillsDb;
  sendEvent?: (event: OutboundPoBillDomainEvent) => Promise<unknown>;
  nowMs?: () => number;
  writeLine?: (line: string) => void;
};

export type PoBillsCliResult = {
  exitCode: number;
  output: string[];
  sentEvents: OutboundPoBillDomainEvent[];
};

const VALID_PARK_REASONS: ReadonlySet<string> = new Set(KATANA_PO_BILL_PARK_REASONS);
const VALID_RESOLUTION_KINDS: ReadonlySet<string> = new Set(KATANA_PO_BILL_RESOLUTION_KINDS);

function formatCentsUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rem}`;
}

function formatAgeMinutes(createdAt: Date | string, nowMs: number): string {
  const ts = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(ts)) return "unknown";
  const mins = Math.max(0, Math.floor((nowMs - ts) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h${remMins}m`;
}

function allowedActionsLabel(reason: KatanaPoBillParkReason | null): string {
  if (!reason) return "none";
  if (reason === "negative_receipt") {
    return "resolve (vendor_credit_issued | katana_correction)";
  }
  if (reason === "currency_unsupported") {
    return "resolve (entered_by_hand)";
  }
  if (reason === "price_drift") {
    return "retry (--approve-price-drift), resolve (entered_by_hand)";
  }
  if (reason === "po_frozen") {
    return "retry (after negative_receipt resolved), resolve (entered_by_hand)";
  }
  return "retry, resolve (entered_by_hand)";
}

type ParsedArgs = {
  command: string;
  flags: Map<string, string | boolean>;
};

function parseCliArgs(argv: readonly string[]): ParsedArgs {
  const tokens = [...argv];
  let command = "list";
  if (tokens.length > 0 && !tokens[0]!.startsWith("-")) {
    command = tokens.shift()!.trim().toLowerCase();
  }

  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (!token.startsWith("--")) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 2) {
      const key = token.slice(2, eqIdx).trim();
      const val = token.slice(eqIdx + 1);
      flags.set(key, val);
      continue;
    }
    const key = token.slice(2).trim();
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { command, flags };
}

function stringFlag(flags: Map<string, string | boolean>, key: string): string | null {
  const val = flags.get(key);
  if (typeof val === "string" && val.trim().length > 0) {
    return val.trim();
  }
  return null;
}

function boolFlag(flags: Map<string, string | boolean>, key: string): boolean {
  const val = flags.get(key);
  if (val === true) return true;
  if (typeof val === "string") {
    const norm = val.trim().toLowerCase();
    return norm === "true" || norm === "1" || norm === "yes";
  }
  return false;
}

export async function runPoBillsCli(
  argv: readonly string[],
  deps: PoBillsCliDeps = {},
): Promise<PoBillsCliResult> {
  const output: string[] = [];
  const sentEvents: OutboundPoBillDomainEvent[] = [];
  const emit = (line: string) => {
    output.push(line);
    if (deps.writeLine) deps.writeLine(line);
  };

  const resolveDb = deps.getDb ?? getDb;
  const sendEvent =
    deps.sendEvent ??
    (async (evt: OutboundPoBillDomainEvent) => {
      await inngest.send(evt);
    });
  const nowMs = deps.nowMs ?? (() => Date.now());

  const { command, flags } = parseCliArgs(argv);
  const asJson = boolFlag(flags, "json");

  if (command === "list") {
    const db = resolveDb();

    if (boolFlag(flags, "vendor-gaps")) {
      const rows = await db
        .select({
          katana_supplier_id: katana_po_bills.katana_supplier_id,
          vendor_ref_error: katana_po_bills.vendor_ref_error,
          qbo_vendor_id: katana_po_bills.qbo_vendor_id,
          katana_po_id: katana_po_bills.katana_po_id,
        })
        .from(katana_po_bills)
        .where(
          inArray(katana_po_bills.status, [
            "pending",
            "dry_run",
            "requires_manual_intervention",
          ]),
        )
        .orderBy(asc(katana_po_bills.katana_po_id));

      const gaps = new Map<string, { supplierId: number | null; error: string; poCount: number }>();
      const seenPoPerKey = new Map<string, Set<number>>();
      for (const r of rows) {
        const err = r.vendor_ref_error ?? (!r.qbo_vendor_id ? "vendor_qbo_id_missing" : null);
        if (!err) continue;
        const key = `${r.katana_supplier_id ?? "none"}:${err}`;
        const poSet = seenPoPerKey.get(key) ?? new Set<number>();
        poSet.add(r.katana_po_id);
        seenPoPerKey.set(key, poSet);
        gaps.set(key, {
          supplierId: r.katana_supplier_id,
          error: err,
          poCount: poSet.size,
        });
      }

      const items = [...gaps.values()];
      if (asJson) {
        emit(JSON.stringify({ vendorGaps: items }, null, 2));
      } else if (items.length === 0) {
        emit("No supplier QBO_ID gaps found across pending/dry_run/parked PO bills.");
      } else {
        emit(`Supplier QBO_ID gaps (${items.length}):`);
        for (const item of items) {
          emit(
            `  supplier_id=${item.supplierId ?? "missing"} reason=${item.error} affected_pos=${item.poCount}`,
          );
        }
      }
      return { exitCode: 0, output, sentEvents };
    }

    const poFilterRaw = stringFlag(flags, "po");
    const reasonFilter = stringFlag(flags, "reason");
    const conditions = [eq(katana_po_bills.status, "requires_manual_intervention")];

    if (poFilterRaw !== null) {
      const poId = Number(poFilterRaw);
      if (!Number.isInteger(poId) || poId <= 0) {
        emit(`Invalid --po value: ${poFilterRaw}`);
        return { exitCode: 1, output, sentEvents };
      }
      conditions.push(eq(katana_po_bills.katana_po_id, poId));
    }

    if (reasonFilter !== null) {
      if (!VALID_PARK_REASONS.has(reasonFilter)) {
        emit(`Invalid --reason value: ${reasonFilter}`);
        return { exitCode: 1, output, sentEvents };
      }
      conditions.push(
        eq(katana_po_bills.park_reason, reasonFilter as KatanaPoBillParkReason),
      );
    }

    const parked = await db
      .select()
      .from(katana_po_bills)
      .where(and(...conditions))
      .orderBy(asc(katana_po_bills.katana_po_id), asc(katana_po_bills.receipt_seq));

    const now = nowMs();
    const summaries = parked.map((r) => ({
      id: r.id,
      katanaPoId: r.katana_po_id,
      orderNo: r.order_no,
      receiptSeq: r.receipt_seq,
      docNumber: formatPoBillDocNumber(r.order_no, r.receipt_seq),
      deltaAmount: formatCentsUsd(r.delta_total_cents),
      deltaTotalCents: r.delta_total_cents,
      parkReason: r.park_reason,
      lastError: r.last_error ? scrubSecretText(r.last_error) : null,
      age: formatAgeMinutes(r.created_at, now),
      redriveCount: r.redrive_count,
      allowedActions: allowedActionsLabel(r.park_reason),
    }));

    if (asJson) {
      emit(JSON.stringify({ count: summaries.length, parked: summaries }, null, 2));
      return { exitCode: 0, output, sentEvents };
    }

    if (summaries.length === 0) {
      emit("No parked katana_po_bills rows.");
      return { exitCode: 0, output, sentEvents };
    }

    const byReason = new Map<string, typeof summaries>();
    for (const s of summaries) {
      const key = s.parkReason ?? "unspecified";
      const list = byReason.get(key) ?? [];
      list.push(s);
      byReason.set(key, list);
    }

    for (const [reason, group] of byReason.entries()) {
      emit(`=== ${reason} (${group.length}) ===`);
      for (const item of group) {
        emit(
          `  id=${item.id} po=${item.katanaPoId} (${item.orderNo}) seq=${item.receiptSeq} doc=${item.docNumber} delta=${item.deltaAmount} age=${item.age} redrives=${item.redriveCount} actions=[${item.allowedActions}]`,
        );
        if (item.lastError) {
          emit(`    error: ${item.lastError}`);
        }
      }
    }
    return { exitCode: 0, output, sentEvents };
  }

  if (command === "status") {
    const id = stringFlag(flags, "id");
    if (!id) {
      emit("status requires --id <billRowId>");
      return { exitCode: 1, output, sentEvents };
    }

    const [row] = await resolveDb()
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, id))
      .limit(1);

    if (!row) {
      emit(`katana_po_bills row not found: ${id}`);
      return { exitCode: 1, output, sentEvents };
    }

    const safePayload = {
      id: row.id,
      katanaPoId: row.katana_po_id,
      orderNo: row.order_no,
      receiptSeq: row.receipt_seq,
      docNumber: formatPoBillDocNumber(row.order_no, row.receipt_seq),
      status: row.status,
      parkReason: row.park_reason,
      deltaTotalCents: row.delta_total_cents,
      deltaAmount: formatCentsUsd(row.delta_total_cents),
      katanaSupplierId: row.katana_supplier_id,
      qboVendorId: row.qbo_vendor_id,
      vendorRefError: row.vendor_ref_error,
      qboBillId: row.qbo_bill_id,
      redriveCount: row.redrive_count,
      resolutionKind: row.resolution_kind,
      resolutionRef: row.resolution_ref,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      lastError: row.last_error ? scrubSecretText(row.last_error) : null,
      redriveLog: row.redrive_log,
    };

    if (asJson) {
      emit(JSON.stringify(safePayload, null, 2));
    } else {
      emit(
        `Row ${safePayload.id}: status=${safePayload.status} reason=${safePayload.parkReason ?? "none"} po=${safePayload.katanaPoId} (${safePayload.orderNo}) seq=${safePayload.receiptSeq} delta=${safePayload.deltaAmount} redrives=${safePayload.redriveCount}`,
      );
      if (safePayload.lastError) {
        emit(`  last_error: ${safePayload.lastError}`);
      }
      emit(`  redrive_log (${safePayload.redriveLog.length} entries):`);
      for (const entry of safePayload.redriveLog) {
        emit(
          `    #${entry.seq} at=${entry.at} operator=${entry.operator} action=${entry.action} outcome=${entry.outcome}`,
        );
      }
    }
    return { exitCode: 0, output, sentEvents };
  }

  if (command === "retry") {
    const execute = boolFlag(flags, "execute");
    const operator = stringFlag(flags, "operator");
    const approvePriceDrift = boolFlag(flags, "approve-price-drift");
    const limitRaw = stringFlag(flags, "limit");
    const limit = limitRaw ? Number(limitRaw) : 25;

    if (!Number.isInteger(limit) || limit <= 0) {
      emit(`Invalid --limit value: ${String(limitRaw)}`);
      return { exitCode: 1, output, sentEvents };
    }

    if (execute && !operator) {
      emit("Refusing --execute without --operator <email>.");
      return { exitCode: 1, output, sentEvents };
    }

    const idFilter = stringFlag(flags, "id");
    const poFilterRaw = stringFlag(flags, "po");
    const reasonFilter = stringFlag(flags, "reason");

    if (!idFilter && !poFilterRaw && !reasonFilter) {
      emit("retry requires one of --id <billRowId>, --po <katanaPoId>, or --reason <park_reason>.");
      return { exitCode: 1, output, sentEvents };
    }

    const db = resolveDb();
    let targets: Array<typeof katana_po_bills.$inferSelect> = [];

    if (idFilter) {
      const [single] = await db
        .select()
        .from(katana_po_bills)
        .where(eq(katana_po_bills.id, idFilter))
        .limit(1);
      if (!single) {
        emit(`Ineligible: row ${idFilter} does not exist.`);
        return { exitCode: 2, output, sentEvents };
      }
      if (single.status !== "requires_manual_intervention") {
        emit(`Ineligible: row ${idFilter} has status "${single.status}" (must be requires_manual_intervention).`);
        return { exitCode: 2, output, sentEvents };
      }
      targets = [single];
    } else {
      const conditions = [eq(katana_po_bills.status, "requires_manual_intervention")];
      if (poFilterRaw) {
        const poId = Number(poFilterRaw);
        if (!Number.isInteger(poId) || poId <= 0) {
          emit(`Invalid --po value: ${poFilterRaw}`);
          return { exitCode: 1, output, sentEvents };
        }
        conditions.push(eq(katana_po_bills.katana_po_id, poId));
      }
      if (reasonFilter) {
        if (!VALID_PARK_REASONS.has(reasonFilter)) {
          emit(`Invalid --reason value: ${reasonFilter}`);
          return { exitCode: 1, output, sentEvents };
        }
        conditions.push(
          eq(katana_po_bills.park_reason, reasonFilter as KatanaPoBillParkReason),
        );
      }

      targets = await db
        .select()
        .from(katana_po_bills)
        .where(and(...conditions))
        .orderBy(asc(katana_po_bills.katana_po_id), asc(katana_po_bills.receipt_seq))
        .limit(limit);
    }

    if (targets.length === 0) {
      emit("No matching parked rows found.");
      return { exitCode: 0, output, sentEvents };
    }

    const affectedPoIds = [...new Set(targets.map((r) => r.katana_po_id))];
    const siblingRows = await db
      .select({
        id: katana_po_bills.id,
        katana_po_id: katana_po_bills.katana_po_id,
        status: katana_po_bills.status,
        park_reason: katana_po_bills.park_reason,
      })
      .from(katana_po_bills)
      .where(inArray(katana_po_bills.katana_po_id, affectedPoIds));

    const planned: OutboundPoBillDomainEvent[] = [];
    for (const row of targets) {
      const hasOpenNegativeReceiptOnPo = siblingRows.some(
        (s) =>
          s.katana_po_id === row.katana_po_id &&
          s.id !== row.id &&
          s.status === "requires_manual_intervention" &&
          s.park_reason === "negative_receipt",
      );
      const check = evaluateRetryEligibility({
        parkReason: row.park_reason,
        approvePriceDrift,
        hasOpenNegativeReceiptOnPo,
      });
      if (!check.ok) {
        emit(`Ineligible row ${row.id} (reason=${row.park_reason ?? "null"}): ${check.reason}`);
        return { exitCode: 2, output, sentEvents };
      }

      const nextSeq = row.redrive_count + 1;
      planned.push({
        id: `katana-po-bill-redrive:${row.id}:${nextSeq}`,
        name: KATANA_PO_BILL_REDRIVE_EVENT,
        data: {
          billRowId: row.id,
          katanaPoId: row.katana_po_id,
          expectedRedriveCount: row.redrive_count,
          operator: operator ?? "dry-run",
          approvePriceDrift,
        },
      });
    }

    if (!execute) {
      emit(`Dry-run plan (${planned.length} event(s); pass --execute --operator <email> to send):`);
      for (const evt of planned) {
        emit(`  would send id=${evt.id} name=${evt.name} po=${String(evt.data.katanaPoId)}`);
      }
      return { exitCode: 0, output, sentEvents };
    }

    for (const evt of planned) {
      await sendEvent(evt);
      sentEvents.push(evt);
      emit(`Sent ${evt.id}`);
    }
    return { exitCode: 0, output, sentEvents };
  }

  if (command === "resolve") {
    const execute = boolFlag(flags, "execute");
    const operator = stringFlag(flags, "operator");
    const id = stringFlag(flags, "id");
    const kindRaw = stringFlag(flags, "kind");
    const note = stringFlag(flags, "note");
    const qboRef = stringFlag(flags, "qbo-ref");
    const allowAmountDifference = boolFlag(flags, "allow-amount-difference");

    if (execute && !operator) {
      emit("Refusing --execute without --operator <email>.");
      return { exitCode: 1, output, sentEvents };
    }
    if (!id) {
      emit("resolve requires --id <billRowId>.");
      return { exitCode: 1, output, sentEvents };
    }
    if (!kindRaw || !VALID_RESOLUTION_KINDS.has(kindRaw)) {
      emit(
        `resolve requires --kind <${KATANA_PO_BILL_RESOLUTION_KINDS.join("|")}>.`,
      );
      return { exitCode: 1, output, sentEvents };
    }
    const resolutionKind = kindRaw as KatanaPoBillResolutionKind;

    const db = resolveDb();
    const [row] = await db
      .select()
      .from(katana_po_bills)
      .where(eq(katana_po_bills.id, id))
      .limit(1);

    if (!row) {
      emit(`Ineligible: row ${id} does not exist.`);
      return { exitCode: 2, output, sentEvents };
    }
    if (row.status !== "requires_manual_intervention") {
      emit(
        `Ineligible: row ${id} has status "${row.status}" (must be requires_manual_intervention).`,
      );
      return { exitCode: 2, output, sentEvents };
    }

    const poRows = await db
      .select({
        id: katana_po_bills.id,
        status: katana_po_bills.status,
        park_reason: katana_po_bills.park_reason,
      })
      .from(katana_po_bills)
      .where(eq(katana_po_bills.katana_po_id, row.katana_po_id));

    const hasPoFrozenRowsOnPo = poRows.some(
      (r) =>
        r.id !== row.id &&
        r.status === "requires_manual_intervention" &&
        r.park_reason === "po_frozen",
    );

    const check = evaluateResolveEligibility({
      parkReason: row.park_reason,
      resolutionKind,
      qboRef,
      note,
      hasPoFrozenRowsOnPo,
    });
    if (!check.ok) {
      emit(`Ineligible resolve for row ${id}: ${check.reason}`);
      return { exitCode: 2, output, sentEvents };
    }

    const nextSeq = row.redrive_count + 1;
    const event: OutboundPoBillDomainEvent = {
      id: `katana-po-bill-resolve:${row.id}:${nextSeq}`,
      name: KATANA_PO_BILL_RESOLVE_EVENT,
      data: {
        billRowId: row.id,
        katanaPoId: row.katana_po_id,
        expectedRedriveCount: row.redrive_count,
        resolutionKind,
        qboRef,
        note,
        operator: operator ?? "dry-run",
        allowAmountDifference,
      },
    };

    if (!execute) {
      emit(`Dry-run resolve plan (pass --execute --operator <email> to send):`);
      emit(`  would send id=${event.id} kind=${resolutionKind} qboRef=${qboRef ?? "none"}`);
      return { exitCode: 0, output, sentEvents };
    }

    await sendEvent(event);
    sentEvents.push(event);
    emit(`Sent ${event.id}`);
    return { exitCode: 0, output, sentEvents };
  }

  emit(`Unknown command "${command}". Expected: list, status, retry, resolve.`);
  return { exitCode: 1, output, sentEvents };
}

async function main() {
  try {
    const result = await runPoBillsCli(process.argv.slice(2), {
      writeLine: (line) => console.log(line),
    });
    process.exitCode = result.exitCode;
  } finally {
    await closeDb().catch(() => {});
  }
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMainModule) {
  void main();
}

