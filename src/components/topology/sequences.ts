import { AG_RETAIL_HAPPY_PATH } from '../../schema/agRetailSequence';
import { LIFECYCLE_EXEC_SEQUENCE } from "./lifecycleSequence";

/**
 * Hand-authored cinematic narratives — granular stage IDs, not parent boxes.
 * Bidirectional design loops are explicit steps (never getOutgoers).
 */

export type HappyJourneyId = "retail" | "trade" | "warranty";
export type ExceptionId =
  | "ncr"
  | "clover-miss"
  | "redis-failopen"
  | "gate-b-fail"
  | "qbo-mutex"
  | "gate-c-fail"
  | "ccr-race";
export type JourneyId = HappyJourneyId | ExceptionId;

export const HAPPY_JOURNEYS: HappyJourneyId[] = ["retail", "trade", "warranty"];
export const EXCEPTION_JOURNEYS: ExceptionId[] = [
  "ncr",
  "clover-miss",
  "redis-failopen",
  "gate-b-fail",
  "qbo-mutex",
  "gate-c-fail",
  "ccr-race",
];

export function isExceptionJourney(id: JourneyId): boolean {
  return (EXCEPTION_JOURNEYS as string[]).includes(id);
}

export type ExternalTrigger = {
  /** Slow secondary beams while origin stays lit */
  travelEdges: string[];
  targetNodeIds: string[];
  /** Default 4000 — deliberate API handoff */
  travelMs?: number;
  holdMs?: number;
};

export type SequenceStep = {
  /** React Flow parent / leaf node */
  nodeId: string;
  /** Red satellite ping targets for API/webhook triggers */
  pings?: string[];
  /** Pipeline micro-action (child button) — primary dock target when set */
  stageId?: string;
  /** Edges grown on approach (trail remains lit after) */
  travelEdges?: string[];
  /** Dwell on the micro-action (default HOLD_MS) */
  dwellMs?: number;
  /** Extra nodes lit during dwell (fan-out) */
  fanOutNodes?: string[];
  /** Async external handoff while origin stays illuminated */
  externalTrigger?: ExternalTrigger;
  /** Override story lookup (exception variants on shared stage IDs) */
  storyKey?: string;
  /** Rose treatment for failure / exception dwell */
  tone?: "happy" | "exception";
};

export const JOURNEY_LABELS: Record<JourneyId, string> = {
  retail: "Retail Journey (Cyan)",
  trade: "Trade Journey (Magenta)",
  warranty: "Warranty Journey (Amber)",
  ncr: "Exception · NCR Fail (Rose)",
  "clover-miss": "Exception · Clover Miss (Rose)",
  "redis-failopen": "Exception · Redis Fail-Open (Rose)",
  "gate-b-fail": "Exception · Gate B Fail (Rose)",
  "qbo-mutex": "Exception · QBO Mutex (Rose)",
  "gate-c-fail": "Exception · Gate C Fail (Rose)",
  "ccr-race": "Exception · CCR Race (Rose)",
};

export const JOURNEY_COLORS: Record<JourneyId, string> = {
  retail: "#22d3ee",
  trade: "#e879f9",
  warranty: "#fb923c",
  ncr: "#fb7185",
  "clover-miss": "#fb7185",
  "redis-failopen": "#fb7185",
  "gate-b-fail": "#fb7185",
  "qbo-mutex": "#fb7185",
  "gate-c-fail": "#fb7185",
  "ccr-race": "#fb7185",
};

export const TRAVEL_MS = 2200;
export const HOLD_MS = 2500;
/** Minimum cinematic dwell inside a node before the beam exits (SLA pause) */
export const DWELL_MIN_MS = 1500;
/** Slow return along the cascade back to the originating trigger */
export const RETURN_MS = 1600;
/** Grid Tie plug-in + feeder drop into the city */
export const FEEDER_MS = 900;
export const FADE_MS = 1200;
export const EXTERNAL_TRAVEL_MS = 4200;
export const EXTERNAL_HOLD_MS = 1800;
export const COMPLETE_FLASH_MS = 450;

/** Physical shop floor after chop saw — pods, QC interleave, mirror sync */
export const FACTORY_FLOOR_SEQUENCE: SequenceStep[] = [
  { nodeId: "work-centers", stageId: "wc-cart-parts", travelEdges: [], dwellMs: 2600 },
  {
    nodeId: "work-centers",
    stageId: "wc-tack",
    travelEdges: [],
    dwellMs: 2800,
    externalTrigger: {
      travelEdges: ["e-pod-mfg-production"],
      targetNodeIds: ["mfg-pipe"],
      travelMs: 3400,
      holdMs: 1800,
    },
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-production",
    travelEdges: [],
    dwellMs: 2600,
  },
  { nodeId: "work-centers", stageId: "wc-weld-out", travelEdges: [], dwellMs: 2600 },
  { nodeId: "work-centers", stageId: "wc-grinder", travelEdges: [], dwellMs: 2600 },
  {
    nodeId: "work-centers",
    stageId: "wc-marriage",
    travelEdges: ["e-outsourced-marriage"],
    fanOutNodes: ["outsourced-accessories"],
    dwellMs: 2600,
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-a",
    travelEdges: ["e-wc-qc"],
    dwellMs: 2400,
  },
  { nodeId: "work-centers", stageId: "wc-cart-blast", travelEdges: [], dwellMs: 2400 },
  { nodeId: "work-centers", stageId: "wc-sandblast", travelEdges: [], dwellMs: 2600 },
  { nodeId: "work-centers", stageId: "wc-powder", travelEdges: [], dwellMs: 2600 },
  { nodeId: "qc-gates", stageId: "qc-b", travelEdges: [], dwellMs: 2400 },
  { nodeId: "work-centers", stageId: "wc-upholstery", travelEdges: [], dwellMs: 2600 },
  { nodeId: "work-centers", stageId: "wc-final", travelEdges: [], dwellMs: 2600 },
  { nodeId: "qc-gates", stageId: "qc-c", travelEdges: [], dwellMs: 2600 },
];

/** Katana → allocation fork → backorder OR in-stock chop saw */
export const INVENTORY_FACTORY_ENTRY: SequenceStep[] = [
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-new",
    travelEdges: ["e-katana-mfg-new"],
    dwellMs: 2200,
  },
  {
    nodeId: "inventory-alloc",
    travelEdges: ["e-katana-alloc"],
    fanOutNodes: ["outsourced-accessories", "procurement-wait"],
    dwellMs: 2600,
  },
  {
    nodeId: "outsourced-accessories",
    travelEdges: ["e-alloc-outsourced"],
    dwellMs: 2400,
  },
  {
    nodeId: "procurement-wait",
    travelEdges: ["e-alloc-procure"],
    dwellMs: 4000,
  },
  {
    nodeId: "work-centers",
    stageId: "wc-tube-stock",
    travelEdges: ["e-procure-stock"],
    dwellMs: 2800,
    externalTrigger: {
      travelEdges: ["e-tube-mfg-purchasing", "e-procure-mfg-sync"],
      targetNodeIds: ["mfg-pipe"],
      travelMs: 3400,
      holdMs: 1800,
    },
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-purchasing",
    travelEdges: [],
    dwellMs: 2600,
  },
  {
    nodeId: "work-centers",
    stageId: "wc-chop-saw",
    travelEdges: ["e-alloc-chop"],
    dwellMs: 2600,
  },
];

/** Dual deposit → omnichannel gateway → Client Approval → Ingress */
export function depositToApprovalBlock(
  salesPipe: "sales-az" | "sales-ca",
  produceStage: string,
  approvalStage: string,
  depositQboEdge: string,
  depositCloverEdge: string,
  gatewayApprovalEdge: string,
  webhookEdges: string[],
  produceTrigger: string
): SequenceStep[] {
  return [
    {
      nodeId: salesPipe,
      stageId: produceStage,
      travelEdges: [],
      dwellMs: 3000,
    },
    {
      nodeId: "payment-gateway",
      travelEdges: [
        depositQboEdge,
        depositCloverEdge,
        "e-deposit-qbo-gateway",
        "e-deposit-clover-gateway",
      ],
      fanOutNodes: ["qbo-deposit-link", "clover-showroom"],
      dwellMs: 3200,
    },
    {
      nodeId: salesPipe,
      stageId: approvalStage,
      travelEdges: [gatewayApprovalEdge],
      dwellMs: 2800,
      externalTrigger: {
        travelEdges: webhookEdges,
        targetNodeIds: [produceTrigger, "ingress"],
        travelMs: 4500,
        holdMs: 2000,
      },
    },
  ];
}

export const MIDDLEWARE_TO_KATANA: SequenceStep[] = [
  {
    nodeId: "ingress",
    travelEdges: [],
    dwellMs: 2000,
    fanOutNodes: ["redis", "postgres"],
    externalTrigger: {
      travelEdges: ["e-ingress-redis", "e-ingress-pg"],
      targetNodeIds: ["redis", "postgres"],
      travelMs: 3600,
      holdMs: 1600,
    },
  },
  { nodeId: "inngest", travelEdges: ["e-pg-inngest"], dwellMs: 2200 },
  {
    nodeId: "katana",
    travelEdges: ["e-inngest-katana", "e-inngest-mfg"],
    fanOutNodes: ["mfg-pipe"],
    dwellMs: 2800,
  },
];

export const LOGISTICS_TREASURY_TAIL: SequenceStep[] = [
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-ready",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 2600,
  },
  {
    nodeId: "dispatch-routes",
    stageId: "dispatch-box",
    travelEdges: ["e-mfg-dispatch-box"],
    fanOutNodes: ["dispatch-routes"],
    dwellMs: 2400,
  },
  {
    nodeId: "dispatch-routes",
    stageId: "dispatch-3pl",
    travelEdges: ["e-mfg-dispatch-box-3pl"],
    dwellMs: 2200,
  },
  {
    nodeId: "dispatch-routes",
    stageId: "dispatch-willcall",
    travelEdges: ["e-mfg-dispatch-box-willcall"],
    dwellMs: 2200,
  },
  {
    nodeId: "delivery",
    travelEdges: [
      "e-dispatch-box-delivery",
      "e-dispatch-3pl-delivery",
      "e-dispatch-willcall-delivery",
    ],
    dwellMs: 2800,
    externalTrigger: {
      travelEdges: ["e-delivery-qbo"],
      targetNodeIds: ["qbo"],
      travelMs: 4800,
      holdMs: 2000,
    },
  },
  { nodeId: "qbo", travelEdges: [], dwellMs: 2400 },
  { nodeId: "clover", travelEdges: ["e-qbo-clover"], dwellMs: 2400 },
  { nodeId: "reconciled", travelEdges: ["e-clover-ok"], dwellMs: 2800 },
];

/** Scottsdale Sales (Retail AZ) */
export const RETAIL_AZ_SEQUENCE: SequenceStep[] = [
  { nodeId: "traffic-meta", pings: [] },
  { nodeId: "lead-website", pings: ["ghl-hub", "Website Order Form"] },
  { nodeId: "az-onsite", pings: ["01.D On-Site Scheduled"] },
  { nodeId: "az-sketchup-needed", pings: ["02.D Sketchup Needed", "sketchup"] },
  { nodeId: "az-produce", pings: ["06.D Produce Factory Order", "katana"] }, 
  { nodeId: "az-approval", pings: ["07.S Get Client Approval", "payment-gateway"] },
  { nodeId: "wc-chop-saw", pings: ["Production in Progress"] },
  { nodeId: "delivery", pings: ["08. Delivered", "qbo"] }
];

/** Solana Beach Sales (Retail CA) */
export const RETAIL_CA_SEQUENCE: SequenceStep[] = [
  { nodeId: "traffic-google", pings: [] },
  { nodeId: "lead-website", pings: ["ghl-hub", "Website Order Form"] },
  { nodeId: "ca-onsite", pings: ["01. On-Site Scheduled"] },
  { nodeId: "ca-sketchup-needed", pings: ["02. SketchUp Needed", "sketchup"] },
  { nodeId: "ca-produce", pings: ["06. Produce Factory Order", "katana"] }, 
  { nodeId: "ca-approval", pings: ["07. Get Client Approval", "payment-gateway"] },
  { nodeId: "wc-chop-saw", pings: ["Production in Progress"] },
  { nodeId: "delivery", pings: ["08. Delivered", "qbo"] }
];

/** Trade */
export const TRADE_SEQUENCE: SequenceStep[] = [
  { nodeId: "chan-phone", pings: ["ghl-hub"] },
  { nodeId: "trade-app", pings: ["Application Submitted"] },
  { nodeId: "trade-approved", pings: ["Approved"] },
  { nodeId: "ca-sketchup-needed", pings: ["02. SketchUp Needed", "sketchup"] },
  { nodeId: "ca-produce", pings: ["06. Produce Factory Order", "katana"] },
  { nodeId: "delivery", pings: ["08. Delivered", "qbo"] }
];

/** Warranty */
export const WARRANTY_SEQUENCE: SequenceStep[] = [
  { nodeId: "chan-whatsapp", pings: ["ghl-hub"] },
  { nodeId: "war-discovery", pings: ["Discovery"] },
  { nodeId: "war-file-claim", pings: ["File Claim"] },
  { nodeId: "war-produce-fo", pings: ["Produce FO", "katana"] },
  { nodeId: "wc-chop-saw", pings: ["Production in Progress"] },
  { nodeId: "delivery", pings: ["Claim Closed"] }
];

export const RETAIL_SEQUENCE: SequenceStep[] = RETAIL_AZ_SEQUENCE;

/** Board Brief — retail uses full AG 50-step path (no skipping) */
export const BOARD_RETAIL_SEQUENCE: SequenceStep[] = AG_RETAIL_HAPPY_PATH;

export const BOARD_TRADE_SEQUENCE: SequenceStep[] = [
  { nodeId: "chan-phone", travelEdges: [], dwellMs: 3200 },
  {
    nodeId: "ghl-hub",
    travelEdges: ["e-phone-hub"],
    dwellMs: 3500,
  },
  {
    nodeId: "trade-pipe",
    stageId: "trade-approved",
    travelEdges: ["e-hub-trade"],
    dwellMs: 3800,
  },
  {
    nodeId: "sales-ca",
    stageId: "ca-sketchup-needed",
    travelEdges: ["e-trade-ca"],
    dwellMs: 4000,
    externalTrigger: {
      travelEdges: ["e-ca-survey", "e-survey-sketchup"],
      targetNodeIds: ["field-survey", "sketchup"],
      travelMs: 4000,
      holdMs: 2000,
    },
  },
  {
    nodeId: "sales-ca",
    stageId: "ca-produce",
    travelEdges: ["e-bom-ca"],
    dwellMs: 3500,
  },
  {
    nodeId: "payment-gateway",
    travelEdges: [
      "e-ca-produce-deposit-qbo",
      "e-ca-produce-deposit-clover",
      "e-deposit-qbo-gateway",
      "e-deposit-clover-gateway",
    ],
    fanOutNodes: ["qbo-deposit-link", "clover-showroom"],
    dwellMs: 3500,
  },
  {
    nodeId: "sales-ca",
    stageId: "ca-approval",
    travelEdges: ["e-gateway-approval-ca"],
    dwellMs: 4000,
    externalTrigger: {
      travelEdges: ["e-ca-produce", "e-produce-ca-ingress"],
      targetNodeIds: ["produce-ca", "ingress"],
      travelMs: 4500,
      holdMs: 2200,
    },
  },
  {
    nodeId: "katana",
    travelEdges: [
      "e-ingress-pg",
      "e-pg-inngest",
      "e-inngest-katana",
      "e-inngest-mfg",
    ],
    fanOutNodes: ["work-centers", "mfg-pipe"],
    dwellMs: 4000,
  },
  {
    nodeId: "delivery",
    travelEdges: [
      "e-wc-qc",
      "e-qc-mfg",
      "e-mfg-dispatch-box",
      "e-dispatch-box-delivery",
    ],
    dwellMs: 4000,
    externalTrigger: {
      travelEdges: ["e-delivery-qbo"],
      targetNodeIds: ["qbo"],
      travelMs: 4800,
      holdMs: 2200,
    },
  },
  {
    nodeId: "clover",
    travelEdges: ["e-qbo-clover"],
    dwellMs: 3500,
  },
  {
    nodeId: "reconciled",
    travelEdges: ["e-clover-ok"],
    dwellMs: 3500,
  },
  {
    nodeId: "postcare",
    travelEdges: ["e-ok-postcare"],
    fanOutNodes: ["sales-ca"],
    dwellMs: 4000,
  },
];

export const BOARD_WARRANTY_SEQUENCE: SequenceStep[] = [
  { nodeId: "chan-whatsapp", travelEdges: [], dwellMs: 3200 },
  {
    nodeId: "ghl-hub",
    travelEdges: ["e-wa-hub"],
    dwellMs: 3500,
  },
  {
    nodeId: "warranty-pipe",
    stageId: "warranty-approved",
    travelEdges: ["e-hub-warranty"],
    dwellMs: 3800,
  },
  {
    nodeId: "warranty-pipe",
    stageId: "warranty-produce",
    travelEdges: [],
    dwellMs: 4500,
    externalTrigger: {
      travelEdges: ["e-warranty-produce", "e-produce-wr-ingress"],
      targetNodeIds: ["produce-warranty", "ingress"],
      travelMs: 4500,
      holdMs: 2200,
    },
  },
  {
    nodeId: "katana",
    travelEdges: ["e-ingress-pg", "e-pg-inngest", "e-inngest-katana", "e-inngest-mfg"],
    fanOutNodes: ["work-centers", "mfg-pipe"],
    dwellMs: 4000,
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-c",
    travelEdges: ["e-wc-qc"],
    dwellMs: 3500,
  },
  {
    nodeId: "delivery",
    travelEdges: ["e-qc-mfg", "e-mfg-dispatch-box", "e-dispatch-box-delivery"],
    dwellMs: 4000,
  },
  {
    nodeId: "warranty-pipe",
    stageId: "warranty-closed",
    travelEdges: ["e-delivery-postcare"],
    fanOutNodes: ["postcare"],
    dwellMs: 4000,
  },
];

/** Exception paths are already short — Board uses the same spine. */
export const NCR_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "katana",
    travelEdges: [],
    dwellMs: 2800,
  },
  {
    nodeId: "inventory-alloc",
    travelEdges: ["e-katana-alloc"],
    dwellMs: 2800,
  },
  {
    nodeId: "work-centers",
    stageId: "wc-weld-out",
    travelEdges: ["e-alloc-chop"],
    dwellMs: 3200,
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-a",
    travelEdges: ["e-wc-qc"],
    dwellMs: 4500,
    storyKey: "ncr-gate-a-fail",
    tone: "exception",
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-delivered",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 4000,
    storyKey: "ncr-rejected",
    tone: "exception",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-weld-out",
    travelEdges: [],
    dwellMs: 3800,
    storyKey: "ncr-rework",
    tone: "exception",
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-a",
    travelEdges: ["e-wc-qc"],
    dwellMs: 3500,
    storyKey: "ncr-gate-a-pass",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-powder",
    travelEdges: [],
    dwellMs: 3200,
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-ready",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 3500,
    storyKey: "ncr-cleared",
  },
];

export const CLOVER_MISS_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "delivery",
    travelEdges: [],
    dwellMs: 3200,
  },
  {
    nodeId: "qbo",
    travelEdges: ["e-delivery-qbo"],
    dwellMs: 4000,
    storyKey: "clover-miss-invoice",
  },
  {
    nodeId: "clover",
    travelEdges: ["e-qbo-clover"],
    dwellMs: 4800,
    storyKey: "clover-miss-dlq",
    tone: "exception",
  },
  {
    nodeId: "sales-az",
    stageId: "az-delivered",
    travelEdges: ["e-clover-ok"],
    fanOutNodes: ["reconciled"],
    dwellMs: 3800,
    storyKey: "clover-miss-delivered",
  },
  {
    nodeId: "postcare",
    travelEdges: ["e-ok-postcare"],
    dwellMs: 3500,
    storyKey: "clover-miss-postcare",
  },
];

export const REDIS_FAILOPEN_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "sales-az",
    stageId: "az-produce",
    travelEdges: [],
    dwellMs: 3500,
  },
  {
    nodeId: "ingress",
    travelEdges: ["e-az-produce", "e-produce-az-ingress"],
    dwellMs: 3200,
    fanOutNodes: ["produce-az"],
  },
  {
    nodeId: "redis",
    travelEdges: ["e-ingress-redis"],
    dwellMs: 4500,
    storyKey: "redis-failopen",
    tone: "exception",
  },
  {
    nodeId: "postgres",
    travelEdges: ["e-ingress-pg"],
    dwellMs: 4000,
    storyKey: "redis-failopen-outbox",
  },
  {
    nodeId: "inngest",
    travelEdges: ["e-pg-inngest"],
    dwellMs: 3500,
    storyKey: "redis-failopen-ccr",
  },
  {
    nodeId: "katana",
    travelEdges: ["e-inngest-katana", "e-inngest-mfg"],
    fanOutNodes: ["work-centers", "mfg-pipe"],
    dwellMs: 3800,
    storyKey: "redis-failopen-katana",
  },
];

/** Gate B — DFT/adhesion fail after powder; blast + recoat loop */
export const GATE_B_FAIL_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "work-centers",
    stageId: "wc-powder",
    travelEdges: [],
    dwellMs: 3200,
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-b",
    travelEdges: ["e-wc-qc"],
    dwellMs: 4500,
    storyKey: "gate-b-fail",
    tone: "exception",
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-delivered",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 4000,
    storyKey: "gate-b-rejected",
    tone: "exception",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-sandblast",
    travelEdges: [],
    dwellMs: 3800,
    storyKey: "gate-b-rework",
    tone: "exception",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-powder",
    travelEdges: [],
    dwellMs: 3600,
    storyKey: "gate-b-recoat",
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-b",
    travelEdges: ["e-wc-qc"],
    dwellMs: 3500,
    storyKey: "gate-b-pass",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-upholstery",
    travelEdges: [],
    dwellMs: 3200,
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-ready",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 3500,
    storyKey: "gate-b-cleared",
  },
];

/** QBO OAuth mutex — second invoice waits; retry succeeds; Clover still non-blocking */
export const QBO_MUTEX_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "delivery",
    travelEdges: [],
    dwellMs: 3200,
  },
  {
    nodeId: "qbo",
    travelEdges: ["e-delivery-qbo"],
    dwellMs: 4000,
    storyKey: "qbo-mutex-first",
  },
  {
    nodeId: "qbo",
    travelEdges: [],
    dwellMs: 5200,
    storyKey: "qbo-mutex-blocked",
    tone: "exception",
    fanOutNodes: ["delivery"],
  },
  {
    nodeId: "qbo",
    travelEdges: [],
    dwellMs: 3800,
    storyKey: "qbo-mutex-retry",
  },
  {
    nodeId: "clover",
    travelEdges: ["e-qbo-clover"],
    dwellMs: 3500,
  },
  {
    nodeId: "reconciled",
    travelEdges: ["e-clover-ok"],
    dwellMs: 3200,
  },
];

/** Gate C — fit/finish/photo miss at pre-pack; +2d rework penalty */
export const GATE_C_FAIL_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "work-centers",
    stageId: "wc-final",
    travelEdges: [],
    dwellMs: 3200,
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-c",
    travelEdges: ["e-wc-qc"],
    dwellMs: 4800,
    storyKey: "gate-c-fail",
    tone: "exception",
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-delivered",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 4200,
    storyKey: "gate-c-rejected",
    tone: "exception",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-upholstery",
    travelEdges: [],
    dwellMs: 4600,
    storyKey: "gate-c-rework",
    tone: "exception",
  },
  {
    nodeId: "work-centers",
    stageId: "wc-final",
    travelEdges: [],
    dwellMs: 3400,
    storyKey: "gate-c-reassembly",
  },
  {
    nodeId: "qc-gates",
    stageId: "qc-c",
    travelEdges: ["e-wc-qc"],
    dwellMs: 3800,
    storyKey: "gate-c-pass",
  },
  {
    nodeId: "mfg-pipe",
    stageId: "mfg-ready",
    travelEdges: ["e-qc-mfg"],
    dwellMs: 3600,
    storyKey: "gate-c-cleared",
  },
];

/** Inngest CCR — dual GHL webhook retry; one MO only */
export const CCR_RACE_SEQUENCE: SequenceStep[] = [
  {
    nodeId: "sales-az",
    stageId: "az-produce",
    travelEdges: [],
    dwellMs: 3500,
  },
  {
    nodeId: "ingress",
    travelEdges: ["e-az-produce", "e-produce-az-ingress"],
    dwellMs: 3800,
    fanOutNodes: ["produce-az"],
    storyKey: "ccr-dual-webhook",
    externalTrigger: {
      travelEdges: ["e-produce-az-ingress"],
      targetNodeIds: ["ingress", "produce-az"],
      travelMs: 4200,
      holdMs: 2000,
    },
  },
  {
    nodeId: "postgres",
    travelEdges: ["e-ingress-redis", "e-ingress-pg"],
    dwellMs: 4500,
    storyKey: "ccr-worker1-lease",
    fanOutNodes: ["redis"],
  },
  {
    nodeId: "ingress",
    travelEdges: [],
    dwellMs: 4800,
    storyKey: "ccr-webhook-retry",
    tone: "exception",
    fanOutNodes: ["produce-az"],
  },
  {
    nodeId: "postgres",
    travelEdges: ["e-ingress-pg"],
    dwellMs: 5200,
    storyKey: "ccr-worker2-violation",
    tone: "exception",
  },
  {
    nodeId: "inngest",
    travelEdges: ["e-pg-inngest"],
    dwellMs: 4000,
    storyKey: "ccr-worker1-inngest",
  },
  {
    nodeId: "katana",
    travelEdges: ["e-inngest-katana", "e-inngest-mfg"],
    fanOutNodes: ["work-centers", "mfg-pipe"],
    dwellMs: 4200,
    storyKey: "ccr-worker1-katana",
  },
  {
    nodeId: "postgres",
    travelEdges: [],
    dwellMs: 3800,
    storyKey: "ccr-worker2-yield",
  },
  {
    nodeId: "inngest",
    travelEdges: [],
    dwellMs: 3600,
    storyKey: "ccr-duplicate-resolve",
  },
];

export const SEQUENCES: Record<JourneyId, SequenceStep[]> = {
  retail: RETAIL_SEQUENCE,
  trade: TRADE_SEQUENCE,
  warranty: WARRANTY_SEQUENCE,
  ncr: NCR_SEQUENCE,
  "clover-miss": CLOVER_MISS_SEQUENCE,
  "redis-failopen": REDIS_FAILOPEN_SEQUENCE,
  "gate-b-fail": GATE_B_FAIL_SEQUENCE,
  "qbo-mutex": QBO_MUTEX_SEQUENCE,
  "gate-c-fail": GATE_C_FAIL_SEQUENCE,
  "ccr-race": CCR_RACE_SEQUENCE,
};

export const BOARD_SEQUENCES: Record<JourneyId, SequenceStep[]> = {
  retail: BOARD_RETAIL_SEQUENCE,
  trade: BOARD_TRADE_SEQUENCE,
  warranty: BOARD_WARRANTY_SEQUENCE,
  ncr: NCR_SEQUENCE,
  "clover-miss": CLOVER_MISS_SEQUENCE,
  "redis-failopen": REDIS_FAILOPEN_SEQUENCE,
  "gate-b-fail": GATE_B_FAIL_SEQUENCE,
  "qbo-mutex": QBO_MUTEX_SEQUENCE,
  "gate-c-fail": GATE_C_FAIL_SEQUENCE,
  "ccr-race": CCR_RACE_SEQUENCE,
};

export type SequenceMode = "board" | "full";

export function getActiveSequence(
  journeyId: JourneyId,
  mode: SequenceMode
): SequenceStep[] {
  if (
    journeyId === "retail" ||
    journeyId === "trade" ||
    journeyId === "warranty"
  ) {
    return LIFECYCLE_EXEC_SEQUENCE;
  }
  if (mode === "board") return BOARD_SEQUENCES[journeyId];
  return SEQUENCES[journeyId];
}

export function collectSpineIds(steps: SequenceStep[]): Set<string> {
  const ids = new Set<string>();
  for (const s of steps) {
    ids.add(s.nodeId);
    s.fanOutNodes?.forEach((id) => ids.add(id));
    s.externalTrigger?.targetNodeIds.forEach((id) => ids.add(id));
  }
  return ids;
}

/** Presenter jump bookmarks → step index in the active sequence */
export function findBookmarkIndex(
  steps: SequenceStep[],
  bookmark: "produce" | "delivered" | "postcare" | "exception"
): number {
  const matchers: Record<typeof bookmark, (s: SequenceStep) => boolean> = {
    produce: (s) =>
      s.stageId === "az-produce" ||
      s.stageId === "ca-produce" ||
      s.stageId === "warranty-produce",
    delivered: (s) => s.nodeId === "delivery",
    postcare: (s) =>
      s.nodeId === "postcare" || s.stageId === "warranty-closed",
    exception: (s) => s.tone === "exception",
  };
  const fn = matchers[bookmark];
  const idx = steps.findIndex(fn);
  return idx >= 0 ? idx : 0;
}
