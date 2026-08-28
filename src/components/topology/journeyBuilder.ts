/**
 * Dynamic combinatorial journey builder — constructs SequenceStep[] from user picks.
 * Ingest options = Zone 0 omnichannel channels (topology + Gantt WBS 1.1–1.10).
 */

import type { SequenceStep } from "./sequences";
import { RETAIL_SEQUENCE, TRADE_SEQUENCE, WARRANTY_SEQUENCE } from "./sequences";

/** Zone 0 ingest channels — drives snake travel prefix */
export type IngestionSource =
  | "meta"
  | "google"
  | "organic"
  | "phone"
  | "sms"
  | "whatsapp"
  | "webchat"
  | "social"
  | "email"
  | "walkin";

export type PipelineFunnel = "retail" | "trade" | "warranty";
export type SalesRegion = "az" | "ca";

export type JourneyBuilderConfig = {
  ingestion: IngestionSource;
  funnel: PipelineFunnel;
  region: SalesRegion;
};

export const INGESTION_OPTIONS: {
  id: IngestionSource;
  label: string;
  wbsCode: string;
  nodeId: string;
}[] = [
  { id: "meta", label: "Meta / Instagram Ads", wbsCode: "1.1", nodeId: "traffic-meta" },
  { id: "google", label: "Google Search / Max", wbsCode: "1.2", nodeId: "traffic-google" },
  { id: "organic", label: "SEO / Organic / Pinterest", wbsCode: "1.3", nodeId: "traffic-organic" },
  { id: "phone", label: "Inbound Phone / Voicemail", wbsCode: "1.4", nodeId: "chan-phone" },
  { id: "sms", label: "SMS / Text Messaging", wbsCode: "1.5", nodeId: "chan-sms" },
  { id: "whatsapp", label: "WhatsApp Business", wbsCode: "1.6", nodeId: "chan-whatsapp" },
  { id: "webchat", label: "Web Chat Widget", wbsCode: "1.7", nodeId: "chan-webchat" },
  { id: "social", label: "Social DMs (IG / Messenger)", wbsCode: "1.8", nodeId: "chan-social" },
  { id: "email", label: "Email Sequences", wbsCode: "1.9", nodeId: "chan-email" },
  {
    id: "walkin",
    label: "Showroom Walk-in / In-Person Visit",
    wbsCode: "1.10",
    nodeId: "showroom-walkin",
  },
];

export const FUNNEL_OPTIONS: { id: PipelineFunnel; label: string }[] = [
  { id: "retail", label: "Retail Leads" },
  { id: "trade", label: "B2B Trade" },
  { id: "warranty", label: "Warranty Claims" },
];

export const REGION_OPTIONS: { id: SalesRegion; label: string }[] = [
  { id: "az", label: "Scottsdale AZ" },
  { id: "ca", label: "Solana Beach CA" },
];

/** Manual intake bypasses Website Order Form */
const MANUAL_INTAKE: IngestionSource[] = ["phone", "sms", "whatsapp", "social"];

const INGESTION_PREFIX: Record<IngestionSource, SequenceStep[]> = {
  meta: [
    { nodeId: "traffic-meta", travelEdges: [], dwellMs: 2000 },
    { nodeId: "chan-webchat", travelEdges: ["e-ig-chat"] },
    { nodeId: "ghl-hub", travelEdges: ["e-chat-hub"] },
  ],
  google: [
    { nodeId: "traffic-google", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-google-hub"] },
  ],
  organic: [
    { nodeId: "traffic-organic", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-organic-hub"] },
  ],
  phone: [
    { nodeId: "chan-phone", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-phone-hub"] },
  ],
  sms: [
    { nodeId: "chan-sms", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-sms-hub"] },
  ],
  whatsapp: [
    { nodeId: "chan-whatsapp", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-wa-hub"] },
  ],
  webchat: [
    { nodeId: "chan-webchat", travelEdges: [], dwellMs: 1800 },
    { nodeId: "ghl-hub", travelEdges: ["e-chat-hub"] },
  ],
  social: [
    { nodeId: "chan-social", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-social-hub"] },
  ],
  email: [
    { nodeId: "chan-email", travelEdges: [], dwellMs: 2000 },
    { nodeId: "ghl-hub", travelEdges: ["e-email-hub"] },
  ],
  walkin: [
    { nodeId: "showroom-walkin", travelEdges: [], dwellMs: 2000 },
  ],
};

function sliceFrom(
  seq: SequenceStep[],
  startNodeId: string,
  startStageId?: string
): SequenceStep[] {
  const idx = seq.findIndex(
    (s) =>
      s.nodeId === startNodeId &&
      (startStageId ? s.stageId === startStageId : !s.stageId)
  );
  return idx >= 0 ? seq.slice(idx) : seq;
}

function chainSteps(parts: SequenceStep[][]): SequenceStep[] {
  const out: SequenceStep[] = [];
  for (const part of parts) {
    for (const step of part) {
      out.push({ ...step });
    }
  }
  return dedupeConsecutive(out);
}

function dedupeConsecutive(steps: SequenceStep[]): SequenceStep[] {
  return steps.filter((s, i) => {
    if (i === 0) return true;
    const p = steps[i - 1];
    return !(p.nodeId === s.nodeId && p.stageId === s.stageId);
  });
}

function applyIntakeRouting(
  steps: SequenceStep[],
  ingestion: IngestionSource
): SequenceStep[] {
  if (!MANUAL_INTAKE.includes(ingestion)) return steps;

  return steps
    .filter(
      (s) => !(s.nodeId === "leads-pipe" && s.stageId === "lead-website")
    )
    .map((s) => {
      if (s.nodeId === "sales-az" && s.stageId === "az-onsite") {
        return {
          ...s,
          travelEdges: (s.travelEdges ?? []).map((e) =>
            e === "e-leads-az" ? "e-leads-new-az" : e
          ),
        };
      }
      return s;
    });
}

/** Build custom happy-path sequence for Movie Mode / Task view */
export function buildCustomSequence(
  config: JourneyBuilderConfig
): SequenceStep[] {
  if (config.ingestion === "walkin") {
    /* Walk-in skips hub — lands on leads / sales */
    if (config.funnel === "warranty") {
      return chainSteps([
        INGESTION_PREFIX.walkin,
        sliceFrom(WARRANTY_SEQUENCE, "warranty-pipe", "warranty-discovery"),
      ]);
    }
    if (config.funnel === "trade" || config.region === "ca") {
      return chainSteps([
        INGESTION_PREFIX.walkin,
        sliceFrom(TRADE_SEQUENCE, "trade-pipe", "trade-app"),
      ]);
    }
    return chainSteps([
      [
        ...INGESTION_PREFIX.walkin,
        {
          nodeId: "leads-pipe",
          stageId: "lead-new",
          travelEdges: ["e-walkin-leads"],
        },
      ],
      applyIntakeRouting(
        sliceFrom(RETAIL_SEQUENCE, "leads-pipe", "lead-new"),
        config.ingestion
      ),
    ]);
  }

  if (config.funnel === "warranty") {
    return chainSteps([
      INGESTION_PREFIX[config.ingestion],
      sliceFrom(WARRANTY_SEQUENCE, "warranty-pipe", "warranty-discovery"),
    ]);
  }

  if (config.funnel === "trade" || config.region === "ca") {
    return chainSteps([
      INGESTION_PREFIX[config.ingestion],
      applyIntakeRouting(
        sliceFrom(TRADE_SEQUENCE, "trade-pipe", "trade-app"),
        config.ingestion
      ),
    ]);
  }

  return chainSteps([
    INGESTION_PREFIX[config.ingestion],
    applyIntakeRouting(
      sliceFrom(RETAIL_SEQUENCE, "leads-pipe", "lead-new"),
      config.ingestion
    ),
  ]);
}

export function describeCustomJourney(config: JourneyBuilderConfig): string {
  const ing = INGESTION_OPTIONS.find((o) => o.id === config.ingestion)?.label;
  const fun = FUNNEL_OPTIONS.find((o) => o.id === config.funnel)?.label;
  const reg = REGION_OPTIONS.find((o) => o.id === config.region)?.label;
  return `${ing} → ${fun} → ${reg}`;
}

export const DEFAULT_JOURNEY_BUILDER: JourneyBuilderConfig = {
  ingestion: "meta",
  funnel: "retail",
  region: "az",
};
