"use client";

import type { Edge, Node } from "@xyflow/react";
import type { BeamEdgeData } from "./BeamEdge";
import type { SystemNodeData, ZoneNodeData } from "./nodes";

/** Executive lifecycle zones — distinct color bands for presentations */
export const LIFECYCLE_ZONE_BANDS = [
  {
    id: "z-digital",
    label: "Zone 1 · Digital Ingress & Middleware (The Brain)",
    shortTitle: "Digital Ingress & Middleware",
    accent: "#3b82f6",
    glow: "rgba(59,130,246,0.55)",
  },
  {
    id: "z-mrp",
    label: "Zone 2 · MRP & Production Routing (Katana)",
    shortTitle: "MRP & Katana Routing",
    accent: "#10b981",
    glow: "rgba(16,185,129,0.55)",
  },
  {
    id: "z-shop",
    label: "Zone 3 · Shop Floor Operations (The Build)",
    shortTitle: "Shop Floor · The Build",
    accent: "#f59e0b",
    glow: "rgba(245,158,11,0.55)",
  },
] as const;

export type LifecycleNodeSpec = {
  id: string;
  step: number;
  label: string;
  subtitle: string;
  icon: string;
  zoneId: (typeof LIFECYCLE_ZONE_BANDS)[number]["id"];
  accent: string;
  x: number;
  y: number;
};

export const LIFECYCLE_NODES: LifecycleNodeSpec[] = [
  {
    id: "lc-ingress",
    step: 1,
    label: "Multi-Channel Ingress",
    subtitle: "WooCommerce & GoHighLevel webhooks",
    icon: "IN",
    zoneId: "z-digital",
    accent: "#60a5fa",
    x: 72,
    y: 268,
  },
  {
    id: "lc-hmac",
    step: 2,
    label: "Webhook Auth & Normalization",
    subtitle: "HMAC verification · payload canonicalization",
    icon: "HK",
    zoneId: "z-digital",
    accent: "#3b82f6",
    x: 292,
    y: 268,
  },
  {
    id: "lc-inngest",
    step: 3,
    label: "Inngest Background Queue",
    subtitle: "Event orchestration · idempotent workers",
    icon: "IQ",
    zoneId: "z-digital",
    accent: "#2563eb",
    x: 512,
    y: 268,
  },
  {
    id: "lc-pim",
    step: 4,
    label: "PIM Dictionary Validation",
    subtitle: "SKU matching via sku_mappings",
    icon: "PIM",
    zoneId: "z-digital",
    accent: "#1d4ed8",
    x: 732,
    y: 268,
  },
  {
    id: "lc-sales-order",
    step: 5,
    label: "Sales Order Generation",
    subtitle: "Katana SO from validated line items",
    icon: "SO",
    zoneId: "z-mrp",
    accent: "#34d399",
    x: 972,
    y: 268,
  },
  {
    id: "lc-bom",
    step: 6,
    label: "BOM Allocation",
    subtitle: "Fabrics · extrusions · consumables",
    icon: "BM",
    zoneId: "z-mrp",
    accent: "#10b981",
    x: 1192,
    y: 268,
  },
  {
    id: "lc-mo",
    step: 7,
    label: "Manufacturing Order (MO)",
    subtitle: "MO creation · routing & due dates",
    icon: "MO",
    zoneId: "z-mrp",
    accent: "#059669",
    x: 1412,
    y: 268,
  },
  {
    id: "lc-aluminum",
    step: 8,
    label: "Aluminum Fabrication",
    subtitle: "Cutting · zero-weld mechanical joinery",
    icon: "AL",
    zoneId: "z-shop",
    accent: "#fbbf24",
    x: 1652,
    y: 268,
  },
  {
    id: "lc-surface",
    step: 9,
    label: "Surface Treatment",
    subtitle: "Sublimation & powder coating",
    icon: "ST",
    zoneId: "z-shop",
    accent: "#f59e0b",
    x: 1872,
    y: 268,
  },
  {
    id: "lc-upholstery",
    step: 10,
    label: "Upholstery & Textiles",
    subtitle: "Cutting · sewing · cushion build",
    icon: "UP",
    zoneId: "z-shop",
    accent: "#d97706",
    x: 2092,
    y: 268,
  },
  {
    id: "lc-qa",
    step: 11,
    label: "Final Assembly & QA",
    subtitle: "Hardware · fit check · sign-off",
    icon: "QA",
    zoneId: "z-shop",
    accent: "#b45309",
    x: 2312,
    y: 268,
  },
  {
    id: "lc-logistics",
    step: 12,
    label: "Logistics & Treasury",
    subtitle: "Fulfillment · QBO invoice trigger",
    icon: "LG",
    zoneId: "z-shop",
    accent: "#92400e",
    x: 2532,
    y: 268,
  },
];

const ZONE_RECTS: Record<
  (typeof LIFECYCLE_ZONE_BANDS)[number]["id"],
  { x: number; y: number; width: number; height: number }
> = {
  "z-digital": { x: 24, y: 188, width: 900, height: 220 },
  "z-mrp": { x: 924, y: 188, width: 620, height: 220 },
  "z-shop": { x: 1544, y: 188, width: 1120, height: 220 },
};

function lifecycleZone(z: (typeof LIFECYCLE_ZONE_BANDS)[number]): Node {
  const rect = ZONE_RECTS[z.id];
  return {
    id: z.id,
    type: "zone",
    position: { x: rect.x, y: rect.y },
    data: {
      label: z.label,
      shortTitle: z.shortTitle,
      accent: z.accent,
      lifecycleZone: z.id,
    } satisfies ZoneNodeData & { lifecycleZone?: string },
    style: {
      zIndex: -1,
      width: rect.width,
      height: rect.height,
    },
    selectable: false,
    draggable: false,
  };
}

function lifecycleSystem(spec: LifecycleNodeSpec): Node {
  const band = LIFECYCLE_ZONE_BANDS.find((z) => z.id === spec.zoneId)!;
  return {
    id: spec.id,
    type: "system",
    position: { x: spec.x, y: spec.y },
    data: {
      label: spec.label,
      subtitle: spec.subtitle,
      icon: spec.icon,
      accent: spec.accent,
      zone: band.shortTitle,
      lifecycleZone: spec.zoneId,
      lifecycleStep: spec.step,
      cardKindLabel: `Step ${String(spec.step).padStart(2, "0")}`,
    } satisfies SystemNodeData & {
      lifecycleZone?: string;
      lifecycleStep?: number;
    },
    style: { zIndex: 20, backgroundColor: "#020617" },
  };
}

function lifecycleEdge(
  source: string,
  target: string,
  label: string,
): Edge {
  return {
    id: `e-lc-${source.replace("lc-", "")}-${target.replace("lc-", "")}`,
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "beam",
    data: {
      label,
      utility: "digital",
      gridLevel: "trunk",
    } satisfies BeamEdgeData,
  };
}

const sequentialPairs: [string, string, string][] = [
  ["lc-ingress", "lc-hmac", "Verify"],
  ["lc-hmac", "lc-inngest", "Enqueue"],
  ["lc-inngest", "lc-pim", "Validate"],
  ["lc-pim", "lc-sales-order", "Handoff"],
  ["lc-sales-order", "lc-bom", "Explode BOM"],
  ["lc-bom", "lc-mo", "Release MO"],
  ["lc-mo", "lc-aluminum", "WIP Start"],
  ["lc-aluminum", "lc-surface", "Coat"],
  ["lc-surface", "lc-upholstery", "Sew"],
  ["lc-upholstery", "lc-qa", "Inspect"],
  ["lc-qa", "lc-logistics", "Ship"],
];

export const lifecycleNodes: Node[] = [
  ...LIFECYCLE_ZONE_BANDS.map(lifecycleZone),
  ...LIFECYCLE_NODES.map(lifecycleSystem),
];

export const lifecycleEdges: Edge[] = sequentialPairs.map(([a, b, label]) =>
  lifecycleEdge(a, b, label),
);

/** Ordered node ids for Movie Mode spine validation */
export const LIFECYCLE_NODE_ORDER = LIFECYCLE_NODES.map((n) => n.id);
