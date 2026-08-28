/**
 * Lead-source scenario paths — one buyer journey from inception → manufacturing.
 * Each scenario is a strict sequential node list (no brute-force edge trace).
 */

import { SATELLITE_TARGETS } from "./ghlPipelines";
import type { SequenceStep } from "./sequences";

export type LeadScenarioId = "meta-ad" | "inbound-phone" | "showroom-walkin";

export type LeadScenarioDef = {
  id: LeadScenarioId;
  label: string;
  description: string;
  accent: string;
  /** Canonical middle-band node ids (resolved to granular ids at runtime). */
  nodePath: string[];
};

export const LEAD_SCENARIO_OPTIONS: LeadScenarioDef[] = [
  {
    id: "meta-ad",
    label: "Meta / Instagram Ad",
    description:
      "Paid social click → GHL intake → lead nurture → Scottsdale on-site → factory order → production → delivery.",
    accent: "#22d3ee",
    nodePath: [
      "traffic-meta",
      "ghl-hub",
      "lead-new",
      "lead-interested",
      "az-onsite",
      "az-sketchup-needed",
      "az-produce",
      "mfg-production",
      "delivery",
    ],
  },
  {
    id: "inbound-phone",
    label: "Inbound Phone Call",
    description:
      "Voice / voicemail → CRM hub → qualified lead → on-site consult → design → manufacturing handoff.",
    accent: "#38bdf8",
    nodePath: [
      "chan-phone",
      "ghl-hub",
      "lead-new",
      "lead-interested",
      "az-onsite",
      "az-sketchup-needed",
      "az-produce",
      "mfg-production",
      "delivery",
    ],
  },
  {
    id: "showroom-walkin",
    label: "Showroom Walk-In",
    description:
      "In-person visit → new lead card → interested follow-up → on-site path through production.",
    accent: "#a78bfa",
    nodePath: [
      "showroom-walkin",
      "lead-new",
      "lead-interested",
      "az-onsite",
      "az-sketchup-needed",
      "az-produce",
      "mfg-production",
      "delivery",
    ],
  },
];

/** Granular dock ids used on the operational town canvas. */
const GRANULAR_ALIASES: Record<string, string[]> = {
  "lead-new": ["leads-pipe__lead-new"],
  "lead-interested": ["leads-pipe__lead-interested"],
  "lead-website": ["leads-pipe__lead-website"],
  "az-onsite": ["sales-az__az-onsite"],
  "az-sketchup-needed": ["sales-az__az-sketchup-needed"],
  "az-produce": ["sales-az__az-produce"],
  "mfg-production": ["mfg-pipe__mfg-production", "mfg-production"],
};

const SOFTWARE_NODE_IDS = new Set([
  "katana",
  "qbo",
  "sketchup",
  "ingress",
  "redis",
  "postgres",
  "inngest",
  "payment-gateway",
  "clover",
]);

export function resolveScenarioNodeId(
  rawId: string,
  mounted: Set<string>,
): string | null {
  if (mounted.has(rawId)) return rawId;
  for (const alias of GRANULAR_ALIASES[rawId] ?? []) {
    if (mounted.has(alias)) return alias;
  }
  return null;
}

export function buildScenarioNodePath(
  scenarioId: LeadScenarioId,
  mounted: Set<string>,
): string[] {
  const def = LEAD_SCENARIO_OPTIONS.find((s) => s.id === scenarioId);
  if (!def) return [];
  return def.nodePath
    .map((id) => resolveScenarioNodeId(id, mounted))
    .filter((id): id is string => Boolean(id));
}

export function buildScenarioSequenceSteps(
  scenarioId: LeadScenarioId,
  mounted: Set<string>,
): SequenceStep[] {
  const path = buildScenarioNodePath(scenarioId, mounted);
  return path.map((nodeId) => {
    const canonical = canonicalNodeId(nodeId);
    const pings = (SATELLITE_TARGETS[canonical] ?? []).filter((t) =>
      mounted.has(t),
    );
    return {
      nodeId,
      pings,
      dwellMs: scenarioStepDelayMs(path.indexOf(nodeId)),
    };
  });
}

/** Stagger between scenario steps — 800–1200ms. */
export function scenarioStepDelayMs(index: number): number {
  const base = 800 + (index % 3) * 200;
  return Math.min(1200, base);
}

export function scenarioTravelMs(): number {
  return 1100;
}

export function isGhlRailTarget(nodeId: string): boolean {
  return nodeId.startsWith("ghlchip-") || nodeId === "ghl-hub";
}

export function isSoftwareStackTarget(nodeId: string): boolean {
  return SOFTWARE_NODE_IDS.has(nodeId);
}

function canonicalNodeId(nodeId: string): string {
  const idx = nodeId.indexOf("__");
  if (idx === -1) return nodeId;
  return nodeId.slice(idx + 2);
}

export function scenarioSatelliteTargets(
  nodeId: string,
  mounted: Set<string>,
): { ghl: string[]; software: string[] } {
  const canonical = canonicalNodeId(nodeId);
  const raw = (SATELLITE_TARGETS[canonical] ?? []).filter((id) => mounted.has(id));
  return {
    ghl: raw.filter(isGhlRailTarget),
    software: raw.filter(isSoftwareStackTarget),
  };
}
