import type { OperationalZone } from "../../schema/operationalTask";

/** Zone-aware card subtitles — replaces generic "Breaker" in the UI. */
export type ZoneCardLabels = {
  /** Subtitle on human (left-column) cards */
  cardKind: string;
  /** Zone header left column */
  humanColumn: string;
  /** Zone header right column */
  digitalColumn: string;
  /** Short zone title for panel chrome (avoids truncation) */
  shortTitle: string;
};

export const ZONE_CARD_LABELS: Record<OperationalZone, ZoneCardLabels> = {
  "Zone 0: Inbound Marketing": {
    cardKind: "Channel",
    humanColumn: "Channels · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z0 · Inbound Marketing",
  },
  "Zone 1: CRM / Inbound Triage": {
    cardKind: "Intake Step",
    humanColumn: "Intake · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z1 · CRM Triage",
  },
  "Zone 2: CRM Pipeline": {
    cardKind: "Pipeline Stage",
    humanColumn: "Stages · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z2 · CRM Pipeline",
  },
  "Zone 3: Showroom Sales (AZ/CA)": {
    cardKind: "Sales Stage",
    humanColumn: "Sales · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z3 · Showroom Sales",
  },
  "Zone 4: Design & Cut Lists": {
    cardKind: "Design Task",
    humanColumn: "Design · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z4 · Design & Cut Lists",
  },
  "Zone 5: Middleware Core": {
    cardKind: "Middleware Hop",
    humanColumn: "Hops · System",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z5 · Middleware Core",
  },
  "Zone 6: Factory Production & QA": {
    cardKind: "Work Center",
    humanColumn: "Work Centers · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z6 · Factory & QA",
  },
  "Zone 7: Logistics Dispatch": {
    cardKind: "Dispatch Step",
    humanColumn: "Dispatch · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z7 · Logistics",
  },
  "Zone 8: Treasury & Post-Care": {
    cardKind: "Finance Step",
    humanColumn: "Finance · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: "Z8 · Treasury",
  },
};

export function labelsForZone(zone?: string): ZoneCardLabels {
  if (zone && zone in ZONE_CARD_LABELS) {
    return ZONE_CARD_LABELS[zone as OperationalZone];
  }
  return {
    cardKind: "Step",
    humanColumn: "Steps · Human",
    digitalColumn: "Sockets · Digital",
    shortTitle: zone ?? "Zone",
  };
}

export type RoleBadge = "HUMAN" | "AUTO" | "GATEWAY" | "MILESTONE";

export function roleBadgeForNode(opts: {
  panelSlot?: "breaker" | "socket";
  nodeType?: "standard" | "gateway" | "milestone";
}): RoleBadge {
  if (opts.nodeType === "gateway") return "GATEWAY";
  if (opts.nodeType === "milestone") return "MILESTONE";
  if (opts.panelSlot === "socket") return "AUTO";
  return "HUMAN";
}

/** Tailwind classes for unified HUMAN / AUTO / GATEWAY / MILESTONE chips. */
export function roleBadgeClassName(badge: RoleBadge): string {
  switch (badge) {
    case "HUMAN":
      return "bg-emerald-500/15 text-emerald-300";
    case "AUTO":
      return "bg-cyan-500/15 text-cyan-300";
    case "GATEWAY":
      return "bg-amber-500/15 text-amber-200";
    case "MILESTONE":
      return "bg-violet-500/15 text-violet-200";
  }
}
