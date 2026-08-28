/**
 * Enterprise WBS — hierarchical zones + parallel operational dependencies.
 * Source of truth: docs/Blueprint/GANTT_MASTER_SEQUENCE.md
 */

export type GanttZoneId =
  | "z0"
  | "z1"
  | "z2"
  | "z3"
  | "z4"
  | "z5"
  | "z6"
  | "z7"
  | "z8";

export const GANTT_ZONE_COLORS: Record<GanttZoneId, string> = {
  z0: "#818cf8",
  z1: "#6366f1",
  z2: "#a78bfa",
  z3: "#8b5cf6",
  z4: "#c084fc",
  z5: "#22d3ee",
  z6: "#fbbf24",
  z7: "#34d399",
  z8: "#10b981",
};

/** 1:1 with topology ZONE_BANDS (9 district boxes) */
export const GANTT_ZONE_PROJECTS: {
  zoneId: GanttZoneId;
  wbsCode: string;
  name: string;
  order: number;
}[] = [
  {
    zoneId: "z0",
    wbsCode: "1.0",
    name: "Zone 0 · Omnichannel Ingestion & Marketing",
    order: 1,
  },
  { zoneId: "z1", wbsCode: "2.0", name: "Zone 1 · Pipeline Routing", order: 2 },
  { zoneId: "z2", wbsCode: "3.0", name: "Zone 2 · CRM Pipelines", order: 3 },
  {
    zoneId: "z3",
    wbsCode: "4.0",
    name: "Zone 3 · Showroom Sales (Parallel)",
    order: 4,
  },
  {
    zoneId: "z4",
    wbsCode: "5.0",
    name: "Zone 4 · Design · Deposit · Cut Lists",
    order: 5,
  },
  {
    zoneId: "z5",
    wbsCode: "6.0",
    name: "Zone 5 · Middleware Core (V8)",
    order: 6,
  },
  {
    zoneId: "z6",
    wbsCode: "7.0",
    name: "Zone 6 · Factory Work Centers & QC",
    order: 7,
  },
  {
    zoneId: "z7",
    wbsCode: "8.0",
    name: "Zone 7 · Logistics Dispatch",
    order: 8,
  },
  {
    zoneId: "z8",
    wbsCode: "9.0",
    name: "Zone 8 · Treasury & Post-Care",
    order: 9,
  },
];

export type GanttMasterStep = {
  step: number;
  wbsCode: string;
  name: string;
  zoneId: GanttZoneId;
  zoneColor: string;
  role: string;
  nodeId: string;
  stageId?: string | null;
  type: "task" | "milestone";
  days: number;
  /** Step numbers this task waits on (FS). Empty = can start at project open. */
  dependsOnSteps: number[];
  note?: string;
};

function t(
  step: number,
  wbsCode: string,
  name: string,
  zoneId: GanttZoneId,
  role: string,
  nodeId: string,
  dependsOnSteps: number[],
  opts?: {
    stageId?: string | null;
    type?: "task" | "milestone";
    days?: number;
    note?: string;
  }
): GanttMasterStep {
  return {
    step,
    wbsCode,
    name,
    zoneId,
    zoneColor: GANTT_ZONE_COLORS[zoneId],
    role,
    nodeId,
    stageId: opts?.stageId ?? null,
    type: opts?.type ?? "task",
    days: opts?.days ?? 1,
    dependsOnSteps,
    note: opts?.note,
  };
}

/**
 * 56 operational touchpoints with true parallel tracks.
 * Frame track ∥ Upholstery → converge at Final Assembly.
 */
export const GANTT_MASTER_STEPS: GanttMasterStep[] = [
  /* ── 1.x Omnichannel (parallel intake) ── */
  t(1, "1.1", "Meta / Instagram Ads", "z0", "Marketing", "traffic-meta", []),
  t(2, "1.2", "Google Search / Max", "z0", "Marketing", "traffic-google", []),
  t(3, "1.3", "SEO / Organic / Pinterest", "z0", "Marketing", "traffic-organic", []),
  t(4, "1.4", "Inbound Phone / Voicemail", "z0", "Sales", "chan-phone", []),
  t(5, "1.5", "SMS / Text Messaging", "z0", "Sales", "chan-sms", []),
  t(6, "1.6", "WhatsApp Business", "z0", "Service", "chan-whatsapp", []),
  t(7, "1.7", "Web Chat Widget", "z0", "Sales", "chan-webchat", []),
  t(8, "1.8", "Social DMs (IG / Messenger)", "z0", "Social", "chan-social", []),
  t(9, "1.9", "Email Sequences", "z0", "Marketing", "chan-email", []),
  t(
    10,
    "1.10",
    "Showroom Walk-in / In-Person Visit",
    "z0",
    "Sales",
    "showroom-walkin",
    [],
    { note: "Routes to Zone 2", days: 1 }
  ),

  /* ── 2.x Routing ── */
  t(
    11,
    "2.1",
    "GHL Unified Inbox & Workflow Router",
    "z1",
    "System",
    "ghl-hub",
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    { days: 1 }
  ),

  /* ── 3.x CRM — retail / trade / warranty tracks ── */
  t(12, "3.1", "New | Uncontacted", "z2", "Retail Leads", "leads-pipe", [11], {
    stageId: "lead-new",
  }),
  t(13, "3.2", "Website Order Form", "z2", "Retail Leads", "leads-pipe", [12], {
    stageId: "lead-website",
    note: "Routes to Zone 3",
  }),
  t(14, "3.3", "Application Submitted", "z2", "Trade Pipeline", "trade-pipe", [11], {
    stageId: "trade-app",
  }),
  t(15, "3.4", "Approved", "z2", "Trade Pipeline", "trade-pipe", [14], {
    stageId: "trade-approved",
  }),
  t(16, "3.5", "Discovery", "z2", "Warranty Claims", "warranty-pipe", [11], {
    stageId: "war-discovery",
  }),
  t(17, "3.6", "Produce FO (Warranty)", "z2", "Warranty Claims", "warranty-pipe", [16], {
    stageId: "war-produce",
    note: "Gate 1 Bypass",
  }),

  /* ── 4.x Showroom Sales ── */
  t(18, "4.1", "01.D On-Site Scheduled", "z3", "Field", "sales-az", [13], {
    stageId: "az-onsite",
    days: 2,
  }),
  t(19, "4.2", "02.D SketchUp Needed", "z3", "Design", "sales-az", [18], {
    stageId: "az-sketchup-needed",
  }),
  t(20, "4.3", "03.S SketchUp Done", "z3", "Sales", "sales-az", [31], {
    stageId: "az-sketchup-done",
  }),
  t(21, "4.4", "04.S Proposal Given", "z3", "Sales", "sales-az", [20], {
    stageId: "az-proposal",
    days: 2,
  }),
  t(22, "4.5", "05.S Finalize Finishes", "z3", "Sales", "sales-az", [21], {
    stageId: "az-finalize",
    days: 2,
  }),
  t(23, "4.6", "06.D Produce FO", "z3", "Sales", "sales-az", [22, 33], {
    stageId: "az-produce",
    note: "GATE 1 TRIGGER",
  }),
  t(24, "4.7", "07.S Client Approval", "z3", "Sales", "sales-az", [23], {
    stageId: "az-approval",
    days: 2,
  }),
  t(25, "4.8", "08. Delivered", "z3", "Sales", "sales-az", [50], {
    stageId: "az-delivered",
  }),

  /* ── Zone 4 Design (5.x) ∥ Zone 5 Middleware (6.x) ── */
  t(26, "6.1", "Next.js Ingress API", "z5", "System", "ingress", [23]),
  t(27, "6.2", "Upstash Redis L1", "z5", "System", "redis", [26]),
  t(28, "6.3", "Postgres Outbox & Saga", "z5", "System", "postgres", [26]),
  t(29, "6.4", "Inngest Stateful CCR", "z5", "System", "inngest", [27, 28]),
  t(30, "6.5", "Katana MRP Bridge", "z5", "System", "katana", [29], { days: 2 }),
  t(31, "5.1", "SketchUp 3D Modeling", "z4", "Design", "sketchup", [19], {
    days: 5,
  }),
  t(32, "5.2", "Tube Cut Schedules", "z4", "Engineering", "cut-lists", [31], {
    days: 2,
  }),
  t(33, "5.3", "BOM Assembly Packet", "z4", "Engineering", "bom-packet", [32], {
    days: 2,
  }),

  /* ── 7.x Factory — Frame track ∥ Soft goods → Final Assembly ── */
  t(
    34,
    "7.1",
    "WO Kit Pull & Floor Staging",
    "z6",
    "Factory",
    "work-centers",
    [30, 33],
    { stageId: "wc-tube-stock", days: 1 }
  ),
  t(35, "7.2", "Chop Saw Cut & Miter Station", "z6", "Factory", "work-centers", [34], {
    stageId: "wc-chop-saw",
    days: 3,
  }),
  t(36, "7.3", "Rolling Cart Parts Staging", "z6", "Factory", "work-centers", [35], {
    stageId: "wc-cart-parts",
  }),
  t(37, "7.4", "Tack Welder Station", "z6", "Factory", "work-centers", [36], {
    stageId: "wc-tack",
    days: 2,
  }),
  t(38, "7.5", "Weld Out Station", "z6", "Factory", "work-centers", [37], {
    stageId: "wc-weld-out",
    days: 2,
  }),
  t(39, "7.6", "Grinder Station", "z6", "Factory", "work-centers", [38], {
    stageId: "wc-grinder",
  }),
  t(
    40,
    "7.7",
    "Frame Component Assembly",
    "z6",
    "Factory",
    "work-centers",
    [39],
    { stageId: "wc-marriage", days: 1 }
  ),
  t(41, "7.8", "QC Gate A: Weld / Dim", "z6", "Milestone", "qc-gates", [40], {
    stageId: "qc-a",
    type: "milestone",
  }),
  t(42, "7.9", "Cart Staging — Sandblast", "z6", "Factory", "work-centers", [41], {
    stageId: "wc-cart-blast",
  }),
  t(43, "7.10", "Surface Prep & Sandblaster", "z6", "Factory", "work-centers", [42], {
    stageId: "wc-sandblast",
    days: 2,
  }),
  t(44, "7.11", "Powder Coat & Curing Oven", "z6", "Factory", "work-centers", [43], {
    stageId: "wc-powder",
    days: 3,
  }),
  t(45, "7.12", "QC Gate B: DFT / Adhesion", "z6", "Milestone", "qc-gates", [44], {
    stageId: "qc-b",
    type: "milestone",
  }),
  t(
    46,
    "7.13",
    "Custom Upholstery & Sewing",
    "z6",
    "Factory",
    "work-centers",
    [34],
    { stageId: "wc-upholstery", days: 16, note: "∥ Weld Out & Powder Coat" }
  ),
  t(
    47,
    "7.14",
    "Final Assembly & Hardware Marriage",
    "z6",
    "Factory",
    "work-centers",
    [45, 46],
    { stageId: "wc-final", days: 2 }
  ),
  t(48, "7.15", "QC Gate C: Pre-Pack Photos", "z6", "Milestone", "qc-gates", [47], {
    stageId: "qc-c",
    type: "milestone",
  }),

  /* ── 8.x Logistics ── */
  t(49, "8.1", "CCPatio Box Truck", "z7", "Logistics", "dispatch-routes", [48], {
    stageId: "dispatch-box",
    days: 2,
  }),
  t(50, "8.2", "White-Glove Delivery", "z7", "Logistics", "delivery", [49], {
    days: 5,
  }),
  t(
    51,
    "8.3",
    "Customer Will-Call / Pickup",
    "z7",
    "Logistics",
    "dispatch-routes",
    [48],
    { stageId: "dispatch-willcall", days: 1 }
  ),
  t(52, "8.4", "3PL Freight Dispatch", "z7", "Logistics", "dispatch-routes", [48], {
    stageId: "dispatch-3pl",
    days: 3,
  }),

  /* ── 9.x Treasury ── */
  t(53, "9.1", "QBO Final Invoice", "z8", "Finance", "qbo", [50]),
  t(54, "9.2", "Clover POS Matcher", "z8", "Finance", "clover", [53]),
  t(55, "9.3", "Terminal Reconciled", "z8", "Finance", "reconciled", [54], {
    note: "GATE 2 TRIGGER",
  }),
  t(
    56,
    "9.4",
    "NPS / Care / Warranty Registry",
    "z8",
    "Customer Success",
    "postcare",
    [55],
    { note: "END OF SNAKE" }
  ),
];

if (GANTT_MASTER_STEPS.length !== 56) {
  throw new Error(
    `GANTT_MASTER_STEPS must be 56, got ${GANTT_MASTER_STEPS.length}`
  );
}

export function ganttBarStyles(
  zoneColor: string,
  type: "task" | "milestone" | "project"
) {
  if (type === "milestone") {
    return {
      backgroundColor: zoneColor,
      backgroundSelectedColor: zoneColor,
      progressColor: zoneColor,
      progressSelectedColor: zoneColor,
    };
  }
  if (type === "project") {
    return {
      backgroundColor: `${zoneColor}88`,
      backgroundSelectedColor: zoneColor,
      progressColor: zoneColor,
      progressSelectedColor: zoneColor,
    };
  }
  return {
    backgroundColor: `${zoneColor}cc`,
    backgroundSelectedColor: zoneColor,
    progressColor: zoneColor,
    progressSelectedColor: "#f8fafc",
  };
}

/** Parent zone project id for a zone (within an MO prefix) */
export function zoneProjectId(moPrefix: string, zoneId: GanttZoneId): string {
  return `${moPrefix}-zone-${zoneId}`;
}
