/**
 * CCPATIO 56-Day End-to-End SLA (8 weeks) — authoritative calendar deltas.
 * Keys mirror stories.ts (nodeId, nodeId::stageId, storyKey).
 * Only milestone steps carry +Nd; intermediates are instant (systems / in-phase).
 */

import { RETAIL_SEQUENCE, type SequenceStep } from "./sequences";

export const E2E_SLA_DAYS = 56;

/** Executive SLA phases — sum = 56 */
export const SLA_PHASES = [
  { label: "Lead ingestion → On-site scheduled", days: 4 },
  { label: "SketchUp 3D modeling & proposal", days: 7 },
  { label: "Produce FO → Client approval", days: 3 },
  { label: "Tube cut lists & BOM packet", days: 2 },
  { label: "Procurement wait (backorder buffer)", days: 10 },
  { label: "Chop saw cut & miter station", days: 3 },
  { label: "Fabrication pod weld-out (Gate A)", days: 5 },
  { label: "Sandblast & powder coat (Gate B)", days: 5 },
  { label: "Custom upholstery & cushion sewing", days: 4 },
  { label: "Final assembly & pre-pack (Gate C)", days: 3 },
  { label: "3-way dispatch routing", days: 3 },
  { label: "White-glove delivery", days: 5 },
  { label: "QBO/Clover financial reconciliation", days: 2 },
] as const;

export type DwellCalendarEntry = {
  daysMin: number;
  daysMax?: number;
  instant?: boolean;
  /** Which SLA phase this milestone closes (1–13) */
  slaPhase?: number;
  /** SLA penalty day (exceptions) */
  penalty?: boolean;
};

function calKey(nodeId: string, stageId?: string | null) {
  return stageId ? `${nodeId}::${stageId}` : nodeId;
}

const INSTANT: DwellCalendarEntry = { daysMin: 0, instant: true };

const CALENDAR: Record<string, DwellCalendarEntry> = {
  /* ── Omnichannel / intake (within Phase 1 window — milestone at onsite) ── */
  "traffic-meta": INSTANT,
  "chan-webchat": INSTANT,
  "chan-phone": INSTANT,
  "chan-whatsapp": INSTANT,
  "ghl-hub": INSTANT,
  "leads-pipe::lead-new": INSTANT,
  "leads-pipe::lead-website": INSTANT,
  "trade-pipe::trade-app": INSTANT,
  "trade-pipe::trade-approved": INSTANT,
  "sales-az::az-onsite": { daysMin: 4, daysMax: 4, slaPhase: 1 },
  "sales-ca::ca-onsite": { daysMin: 4, daysMax: 4, slaPhase: 1 },

  /* ── Design & sales (Phases 2–4 in playback order) ── */
  "sales-az::az-sketchup-needed": INSTANT,
  "sales-ca::ca-sketchup-needed": INSTANT,
  "field-survey": INSTANT,
  sketchup: INSTANT,
  "cut-lists": INSTANT,
  "bom-packet": { daysMin: 2, daysMax: 2, slaPhase: 4 },
  "sales-az::az-sketchup-done": INSTANT,
  "sales-ca::ca-sketchup-done": INSTANT,
  "sales-az::az-proposal": { daysMin: 7, daysMax: 7, slaPhase: 2 },
  "sales-ca::ca-proposal": { daysMin: 7, daysMax: 7, slaPhase: 2 },
  "sales-az::az-finalize": INSTANT,
  "sales-ca::ca-finalize": INSTANT,
  "sales-az::az-produce": { daysMin: 3, daysMax: 3, slaPhase: 3 },
  "sales-ca::ca-produce": { daysMin: 3, daysMax: 3, slaPhase: 3 },
  "sales-az::az-approval": INSTANT,
  "sales-ca::ca-approval": INSTANT,
  "produce-az": INSTANT,
  "produce-ca": INSTANT,
  "produce-warranty": INSTANT,

  "qbo-deposit-link": INSTANT,
  "clover-showroom": INSTANT,
  "payment-gateway": INSTANT,

  "inventory-alloc": INSTANT,
  "procurement-wait": { daysMin: 10, daysMax: 10, slaPhase: 5 },
  "outsourced-accessories": INSTANT,
  "dispatch-routes::dispatch-box": INSTANT,
  "dispatch-routes::dispatch-3pl": INSTANT,
  "dispatch-routes::dispatch-willcall": INSTANT,

  /* ── Middleware (systems — no calendar advance) ── */
  ingress: INSTANT,
  redis: INSTANT,
  postgres: INSTANT,
  inngest: INSTANT,
  katana: INSTANT,

  /* ── Factory (Phases 5–10) — chop saw + fabrication pods ── */
  "work-centers::wc-tube-stock": INSTANT,
  "work-centers::wc-chop-saw": { daysMin: 3, daysMax: 3, slaPhase: 6 },
  "work-centers::wc-cart-parts": INSTANT,
  "work-centers::wc-tack": INSTANT,
  "work-centers::wc-weld-out": INSTANT,
  "work-centers::wc-grinder": INSTANT,
  "work-centers::wc-marriage": INSTANT,
  "qc-gates::qc-a": { daysMin: 5, daysMax: 5, slaPhase: 7 },
  "work-centers::wc-cart-blast": INSTANT,
  "work-centers::wc-sandblast": INSTANT,
  "work-centers::wc-powder": INSTANT,
  "qc-gates::qc-b": { daysMin: 5, daysMax: 5, slaPhase: 8 },
  "work-centers::wc-upholstery": { daysMin: 4, daysMax: 4, slaPhase: 9 },
  "work-centers::wc-final": INSTANT,
  "qc-gates::qc-c": { daysMin: 3, daysMax: 3, slaPhase: 10 },
  "mfg-pipe::mfg-ready": INSTANT,
  "mfg-pipe::mfg-new": INSTANT,
  "mfg-pipe::mfg-purchasing": INSTANT,
  "mfg-pipe::mfg-production": INSTANT,
  "mfg-pipe::mfg-delivered": INSTANT,

  /* ── Logistics & treasury (Phases 11–13) ── */
  dispatch: { daysMin: 3, daysMax: 3, slaPhase: 11 },
  delivery: { daysMin: 5, daysMax: 5, slaPhase: 12 },
  qbo: INSTANT,
  clover: INSTANT,
  reconciled: { daysMin: 2, daysMax: 2, slaPhase: 13 },
  "sales-az::az-delivered": INSTANT,
  "sales-ca::ca-delivered": INSTANT,
  postcare: INSTANT,

  /* ── Warranty (shorter front; factory/logistics reuse SLA where applicable) ── */
  "warranty-pipe::warranty-discovery": INSTANT,
  "warranty-pipe::warranty-approved": INSTANT,
  "warranty-pipe::warranty-produce": INSTANT,
  "warranty-pipe::warranty-closed": INSTANT,

  /* ── Exceptions (penalties additive to baseline SLA) ── */
  "ncr-gate-a-fail": INSTANT,
  "ncr-rejected": INSTANT,
  "ncr-rework": { daysMin: 3, daysMax: 3, penalty: true },
  "ncr-gate-a-pass": INSTANT,
  "ncr-cleared": INSTANT,
  "clover-miss-invoice": INSTANT,
  "clover-miss-dlq": { daysMin: 2, daysMax: 5, penalty: true },
  "clover-miss-delivered": INSTANT,
  "clover-miss-postcare": INSTANT,
  "redis-failopen": INSTANT,
  "redis-failopen-outbox": INSTANT,
  "redis-failopen-ccr": INSTANT,
  "redis-failopen-katana": INSTANT,
  "gate-b-fail": INSTANT,
  "gate-b-rejected": INSTANT,
  "gate-b-rework": { daysMin: 3, daysMax: 3, penalty: true },
  "gate-b-recoat": { daysMin: 2, daysMax: 2, penalty: true },
  "gate-b-pass": INSTANT,
  "gate-b-cleared": INSTANT,
  "qbo-mutex-first": INSTANT,
  "qbo-mutex-blocked": INSTANT,
  "qbo-mutex-retry": INSTANT,
  "gate-c-fail": INSTANT,
  "gate-c-rejected": INSTANT,
  "gate-c-rework": { daysMin: 2, daysMax: 2, penalty: true },
  "gate-c-reassembly": INSTANT,
  "gate-c-cleared": INSTANT,
  "ccr-dual-webhook": INSTANT,
  "ccr-worker1-lease": INSTANT,
  "ccr-webhook-retry": INSTANT,
  "ccr-worker2-violation": INSTANT,
  "ccr-worker1-inngest": INSTANT,
  "ccr-worker1-katana": INSTANT,
  "ccr-worker2-yield": INSTANT,
  "ccr-duplicate-resolve": INSTANT,
};

export function lookupCalendar(
  nodeId: string,
  stageId?: string | null,
  storyKey?: string | null
): DwellCalendarEntry | null {
  if (storyKey && CALENDAR[storyKey]) return CALENDAR[storyKey];
  if (stageId) {
    const k = calKey(nodeId, stageId);
    if (CALENDAR[k]) return CALENDAR[k];
  }
  return CALENDAR[nodeId] ?? null;
}

export function stepCalendar(step: SequenceStep): DwellCalendarEntry | null {
  return lookupCalendar(step.nodeId, step.stageId, step.storyKey);
}

export function cumulativeCalendarDays(
  steps: SequenceStep[],
  throughIndex: number
): { totalMin: number; totalMax: number; current: DwellCalendarEntry | null } {
  let totalMin = 0;
  let totalMax = 0;
  const end = Math.min(throughIndex, steps.length - 1);
  for (let i = 0; i <= end; i++) {
    const e = stepCalendar(steps[i]);
    if (e && !e.instant) {
      totalMin += e.daysMin;
      totalMax += e.daysMax ?? e.daysMin;
    }
  }
  const current =
    throughIndex >= 0 && throughIndex < steps.length
      ? stepCalendar(steps[throughIndex])
      : null;
  return { totalMin, totalMax, current };
}

export function formatTimelineDay(min: number, max: number): string {
  if (min === 0 && max === 0) return "Day 0";
  if (min === max) {
    return `Day ${min}`;
  }
  return `Day ${min}–${max}`;
}

/** Terminal reconciliation label — journey day vs max SLA ceiling */
export function formatTerminalSlaLabel(journeyDay: number): string {
  if (journeyDay >= E2E_SLA_DAYS) {
    return `Day ${journeyDay} · ${E2E_SLA_DAYS}-day SLA complete`;
  }
  return `Day ${journeyDay} · within ${E2E_SLA_DAYS}-day max SLA`;
}

export function formatStepDelta(entry: DwellCalendarEntry | null): string | null {
  if (!entry) return null;
  if (entry.instant) return "Systems · same day";
  if (entry.penalty) {
    return `+${entry.daysMin}d SLA penalty`;
  }
  if (entry.slaPhase) {
    const phase = SLA_PHASES[entry.slaPhase - 1];
    return `+${entry.daysMin}d · ${phase?.label ?? "SLA phase"}`;
  }
  if (entry.daysMax != null && entry.daysMax !== entry.daysMin) {
    return `+${entry.daysMin}–${entry.daysMax} cal. days`;
  }
  if (entry.daysMin === 0) return "Same day";
  return `+${entry.daysMin} cal. day${entry.daysMin === 1 ? "" : "s"}`;
}

/** Dev guard — retail happy path should land at reconciled on or before Day 56 */
export function assertRetailSlaTerminal(): void {
  const idx = RETAIL_SEQUENCE.findIndex((s) => s.nodeId === "reconciled");
  if (idx < 0) return;
  const { totalMin, totalMax } = cumulativeCalendarDays(RETAIL_SEQUENCE, idx);
  if (totalMin > E2E_SLA_DAYS || totalMax > E2E_SLA_DAYS) {
    console.warn(
      `[dwellCalendar] Retail SLA exceeds ${E2E_SLA_DAYS}d at reconciled: ${totalMin}–${totalMax}`
    );
  }
}

if (typeof window !== "undefined") {
  assertRetailSlaTerminal();
}
