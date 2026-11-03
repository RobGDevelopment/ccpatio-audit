/**
 * Phase 15 — pure Katana PO receipt delta ledger, supplier `QBO_ID` parser,
 * deterministic QBO `requestid` / `DocNumber` derivation, accounting-date helper,
 * and operator redrive eligibility rules (§15.2a, §VI R-4/R-6/R-8, §VII S-2..S-6).
 *
 * Pure module: zero I/O, zero wall-clock time, zero randomness, zero console/log calls.
 */

import { createHash } from "node:crypto";
import type {
  KatanaPoBillLine,
  KatanaPoBillParkReason,
  KatanaPoBillResolutionKind,
  KatanaPoBillStatus,
} from "@/server/db/schema";
import { QBO_REQUEST_ID_MAX_LENGTH, qboRequestId } from "@/server/sre/idempotency";

export const KATANA_PO_BILL_POST_EVENT = "katana/po_bill.post_requested" as const;
export const KATANA_PO_BILL_REDRIVE_EVENT = "katana/po_bill.redrive_requested" as const;
export const KATANA_PO_BILL_VENDOR_REFRESH_EVENT =
  "katana/po_bill.vendor_refresh_requested" as const;
export const KATANA_PO_BILL_RESOLVE_EVENT = "katana/po_bill.resolve_requested" as const;

export const KATANA_PO_BILL_SAGA_TYPE = "katana_po_bill" as const;
export const QBO_DOC_NUMBER_MAX_LENGTH = 21;

const QTY_E4_SCALE = 10_000;
const QTY_E4_BIG = BigInt(10_000);
const QTY_HALF_BIG = BigInt(5_000);
const ZERO_BIG = BigInt(0);

/** Accounted statuses (§VII S-6.5): all except `no_delta`. */
export const ACCOUNTED_PO_BILL_STATUSES: ReadonlySet<KatanaPoBillStatus> = new Set([
  "pending",
  "posted",
  "dry_run",
  "requires_manual_intervention",
  "resolved_manually",
]);

export type VendorRefError =
  | "vendor_qbo_id_missing"
  | "vendor_qbo_id_invalid"
  | "vendor_qbo_id_ambiguous"
  | "supplier_missing"
  | "supplier_not_found";

export const VENDOR_PARK_REASONS: ReadonlySet<KatanaPoBillParkReason> = new Set([
  "vendor_qbo_id_missing",
  "vendor_qbo_id_invalid",
  "vendor_qbo_id_ambiguous",
  "supplier_missing",
  "supplier_not_found",
  "vendor_qbo_id_not_found",
  "vendor_inactive",
  "vendor_currency_mismatch",
]);

export type PoReceiptRow = {
  rowId: number;
  sku: string;
  description: string;
  receivedQtyCumulative: number;
  pricePerUnitCents: number;
  receivedDateIso?: string | null;
  createdAtIso?: string | null;
};

export type PriorBill = {
  lines: readonly KatanaPoBillLine[];
  status: KatanaPoBillStatus;
};

export type PoPriceDriftEntry = {
  rowId: number;
  sku: string;
  billedQtyE4: number;
  oldPriceCents: number;
  newPriceCents: number;
  trueUpCents: number;
};

export type ComputeReceiptDeltaResult =
  | {
      kind: "delta";
      lines: KatanaPoBillLine[];
      deltaTotalCents: number;
      priceDrift: PoPriceDriftEntry[];
    }
  | {
      kind: "no_delta";
      priceDrift: PoPriceDriftEntry[];
    }
  | {
      kind: "negative";
      rowIds: number[];
      lines: KatanaPoBillLine[];
      expectedCreditCents: number;
    };

export function toQtyE4(qty: number): number {
  if (!Number.isFinite(qty) || qty < 0) {
    throw new Error(`Invalid Katana PO quantity: ${String(qty)}`);
  }
  const scaled = qty * QTY_E4_SCALE;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new Error(`Katana PO quantity ${qty} exceeds 4 decimal places`);
  }
  return rounded;
}

export function fromQtyE4(qtyE4: number): number {
  return qtyE4 / QTY_E4_SCALE;
}

/** Half-up integer rounding of `(qtyE4 / 10_000) * priceCents` (§VII S-5.1/S-5.2). */
export function roundHalfUpFromE4(qtyE4: number, priceCents: number): number {
  const product = BigInt(qtyE4) * BigInt(priceCents);
  if (product >= ZERO_BIG) {
    return Number((product + QTY_HALF_BIG) / QTY_E4_BIG);
  }
  return -Number((-product + QTY_HALF_BIG) / QTY_E4_BIG);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extracts normalized PO receipt rows (§15.2a).
 * Supports both `row.received_quantity` (when numeric) and Katana's split-row `row.received_date`
 * model (`received_date` non-empty => `row.quantity`, else `0`).
 * Throws if any row lacks a positive integer `id`.
 */
export function readPoReceiptRows(po: Record<string, unknown>): PoReceiptRow[] {
  const entity = asRecord(po.data) ?? po;
  const orderNo =
    typeof entity.order_no === "string" && entity.order_no.trim()
      ? entity.order_no.trim()
      : "PO";
  const rawRows = Array.isArray(entity.purchase_order_rows)
    ? entity.purchase_order_rows
    : [];

  return rawRows.map((raw, idx) => {
    const row = asRecord(raw);
    if (!row) {
      throw new Error(`PO ${orderNo} row at index ${idx} is not an object`);
    }
    const idNum = typeof row.id === "number" ? row.id : Number(row.id);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      throw new Error(`PO ${orderNo} row at index ${idx} is missing a positive integer id`);
    }

    const receivedDateIso =
      typeof row.received_date === "string" && row.received_date.trim()
        ? row.received_date.trim()
        : null;
    const createdAtIso =
      typeof row.created_at === "string" && row.created_at.trim()
        ? row.created_at.trim()
        : null;

    let cumulative = 0;
    if (row.received_quantity !== undefined && row.received_quantity !== null) {
      const rq = Number(row.received_quantity);
      if (!Number.isFinite(rq) || rq < 0) {
        throw new Error(`PO ${orderNo} row ${idNum} has invalid received_quantity`);
      }
      cumulative = rq;
    } else if (receivedDateIso !== null) {
      const qty = Number(row.quantity ?? 0);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error(`PO ${orderNo} row ${idNum} has invalid quantity`);
      }
      cumulative = qty;
    }

    // Validate 4-decimal bound eagerly.
    toQtyE4(cumulative);

    const unitPrice = Number(row.price_per_unit ?? 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`PO ${orderNo} row ${idNum} has invalid price_per_unit`);
    }
    const pricePerUnitCents = Math.round(unitPrice * 100);

    const sku =
      typeof row.variant_sku === "string" && row.variant_sku.trim()
        ? row.variant_sku.trim()
        : typeof row.sku === "string" && row.sku.trim()
          ? row.sku.trim()
          : row.variant_id != null
            ? `VAR-${String(row.variant_id)}`
            : `ROW-${idNum}`;
    const description =
      typeof row.notes === "string" && row.notes.trim()
        ? row.notes.trim()
        : typeof row.variant_name === "string" && row.variant_name.trim()
          ? row.variant_name.trim()
          : `PO ${orderNo} Row ${idNum}`;

    return {
      rowId: idNum,
      sku,
      description,
      receivedQtyCumulative: cumulative,
      pricePerUnitCents,
      receivedDateIso,
      createdAtIso,
    };
  });
}

/**
 * Deterministic sha256 hex of `${poId}|` + rows sorted by `rowId` (`${rowId}:${qtyE4}`).
 */
export function receiptFingerprint(poId: number, rows: readonly PoReceiptRow[]): string {
  const sorted = [...rows].sort((a, b) => a.rowId - b.rowId);
  const body = sorted.map((r) => `${r.rowId}:${toQtyE4(r.receivedQtyCumulative)}`).join(",");
  return createHash("sha256").update(`${poId}|${body}`).digest("hex");
}

function accountedStateByRow(prior: readonly PriorBill[]): Map<
  number,
  {
    billedQtyE4: number;
    lastPriceCents: number | null;
    sku: string;
    description: string;
  }
> {
  const map = new Map<
    number,
    {
      billedQtyE4: number;
      lastPriceCents: number | null;
      sku: string;
      description: string;
    }
  >();

  for (const bill of prior) {
    if (!ACCOUNTED_PO_BILL_STATUSES.has(bill.status)) continue;
    for (const line of bill.lines) {
      const deltaE4 = Math.round(line.billedQtyDelta * QTY_E4_SCALE);
      const existing = map.get(line.rowId) ?? {
        billedQtyE4: 0,
        lastPriceCents: null,
        sku: line.sku,
        description: line.description,
      };
      existing.billedQtyE4 += deltaE4;
      if (deltaE4 > 0) {
        existing.lastPriceCents = line.pricePerUnitCents;
      } else if (existing.lastPriceCents === null) {
        existing.lastPriceCents = line.pricePerUnitCents;
      }
      if (line.sku) existing.sku = line.sku;
      if (line.description) existing.description = line.description;
      map.set(line.rowId, existing);
    }
  }
  return map;
}

/**
 * True when any row's cumulative quantity in `rows` is strictly lower than the PO's
 * high-watermark / latest recorded cumulative (§VII S-6.1).
 */
export function snapshotDecreasesAgainstPrior(
  rows: readonly PoReceiptRow[],
  prior: readonly PriorBill[],
): boolean {
  const accounted = accountedStateByRow(prior);
  const currentByRow = new Map<number, number>();
  for (const row of rows) {
    currentByRow.set(row.rowId, toQtyE4(row.receivedQtyCumulative));
  }

  // Check against accounted watermark B.
  for (const [rowId, state] of accounted.entries()) {
    const cur = currentByRow.get(rowId) ?? 0;
    if (cur < state.billedQtyE4) return true;
  }

  // Also check against the latest recorded bill's line cumulatives.
  const latest = prior.length > 0 ? prior[prior.length - 1] : null;
  if (latest) {
    for (const line of latest.lines) {
      const latestCumE4 = Math.round(line.receivedQtyCumulative * QTY_E4_SCALE);
      const cur = currentByRow.get(line.rowId) ?? 0;
      if (cur < latestCumE4) return true;
    }
  }
  return false;
}

/**
 * Delta-only telescoping billing math with high-watermark negative detection and
 * cross-row price-drift detection (§VII S-5 & S-6).
 */
export function computeReceiptDelta(
  rows: readonly PoReceiptRow[],
  prior: readonly PriorBill[],
): ComputeReceiptDeltaResult {
  const accounted = accountedStateByRow(prior);
  const currentByRow = new Map<number, PoReceiptRow>();
  for (const row of rows) {
    currentByRow.set(row.rowId, row);
  }

  const allRowIds = new Set<number>();
  for (const row of rows) allRowIds.add(row.rowId);
  for (const rowId of accounted.keys()) allRowIds.add(rowId);

  const negativeRowIds: number[] = [];
  const negativeLines: KatanaPoBillLine[] = [];
  let expectedCreditCents = 0;

  for (const rowId of [...allRowIds].sort((a, b) => a - b)) {
    const state = accounted.get(rowId);
    const billedBeforeE4 = state?.billedQtyE4 ?? 0;
    const current = currentByRow.get(rowId);
    const currentCumE4 = current ? toQtyE4(current.receivedQtyCumulative) : 0;

    if (currentCumE4 < billedBeforeE4) {
      const decreaseQtyE4 = billedBeforeE4 - currentCumE4;
      const lastPrice = state?.lastPriceCents ?? current?.pricePerUnitCents ?? 0;
      negativeRowIds.push(rowId);
      negativeLines.push({
        rowId,
        sku: current?.sku ?? state?.sku ?? `ROW-${rowId}`,
        description: current?.description ?? state?.description ?? `Row ${rowId}`,
        receivedQtyCumulative: fromQtyE4(currentCumE4),
        billedQtyBefore: fromQtyE4(billedBeforeE4),
        billedQtyDelta: 0,
        pricePerUnitCents: lastPrice,
        amountCents: 0,
        decreaseQtyE4,
      });
      expectedCreditCents += roundHalfUpFromE4(decreaseQtyE4, lastPrice);
    }
  }

  if (negativeRowIds.length > 0) {
    return {
      kind: "negative",
      rowIds: negativeRowIds,
      lines: negativeLines,
      expectedCreditCents,
    };
  }

  // Price drift checked on EVERY previously billed row (B > 0), even when its delta is 0 (S-5.3).
  const priceDrift: PoPriceDriftEntry[] = [];
  const driftedRowIds = new Set<number>();
  for (const row of rows) {
    const state = accounted.get(row.rowId);
    if (!state || state.billedQtyE4 <= 0 || state.lastPriceCents === null) continue;
    if (row.pricePerUnitCents !== state.lastPriceCents) {
      driftedRowIds.add(row.rowId);
      const trueUpCents =
        roundHalfUpFromE4(state.billedQtyE4, row.pricePerUnitCents) -
        roundHalfUpFromE4(state.billedQtyE4, state.lastPriceCents);
      priceDrift.push({
        rowId: row.rowId,
        sku: row.sku,
        billedQtyE4: state.billedQtyE4,
        oldPriceCents: state.lastPriceCents,
        newPriceCents: row.pricePerUnitCents,
        trueUpCents,
      });
    }
  }

  const deltaLines: KatanaPoBillLine[] = [];
  let deltaTotalCents = 0;

  for (const row of rows) {
    const billedBeforeE4 = accounted.get(row.rowId)?.billedQtyE4 ?? 0;
    const currentCumE4 = toQtyE4(row.receivedQtyCumulative);
    const deltaE4 = currentCumE4 - billedBeforeE4;
    if (deltaE4 <= 0) continue;

    const amountCents =
      roundHalfUpFromE4(currentCumE4, row.pricePerUnitCents) -
      roundHalfUpFromE4(billedBeforeE4, row.pricePerUnitCents);
    const priceChanged = driftedRowIds.has(row.rowId);

    deltaLines.push({
      rowId: row.rowId,
      sku: row.sku,
      description: row.description,
      receivedQtyCumulative: fromQtyE4(currentCumE4),
      billedQtyBefore: fromQtyE4(billedBeforeE4),
      billedQtyDelta: fromQtyE4(deltaE4),
      pricePerUnitCents: row.pricePerUnitCents,
      amountCents,
      ...(priceChanged ? { priceChanged: true } : {}),
    });
    deltaTotalCents += amountCents;
  }

  if (deltaLines.length === 0) {
    return { kind: "no_delta", priceDrift };
  }

  return {
    kind: "delta",
    lines: deltaLines,
    deltaTotalCents,
    priceDrift,
  };
}

function normalizeSupplierComment(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n?/g, "\n");
}

const CANDIDATE_QBO_LINE_RE = /^qbo[\s_-]*id\b/i;
const STRICT_QBO_ID_LINE_RE = /^\s*QBO_ID\s*:\s*([1-9]\d{0,11})\s*$/i;

/**
 * Parses `QBO_ID: <digits>` from `sup.comment` (§VII S-2.3).
 * Never logs or returns `sup.comment` text.
 */
export function parseQboVendorIdFromSupplier(
  sup: Record<string, unknown>,
): { ok: true; qboVendorId: string } | { ok: false; reason: VendorRefError } {
  if (typeof sup.comment !== "string" || !sup.comment.trim()) {
    return { ok: false, reason: "vendor_qbo_id_missing" };
  }

  const normalized = normalizeSupplierComment(sup.comment);
  const candidateLines = normalized
    .split("\n")
    .filter((line) => CANDIDATE_QBO_LINE_RE.test(line.trim()));

  if (candidateLines.length === 0) {
    return { ok: false, reason: "vendor_qbo_id_missing" };
  }

  const matchedIds = new Set<string>();
  for (const line of candidateLines) {
    const match = STRICT_QBO_ID_LINE_RE.exec(line);
    if (!match?.[1]) {
      return { ok: false, reason: "vendor_qbo_id_invalid" };
    }
    matchedIds.add(match[1]);
  }

  if (matchedIds.size > 1) {
    return { ok: false, reason: "vendor_qbo_id_ambiguous" };
  }

  return { ok: true, qboVendorId: [...matchedIds][0]! };
}

/**
 * Deterministic QBO `requestid` per receipt and per redrive (§VII S-3).
 * Zero wall-clock time or randomness; always `<= QBO_REQUEST_ID_MAX_LENGTH`.
 */
export function derivePoBillRequestId(
  poId: number,
  fingerprint: string,
  redriveCount: number = 0,
): string {
  if (!Number.isInteger(redriveCount) || redriveCount < 0) {
    throw new Error(`Invalid redriveCount: ${String(redriveCount)}`);
  }
  const sagaKey =
    redriveCount === 0
      ? `katana:po:${poId}:${fingerprint}`
      : `katana:po:${poId}:${fingerprint}:r${redriveCount}`;
  const reqId = qboRequestId(sagaKey, "ap-bill");
  if (reqId.length > QBO_REQUEST_ID_MAX_LENGTH) {
    throw new Error(`Derived requestId exceeds ${QBO_REQUEST_ID_MAX_LENGTH} characters`);
  }
  return reqId;
}

/**
 * Formats QBO `DocNumber` (`<= 21` chars) while preserving `-R{seq}` for `seq >= 2` (§15.2a).
 */
export function formatPoBillDocNumber(orderNo: string, receiptSeq: number): string {
  const base = orderNo.trim() || "PO";
  if (receiptSeq <= 1) {
    return base.slice(0, QBO_DOC_NUMBER_MAX_LENGTH);
  }
  const suffix = `-R${receiptSeq}`;
  const maxBase = Math.max(1, QBO_DOC_NUMBER_MAX_LENGTH - suffix.length);
  return `${base.slice(0, maxBase)}${suffix}`;
}

export function isValidIanaTimeZone(tz: string | null | undefined): boolean {
  const trimmed = tz?.trim() ?? "";
  if (!trimmed) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function formatEpochMsInZone(epochMs: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(epochMs);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  if (!year || !month || !day) {
    throw new Error(`Could not format receipt date in timezone "${timeZone}"`);
  }
  return `${year}-${month}-${day}`;
}

/**
 * Computes `katana_po_bills.receipt_date` (`YYYY-MM-DD`) in `timeZone` from the latest
 * `received_date` (or `created_at` fallback) among the delta rows (§VI R-8.1).
 */
export function deriveReceiptDateInZone(
  rows: readonly PoReceiptRow[],
  deltaRowIds: ReadonlySet<number>,
  timeZone: string,
  fallbackIso?: string | null,
): string | null {
  if (!isValidIanaTimeZone(timeZone)) return null;

  const targetRows =
    deltaRowIds.size > 0 ? rows.filter((r) => deltaRowIds.has(r.rowId)) : rows;

  const parseCandidates = (candidates: Array<string | null | undefined>): number | null => {
    let latest: number | null = null;
    for (const raw of candidates) {
      if (!raw) continue;
      const ms = Date.parse(raw);
      if (Number.isFinite(ms) && (latest === null || ms > latest)) {
        latest = ms;
      }
    }
    return latest;
  };

  const epochMs =
    parseCandidates(targetRows.map((r) => r.receivedDateIso)) ??
    parseCandidates(targetRows.map((r) => r.createdAtIso)) ??
    parseCandidates(rows.map((r) => r.receivedDateIso)) ??
    parseCandidates(rows.map((r) => r.createdAtIso)) ??
    parseCandidates([fallbackIso]);

  if (epochMs === null) return null;
  return formatEpochMsInZone(epochMs, timeZone.trim());
}

export function checkLedgerPostConfig(
  env: Record<string, string | undefined> = process.env,
):
  | { ok: true; assetAccountId: string; timeZone: string }
  | { ok: false; message: string } {
  const assetAccountId = env.QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID?.trim() ?? "";
  if (!/^\d+$/.test(assetAccountId)) {
    return {
      ok: false,
      message:
        "QBO_RAW_MATERIALS_ASSET_ACCOUNT_ID must be configured to a numeric QuickBooks Account Id.",
    };
  }
  const timeZone = env.LEDGER_COMPANY_TIMEZONE?.trim() ?? "";
  if (!isValidIanaTimeZone(timeZone)) {
    return {
      ok: false,
      message:
        "LEDGER_COMPANY_TIMEZONE must be configured to a valid IANA timezone (e.g. America/Phoenix).",
    };
  }
  return { ok: true, assetAccountId, timeZone };
}

/**
 * Operator `retry` eligibility matrix (§VII S-4).
 */
export function evaluateRetryEligibility(input: {
  parkReason: KatanaPoBillParkReason | null;
  approvePriceDrift: boolean;
  hasOpenNegativeReceiptOnPo: boolean;
}): { ok: true; needsVendorRefresh: boolean } | { ok: false; reason: string } {
  const reason = input.parkReason;
  if (!reason) {
    return { ok: false, reason: "missing_park_reason" };
  }
  if (reason === "currency_unsupported" || reason === "negative_receipt") {
    return { ok: false, reason: `retry_forbidden_for_${reason}` };
  }
  if (reason === "price_drift" && !input.approvePriceDrift) {
    return { ok: false, reason: "price_drift_requires_approve_flag" };
  }
  if (reason === "po_frozen" && input.hasOpenNegativeReceiptOnPo) {
    return { ok: false, reason: "po_has_unresolved_negative_receipt" };
  }
  return { ok: true, needsVendorRefresh: VENDOR_PARK_REASONS.has(reason) };
}

/**
 * Operator `resolve` eligibility matrix (§VII S-4).
 */
export function evaluateResolveEligibility(input: {
  parkReason: KatanaPoBillParkReason | null;
  resolutionKind: KatanaPoBillResolutionKind;
  qboRef?: string | null;
  note?: string | null;
  hasPoFrozenRowsOnPo?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const reason = input.parkReason;
  if (!reason) {
    return { ok: false, reason: "missing_park_reason" };
  }
  if (!input.note?.trim()) {
    return { ok: false, reason: "note_required" };
  }
  if (reason === "negative_receipt") {
    if (
      input.resolutionKind !== "vendor_credit_issued" &&
      input.resolutionKind !== "katana_correction"
    ) {
      return { ok: false, reason: "negative_receipt_requires_credit_or_katana_correction" };
    }
    if (input.resolutionKind === "vendor_credit_issued") {
      if (!input.qboRef?.trim()) {
        return { ok: false, reason: "qbo_ref_required_for_vendor_credit_issued" };
      }
      if (input.hasPoFrozenRowsOnPo) {
        return { ok: false, reason: "resolve_po_frozen_rows_before_vendor_credit" };
      }
    }
    return { ok: true };
  }

  if (input.resolutionKind !== "entered_by_hand") {
    return { ok: false, reason: `only_entered_by_hand_allowed_for_${reason}` };
  }
  if (!input.qboRef?.trim()) {
    return { ok: false, reason: "qbo_ref_required_for_entered_by_hand" };
  }
  return { ok: true };
}
