/**
 * Dark Grid district theming + target-zone ignition colors.
 */

import { zoneOfNode } from "./utilityTypes";
import { ZONE_LAYOUTS } from "./zoneLayout";

/** Unpowered conduit — slate-800 */
export const DORMANT_STROKE = "#1e293b";
export const DORMANT_WIDTH = 2.25;
export const DORMANT_OPACITY = 0.85;

/**
 * Ignition / district accents by zone id.
 * Maps executive sketch: ingestion/sales→indigo, factory→amber,
 * treasury→emerald, middleware/API→cyan.
 */
export const ZONE_DISTRICT: Record<
  string,
  { accent: string; glow: string; label: string }
> = {
  z0: { accent: "#818cf8", glow: "rgba(129,140,248,0.65)", label: "Ingestion" },
  z1: { accent: "#6366f1", glow: "rgba(99,102,241,0.65)", label: "Routing" },
  z2: { accent: "#a78bfa", glow: "rgba(167,139,250,0.6)", label: "CRM" },
  z3: { accent: "#8b5cf6", glow: "rgba(139,92,246,0.65)", label: "Sales" },
  z4: { accent: "#c084fc", glow: "rgba(192,132,252,0.55)", label: "Design" },
  z5: { accent: "#22d3ee", glow: "rgba(34,211,238,0.65)", label: "Middleware" },
  z6: { accent: "#fbbf24", glow: "rgba(251,191,36,0.65)", label: "Factory" },
  z7: { accent: "#34d399", glow: "rgba(52,211,153,0.55)", label: "Logistics" },
  z8: { accent: "#10b981", glow: "rgba(16,185,129,0.65)", label: "Treasury" },
  "z-digital": {
    accent: "#3b82f6",
    glow: "rgba(59,130,246,0.65)",
    label: "Digital Ingress",
  },
  "z-mrp": {
    accent: "#10b981",
    glow: "rgba(16,185,129,0.65)",
    label: "MRP / Katana",
  },
  "z-shop": {
    accent: "#f59e0b",
    glow: "rgba(245,158,11,0.65)",
    label: "Shop Floor",
  },
};

const MIDDLEWARE_CYAN = {
  accent: "#22d3ee",
  glow: "rgba(34,211,238,0.65)",
  label: "API",
};

const MIDDLEWARE_IDS = new Set([
  "ingress",
  "redis",
  "postgres",
  "inngest",
  "katana",
  "inventory-alloc",
  "procurement-wait",
]);

export function districtForNode(nodeId: string): {
  accent: string;
  glow: string;
  label: string;
  zoneId: string | null;
} {
  const base = nodeId.includes("__") ? nodeId.split("__")[0]! : nodeId;
  if (MIDDLEWARE_IDS.has(base)) {
    return { ...MIDDLEWARE_CYAN, zoneId: zoneOfNode(base) };
  }
  const z = zoneOfNode(nodeId);
  if (z && ZONE_DISTRICT[z]) {
    return { ...ZONE_DISTRICT[z]!, zoneId: z };
  }
  return { accent: "#64748b", glow: "rgba(100,116,139,0.4)", label: "Grid", zoneId: z };
}

/** Active edge glow = destination district (anticipatory telegraph) */
export function ignitionForTarget(targetId: string): {
  stroke: string;
  glow: string;
} {
  const d = districtForNode(targetId);
  return { stroke: d.accent, glow: d.glow };
}

/** Inset from zone left wall — deep in left easement, clear of header text / nodes */
export const ZONE_DROP_SPINE_INSET = 10;

/** Left-side drop spine X for a destination zone (shared feeder cable) */
export function zoneDropSpineX(
  zoneId: string | null,
  fallbackX: number
): number {
  if (!zoneId) return fallbackX;
  const z = ZONE_LAYOUTS.find((l) => l.id === zoneId);
  if (!z) return fallbackX;
  return z.x + ZONE_DROP_SPINE_INSET;
}

/** @deprecated use zoneDropSpineX */
export function zoneDropX(zoneId: string | null, fallbackX: number): number {
  return zoneDropSpineX(zoneId, fallbackX);
}
