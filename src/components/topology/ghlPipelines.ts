/**
 * GHL pipelines + walkthrough contracts — aligned to
 * docs/blueprints/Topology_E2E_Lifecycle_Blueprint.md
 */

export type GhlStageDef = {
  id: string;
  label: string;
  gate?: boolean;
};

export type GhlPipelineDef = {
  id: string;
  label: string;
  accent: string;
  zoneIds: string[];
  stages: GhlStageDef[];
};

/** Exact Blueprint taxonomy labels */
export const GHL_PIPELINES: GhlPipelineDef[] = [
  {
    id: "leads",
    label: "Leads",
    accent: "#818cf8",
    zoneIds: ["z2"],
    stages: [
      { id: "lead-new", label: "New | Uncontacted" },
      { id: "lead-contacted-no-response", label: "Contacted | No Response" },
      { id: "lead-interested", label: "Interested | Needs Follow Up" },
      { id: "lead-nurture", label: "Nurture | Needs Follow Up" },
      { id: "lead-website", label: "Website Order Form" },
    ],
  },
  {
    id: "trade",
    label: "Trade",
    accent: "#6366f1",
    zoneIds: ["z2"],
    stages: [
      { id: "trade-app", label: "Application Submitted" },
      { id: "trade-approved", label: "Approved" },
      { id: "trade-declined", label: "Declined" },
    ],
  },
  {
    id: "warranty",
    label: "Warranty Claims",
    accent: "#fb923c",
    zoneIds: ["z2"],
    stages: [
      { id: "war-discovery", label: "Discovery" },
      { id: "war-paused", label: "Paused" },
      { id: "war-file-claim", label: "File Claim" },
      { id: "war-claim-filed", label: "Claim Filed" },
      { id: "war-claim-denied", label: "Claim Denied" },
      { id: "war-claim-approved", label: "Claim Approved" },
      { id: "war-selecting-colors", label: "Selecting Colors" },
      { id: "war-produce-fo", label: "Produce FO", gate: true },
      { id: "war-send-to-mfg", label: "Send To Manufacturing" },
      { id: "war-claim-closed", label: "Claim Closed" },
    ],
  },
  {
    id: "sales-az",
    label: "Scottsdale | Sales",
    accent: "#8b5cf6",
    zoneIds: ["z3"],
    stages: [
      { id: "az-onsite", label: "01.D On-Site Scheduled" },
      { id: "az-sketchup-needed", label: "02.D Sketchup Needed" },
      { id: "az-sketchup-done", label: "03.S Sketchup Done" },
      { id: "az-proposal", label: "04.S Proposal Given" },
      { id: "az-finalize", label: "05.S Finalize Finishes" },
      { id: "az-produce", label: "06.D Produce Factory Order", gate: true },
      { id: "az-approval", label: "07.S Get Client Approval", gate: true },
      { id: "az-delivered", label: "08. Delivered" },
    ],
  },
  {
    id: "sales-ca",
    label: "Solana Beach | Sales",
    accent: "#a78bfa",
    zoneIds: ["z3"],
    stages: [
      { id: "ca-onsite", label: "01. On-Site Scheduled" },
      { id: "ca-sketchup-needed", label: "02. SketchUp Needed" },
      { id: "ca-sketchup-done", label: "03. SketchUp Done" },
      { id: "ca-proposal", label: "04. Proposal Given" },
      { id: "ca-finalize", label: "05. Finalize Finishes" },
      { id: "ca-produce", label: "06. Produce Factory Order", gate: true },
      { id: "ca-approval", label: "07. Get Client Approval", gate: true },
      { id: "ca-delivered", label: "08. Delivered" },
      { id: "ca-lost", label: "09. Lost" },
    ],
  },
  {
    id: "mfg",
    label: "Manufacturing",
    accent: "#fbbf24",
    zoneIds: ["z6"],
    stages: [
      { id: "mfg-new", label: "New FO / New SO" },
      { id: "mfg-updated-fo", label: "Updated FO" },
      { id: "mfg-purchasing", label: "Purchasing" },
      { id: "mfg-receiving", label: "Receiving" },
      { id: "mfg-paused", label: "Order Paused" },
      { id: "mfg-collect-payment", label: "Collect Payment" },
      { id: "mfg-schedule-delivery", label: "Schedule Delivery" },
      { id: "mfg-delivery-scheduled", label: "Delivery Scheduled" },
      { id: "mfg-production", label: "Production in Progress" },
      { id: "mfg-ready", label: "Ready for Delivery" },
      { id: "mfg-delivered", label: "Delivered | Rejected" },
    ],
  },
];

/**
 * Top Rail pipelines per walkthrough.
 * Trade includes sales-ca so CA satellite pings resolve (Blueprint §4.3).
 */
export const ACTIVE_GHL_BY_WALKTHROUGH: Record<string, string[]> = {
  scottsdale: ["leads", "sales-az", "mfg"],
  solana: ["leads", "sales-ca", "mfg"],
  trade: ["trade", "sales-ca", "mfg"],
  warranty: ["warranty", "mfg"],
};

export type WalkthroughId = "scottsdale" | "solana" | "trade" | "warranty";

export const WALKTHROUGH_OPTIONS: {
  id: WalkthroughId;
  label: string;
  description: string;
  journeyId: "retail" | "trade" | "warranty";
}[] = [
  {
    id: "scottsdale",
    label: "Scottsdale Sales",
    description: "Leads → Scottsdale | Sales → Manufacturing",
    journeyId: "retail",
  },
  {
    id: "solana",
    label: "Solana Beach",
    description: "Leads → Solana Beach | Sales → Manufacturing",
    journeyId: "trade",
  },
  {
    id: "trade",
    label: "Trade",
    description: "Trade → Solana Beach | Sales → Manufacturing",
    journeyId: "trade",
  },
  {
    id: "warranty",
    label: "Warranty",
    description: "Warranty Claims → Manufacturing",
    journeyId: "warranty",
  },
];

/** @deprecated */
export const ACTIVE_GHL_BY_JOURNEY: Record<string, string[]> = {
  retail: ["leads", "sales-az", "mfg"],
  trade: ["trade", "sales-ca", "mfg"],
  warranty: ["warranty", "mfg"],
  scottsdale: ["leads", "sales-az", "mfg"],
  solana: ["leads", "sales-ca", "mfg"],
};

/**
 * Strict middle-band card ids per Walkthrough (Blueprint §4).
 * Off-list cards MUST NOT mount.
 */
export const MIDDLE_VISIBLE_BY_WALKTHROUGH: Record<
  WalkthroughId,
  readonly string[]
> = {
  scottsdale: [
    "traffic-meta",
    "traffic-google",
    "chan-phone",
    "chan-email",
    "showroom-walkin",
    "lead-new",
    "lead-contacted-no-response",
    "lead-interested",
    "lead-nurture",
    "lead-website",
    "az-onsite",
    "az-sketchup-needed",
    "az-sketchup-done",
    "az-proposal",
    "az-finalize",
    "az-produce",
    "produce-az",
    "az-approval",
    "az-delivered",
    "field-survey",
    "mfg-new",
    "mfg-purchasing",
    "wc-chop-saw",
    "wc-tack",
    "qc-a",
    "wc-powder",
    "qc-b",
    "wc-final",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "reconciled",
    "postcare",
  ],
  solana: [
    "traffic-meta",
    "traffic-google",
    "chan-phone",
    "lead-new",
    "lead-interested",
    "ca-onsite",
    "ca-sketchup-needed",
    "ca-sketchup-done",
    "ca-proposal",
    "ca-finalize",
    "ca-produce",
    "produce-ca",
    "ca-approval",
    "ca-delivered",
    "field-survey",
    "mfg-new",
    "wc-chop-saw",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "postcare",
  ],
  trade: [
    "traffic-meta",
    "chan-phone",
    "trade-app",
    "trade-approved",
    "ca-onsite",
    "ca-sketchup-needed",
    "ca-sketchup-done",
    "ca-proposal",
    "ca-finalize",
    "ca-produce",
    "produce-ca",
    "ca-approval",
    "ca-delivered",
    "field-survey",
    "mfg-new",
    "wc-chop-saw",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "postcare",
  ],
  warranty: [
    "war-discovery",
    "war-paused",
    "war-file-claim",
    "war-claim-filed",
    "war-claim-approved",
    "war-selecting-colors",
    "war-produce-fo",
    "war-send-to-mfg",
    "produce-warranty",
    "war-claim-closed",
    "mfg-new",
    "wc-chop-saw",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "postcare",
  ],
};

export type RailStageCard = {
  stageId: string;
  label: string;
  pipelineId: string;
  pipelineLabel: string;
  accent: string;
  gate?: boolean;
};

export function railStagesForWalkthrough(
  id: WalkthroughId | null | undefined
): RailStageCard[] {
  if (!id) return [];
  const pipeIds = ACTIVE_GHL_BY_WALKTHROUGH[id] ?? [];
  const out: RailStageCard[] = [];
  for (const pid of pipeIds) {
    const pipe = GHL_PIPELINES.find((p) => p.id === pid);
    if (!pipe) continue;
    for (const stage of pipe.stages) {
      out.push({
        stageId: stage.id,
        label: stage.label,
        pipelineId: pipe.id,
        pipelineLabel: pipe.label,
        accent: pipe.accent,
        gate: stage.gate,
      });
    }
  }
  return out;
}

export function middleVisibleIdsForWalkthrough(
  id: WalkthroughId | null | undefined
): Set<string> | null {
  if (!id) return null;
  const list = MIDDLE_VISIBLE_BY_WALKTHROUGH[id];
  return list ? new Set(list) : null;
}

/** Central snake — middle human cards only */
export const LIFECYCLE_SNAKE_ORDER: Record<string, readonly string[]> = {
  scottsdale: [
    "traffic-meta",
    "traffic-google",
    "chan-phone",
    "chan-email",
    "showroom-walkin",
    "lead-new",
    "lead-interested",
    "lead-website",
    "az-onsite",
    "az-sketchup-needed",
    "field-survey",
    "az-sketchup-done",
    "az-proposal",
    "az-finalize",
    "az-produce",
    "produce-az",
    "az-approval",
    "mfg-new",
    "mfg-purchasing",
    "wc-chop-saw",
    "wc-tack",
    "qc-a",
    "wc-powder",
    "qc-b",
    "wc-final",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "az-delivered",
    "reconciled",
    "postcare",
  ],
  solana: [
    "traffic-meta",
    "traffic-google",
    "chan-phone",
    "lead-new",
    "lead-interested",
    "ca-onsite",
    "ca-sketchup-needed",
    "field-survey",
    "ca-sketchup-done",
    "ca-proposal",
    "ca-finalize",
    "ca-produce",
    "produce-ca",
    "ca-approval",
    "mfg-new",
    "wc-chop-saw",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "ca-delivered",
    "postcare",
  ],
  trade: [
    "traffic-meta",
    "chan-phone",
    "trade-app",
    "trade-approved",
    "ca-onsite",
    "ca-sketchup-needed",
    "field-survey",
    "ca-sketchup-done",
    "ca-proposal",
    "ca-finalize",
    "ca-produce",
    "produce-ca",
    "ca-approval",
    "mfg-new",
    "wc-chop-saw",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "ca-delivered",
    "postcare",
  ],
  warranty: [
    "war-discovery",
    "war-paused",
    "war-file-claim",
    "war-claim-filed",
    "war-claim-approved",
    "war-selecting-colors",
    "war-produce-fo",
    "produce-warranty",
    "war-send-to-mfg",
    "mfg-new",
    "wc-chop-saw",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "war-claim-closed",
    "postcare",
  ],
  retail: [
    "traffic-meta",
    "traffic-google",
    "chan-phone",
    "chan-email",
    "showroom-walkin",
    "lead-new",
    "lead-interested",
    "lead-website",
    "az-onsite",
    "az-sketchup-needed",
    "field-survey",
    "az-sketchup-done",
    "az-proposal",
    "az-finalize",
    "az-produce",
    "produce-az",
    "az-approval",
    "mfg-new",
    "mfg-purchasing",
    "wc-chop-saw",
    "wc-tack",
    "qc-a",
    "wc-powder",
    "qc-b",
    "wc-final",
    "qc-c",
    "mfg-ready",
    "dispatch-box",
    "delivery",
    "az-delivered",
    "reconciled",
    "postcare",
  ],
};

export function ghlChipId(stageId: string): string {
  return `ghlchip-${stageId}`;
}

const SOFTWARE_NODE_IDS = new Set([
  "ghl-hub",
  "sketchup",
  "sys-woo",
  "katana",
  "qbo",
  "clover",
  "payment-gateway",
  "qbo-deposit-link",
  "clover-showroom",
  "ingress",
  "redis",
  "postgres",
  "inngest",
]);

const GHL_LABEL_TO_CHIP = new Map<string, string>();
for (const pipe of GHL_PIPELINES) {
  for (const stage of pipe.stages) {
    GHL_LABEL_TO_CHIP.set(stage.label.toLowerCase(), ghlChipId(stage.id));
    GHL_LABEL_TO_CHIP.set(stage.id.toLowerCase(), ghlChipId(stage.id));
  }
}

/** Map a sequence ping string (label or id) to a live canvas node id. */
export function resolvePingTarget(
  raw: string,
  mountedIds?: Set<string>
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (mountedIds?.has(trimmed)) return trimmed;
  if (SOFTWARE_NODE_IDS.has(trimmed)) return trimmed;
  if (trimmed.startsWith("ghlchip-")) return trimmed;
  const chip = GHL_LABEL_TO_CHIP.get(trimmed.toLowerCase());
  if (chip) return chip;
  return mountedIds?.has(trimmed) ? trimmed : null;
}

/**
 * Human card → satellite targets.
 * Golden handoff: produce-* → katana + ingress (Blueprint §2).
 */
export const SATELLITE_TARGETS: Record<string, string[]> = {
  "lead-new": [ghlChipId("lead-new"), "ghl-hub"],
  "lead-contacted-no-response": [ghlChipId("lead-contacted-no-response")],
  "lead-interested": [ghlChipId("lead-interested")],
  "lead-nurture": [ghlChipId("lead-nurture")],
  "lead-website": [ghlChipId("lead-website")],
  "trade-app": [ghlChipId("trade-app"), "ghl-hub"],
  "trade-approved": [ghlChipId("trade-approved")],
  "az-onsite": [ghlChipId("az-onsite")],
  "az-sketchup-needed": [ghlChipId("az-sketchup-needed"), "sketchup"],
  "az-sketchup-done": [ghlChipId("az-sketchup-done")],
  "az-proposal": [ghlChipId("az-proposal")],
  "az-finalize": [ghlChipId("az-finalize")],
  "az-produce": [ghlChipId("az-produce"), "payment-gateway"],
  "produce-az": ["katana", "ingress"],
  "az-approval": [ghlChipId("az-approval"), "qbo"],
  "az-delivered": [ghlChipId("az-delivered")],
  "ca-onsite": [ghlChipId("ca-onsite")],
  "ca-sketchup-needed": [ghlChipId("ca-sketchup-needed"), "sketchup"],
  "ca-sketchup-done": [ghlChipId("ca-sketchup-done")],
  "ca-proposal": [ghlChipId("ca-proposal")],
  "ca-finalize": [ghlChipId("ca-finalize")],
  "ca-produce": [ghlChipId("ca-produce"), "payment-gateway"],
  "produce-ca": ["katana", "ingress"],
  "ca-approval": [ghlChipId("ca-approval"), "qbo"],
  "ca-delivered": [ghlChipId("ca-delivered")],
  "ca-lost": [ghlChipId("ca-lost")],
  "war-discovery": [ghlChipId("war-discovery")],
  "war-paused": [ghlChipId("war-paused")],
  "war-file-claim": [ghlChipId("war-file-claim")],
  "war-claim-filed": [ghlChipId("war-claim-filed")],
  "war-claim-approved": [ghlChipId("war-claim-approved")],
  "war-selecting-colors": [ghlChipId("war-selecting-colors")],
  "war-produce-fo": [ghlChipId("war-produce-fo")],
  "produce-warranty": ["katana", "ingress"],
  "war-send-to-mfg": [ghlChipId("war-send-to-mfg")],
  "war-claim-closed": [ghlChipId("war-claim-closed")],
  "mfg-new": [ghlChipId("mfg-new"), "katana"],
  "mfg-purchasing": [ghlChipId("mfg-purchasing")],
  "mfg-ready": [ghlChipId("mfg-ready")],
  "mfg-delivered": [ghlChipId("mfg-delivered")],
  delivery: ["qbo"],
  reconciled: ["clover", "qbo"],
};

export function stageIdFromGhlChip(nodeId: string): string | null {
  return nodeId.startsWith("ghlchip-") ? nodeId.slice("ghlchip-".length) : null;
}

export function activePipelinesForWalkthrough(
  id: string | null | undefined
): Set<string> {
  if (!id) return new Set();
  const list =
    ACTIVE_GHL_BY_WALKTHROUGH[id] ?? ACTIVE_GHL_BY_JOURNEY[id] ?? [];
  return new Set(list);
}

/** @deprecated */
export function activePipelinesForJourney(journeyId: string): Set<string> {
  return activePipelinesForWalkthrough(journeyId);
}

export function snakeOrderForWalkthrough(id: string): readonly string[] {
  return (
    LIFECYCLE_SNAKE_ORDER[id] ?? LIFECYCLE_SNAKE_ORDER.scottsdale ?? []
  );
}

/** @deprecated */
export function snakeOrderForJourney(journeyId: string): readonly string[] {
  if (journeyId === "retail") return LIFECYCLE_SNAKE_ORDER.scottsdale ?? [];
  return snakeOrderForWalkthrough(journeyId);
}
