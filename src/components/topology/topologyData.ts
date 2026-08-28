"use client";

import type { Edge, Node } from "@xyflow/react";
import type { BeamEdgeData } from "./BeamEdge";
import { buildGranularGraph } from "./granularGraph";
import { lookupRole } from "./roleConfig";
import type {
  PipelineNodeData,
  SystemNodeData,
} from "./nodes";
import {
  applyZoneCorridorShift,
  buildZoneNodes,
} from "./zoneLayout";

/* Zone shells from zoneLayout (separated cities). Master Trunk is math-only — no Grid Tie nodes. */

const SALES_AZ = [
  { id: "az-onsite", label: "01.D On-Site Scheduled" },
  { id: "az-sketchup-needed", label: "02.D SketchUp Needed ★" },
  { id: "az-sketchup-done", label: "03.S SketchUp Done" },
  { id: "az-proposal", label: "04.S Proposal Given" },
  { id: "az-finalize", label: "05.S Finalize Finishes" },
  { id: "az-produce", label: "06.D Produce FO ★" },
  { id: "az-approval", label: "07.S Client Approval" },
  { id: "az-delivered", label: "08. Delivered" },
].map((s) => ({
  ...s,
  role: lookupRole("sales-az", s.id) ?? undefined,
}));

const SALES_CA = [
  { id: "ca-onsite", label: "01.D On-Site Scheduled" },
  { id: "ca-sketchup-needed", label: "02.D SketchUp Needed ★" },
  { id: "ca-sketchup-done", label: "03.S SketchUp Done" },
  { id: "ca-proposal", label: "04.S Proposal Given" },
  { id: "ca-finalize", label: "05.S Finalize Finishes" },
  { id: "ca-produce", label: "06.D Produce FO ★" },
  { id: "ca-approval", label: "07.S Client Approval" },
  { id: "ca-delivered", label: "08. Delivered" },
].map((s) => ({
  ...s,
  role: lookupRole("sales-ca", s.id) ?? undefined,
}));

/** Physical shop floor — chop saw + 3-person fabrication pods (no CNC laser/bender) */
export const FACTORY_WORK_CENTER_STAGES = [
  { id: "wc-tube-stock", label: "01 Tube Metal Stock & Staging" },
  { id: "wc-chop-saw", label: "02 Chop Saw Cut & Miter Station" },
  { id: "wc-cart-parts", label: "03 Rolling Cart Parts Staging" },
  { id: "wc-tack", label: "4A Tack Welder Station" },
  { id: "wc-weld-out", label: "4B Weld Out Station" },
  { id: "wc-grinder", label: "4C Grinder Station" },
  { id: "wc-marriage", label: "05 Component Assembly & Marriage" },
  { id: "wc-cart-blast", label: "06 Cart Staging → Sandblast" },
  { id: "wc-sandblast", label: "07 Surface Prep & Sandblaster" },
  { id: "wc-powder", label: "08 Powder Coat & Curing Oven" },
  { id: "wc-upholstery", label: "09 Custom Upholstery & Sewing" },
  { id: "wc-final", label: "10 Final Assembly & Hardware" },
].map((s) => ({
  ...s,
  role: lookupRole("work-centers", s.id) ?? undefined,
})) as readonly {
  id: string;
  label: string;
  role?: NonNullable<ReturnType<typeof lookupRole>>;
}[];

function sys(
  id: string,
  x: number,
  y: number,
  label: string,
  subtitle: string,
  icon: string,
  accent: string,
  z: string
): Node {
  return {
    id,
    type: "system",
    position: { x, y },
    data: {
      label,
      subtitle,
      icon,
      accent,
      zone: z,
      role: lookupRole(id) ?? undefined,
    } satisfies SystemNodeData,
    style: { zIndex: 20, backgroundColor: "#020617" },
  };
}

const _buildingNodes: Node[] = [
  sys(
    "traffic-meta",
    -365,
    79,
    "Meta / Instagram Ads",
    "Paid social · IG / FB",
    "IG",
    "#22d3ee",
    "Traffic"
  ),
  sys(
    "traffic-google",
    -360,
    232,
    "Google Search / Max",
    "SEM · Shopping · gclid",
    "GO",
    "#67e8f9",
    "Traffic"
  ),
  sys(
    "traffic-organic",
    -371,
    385,
    "SEO / Organic / Pinterest",
    "Design showcase · organic",
    "OR",
    "#a5f3fc",
    "Traffic"
  ),

  /* Zone 0: Channels */
  sys(
    "chan-phone",
    -370,
    538,
    "Inbound Phone / Voicemail",
    "Twilio · GHL call routes",
    "PH",
    "#e879f9",
    "Channel"
  ),
  sys(
    "chan-sms",
    -363,
    691,
    "SMS / Text Messaging",
    "Two-way sequences",
    "TX",
    "#f0abfc",
    "Channel"
  ),
  sys(
    "chan-whatsapp",
    -361,
    844,
    "WhatsApp Business",
    "Service · warranty DMs",
    "WA",
    "#fb923c",
    "Channel"
  ),
  sys(
    "chan-webchat",
    -365,
    997,
    "Web Chat Widget",
    "ccpatio.com live chat",
    "CH",
    "#22d3ee",
    "Channel"
  ),
  sys(
    "chan-social",
    -380,
    1150,
    "Social DMs (IG / Messenger)",
    "Organic social inbox",
    "DM",
    "#38bdf8",
    "Channel"
  ),
  sys(
    "chan-email",
    -363,
    1303,
    "Email Sequences",
    "Inbound + nurture",
    "EM",
    "#94a3b8",
    "Channel"
  ),
  sys(
    "showroom-walkin",
    -368,
    1456,
    "Showroom Walk-in / In-Person Visit",
    "Front desk · physical intake",
    "WI",
    "#67e8f9",
    "Channel"
  ),

  /* Hub — Palantir-style aggregator */
  {
    id: "ghl-hub",
    type: "system",
    position: { x: 75, y: 455 },
    data: {
      label: "GHL Unified Inbox & Workflow Router",
      subtitle: "Tag · route · spawn Opportunity",
      icon: "◆",
      accent: "#67e8f9",
      zone: "Aggregator",
      role: lookupRole("ghl-hub") ?? undefined,
    } satisfies SystemNodeData,
  },

  /* ── CRM Pipelines ── */
  {
    id: "leads-pipe",
    type: "pipeline",
    position: { x: 430, y: 80 },
    data: {
      title: "Retail Leads Pipeline",
      subtitle: "→ Scottsdale Sales",
      accent: "#22d3ee",
      stages: [
        { id: "lead-new", label: "New | Uncontacted" },
        { id: "lead-website", label: "Website Order Form" },
      ],
    } satisfies PipelineNodeData,
  },
  {
    id: "trade-pipe",
    type: "pipeline",
    position: { x: 500, y: 332 },
    data: {
      title: "Commercial / Trade Pipeline",
      subtitle: "→ Solana Beach + Commercial tag",
      accent: "#e879f9",
      stages: [
        { id: "trade-app", label: "Application Submitted" },
        { id: "trade-approved", label: "Approved" },
        { id: "trade-declined", label: "Declined" },
      ],
    } satisfies PipelineNodeData,
  },
  {
    id: "warranty-pipe",
    type: "pipeline",
    position: { x: 565, y: 646 },
    data: {
      title: "Warranty Claims Pipeline",
      subtitle: "Produce FO ★ Gate 1",
      accent: "#fb923c",
      stages: [
        { id: "warranty-discovery", label: "Discovery → Approved" },
        { id: "warranty-approved", label: "Selecting Colors" },
        { id: "warranty-produce", label: "Produce FO ★" },
        { id: "warranty-closed", label: "Claim Closed" },
      ],
    } satisfies PipelineNodeData,
  },

  /* ── Parallel Sales ── */
  {
    id: "sales-az",
    type: "pipeline",
    position: { x: 935, y: 32 },
    data: {
      title: "GHL · Scottsdale | Sales",
      subtitle: "AZ showroom swimlane",
      accent: "#22d3ee",
      stages: SALES_AZ,
    } satisfies PipelineNodeData,
  },
  sys(
    "produce-az",
    1288,
    49,
    "AZ Produce + Won",
    "Automation gate",
    "G1",
    "#22d3ee",
    "Trigger"
  ),
  {
    id: "sales-ca",
    type: "pipeline",
    position: { x: 939, y: 806 },
    data: {
      title: "GHL · Solana Beach | Sales",
      subtitle: "CA showroom swimlane",
      accent: "#e879f9",
      stages: SALES_CA,
    } satisfies PipelineNodeData,
  },
  sys(
    "produce-ca",
    1237,
    653,
    "CA Produce + Won",
    "Automation gate",
    "G1",
    "#e879f9",
    "Trigger"
  ),
  sys(
    "produce-warranty",
    1283,
    870,
    "Warranty Produce FO",
    "Remake gate",
    "G1",
    "#fb923c",
    "Trigger"
  ),

  /* ── Design ── */
  sys(
    "field-survey",
    1608,
    137,
    "On-Site Lidar / Survey",
    "01.D field measure",
    "LS",
    "#c084fc",
    "Design"
  ),
  sys(
    "sketchup",
    1415,
    306,
    "SketchUp 3D Modeling",
    "02.D space planning",
    "SK",
    "#d8b4fe",
    "Design"
  ),
  sys(
    "cut-lists",
    1464,
    500,
    "Tube Cut Schedules",
    "Miter angles · chop saw traveler",
    "CL",
    "#a78bfa",
    "Cut Lists"
  ),
  sys(
    "bom-packet",
    1628,
    815,
    "BOM Assembly Packet",
    "SKU freeze · shop drawings",
    "BM",
    "#8b5cf6",
    "CAD/CAM"
  ),

  /* ── Dual-payment gateway (50% deposit) ── */
  sys(
    "qbo-deposit-link",
    1535,
    968,
    "QBO Payment Link",
    "50% deposit · emailed invoice",
    "Q$",
    "#34d399",
    "Deposit"
  ),
  sys(
    "clover-showroom",
    1616,
    1121,
    "Clover Showroom Terminal",
    "50% deposit · in-store swipe",
    "CV",
    "#2dd4bf",
    "Deposit"
  ),
  sys(
    "payment-gateway",
    1905,
    968,
    "Omnichannel Payment Gateway",
    "Deposit cleared → Client Approval",
    "PG",
    "#4ade80",
    "Gate 0.5"
  ),

  /* ── Middleware ── */
  sys(
    "ingress",
    1969,
    39,
    "Next.js Ingress API",
    "HMAC · anti-ghost queue",
    "NX",
    "#22d3ee",
    "Edge"
  ),
  sys(
    "redis",
    1736,
    290,
    "Upstash Redis L1",
    "15m TTL · fail-open",
    "RD",
    "#f43f5e",
    "Dedupe"
  ),
  sys(
    "postgres",
    1762,
    443,
    "Postgres Outbox & Saga",
    "frozen_sku · CCR claims",
    "PG",
    "#818cf8",
    "State"
  ),
  sys(
    "inngest",
    1866,
    662,
    "Inngest Stateful CCR",
    "Lease · sweeper · fan-out",
    "IN",
    "#a5b4fc",
    "Execution"
  ),
  sys(
    "katana",
    1947,
    815,
    "Katana MRP Bridge",
    "Idempotency-Key MO",
    "KT",
    "#fbbf24",
    "Factory API"
  ),

  /* ── Materials fork ── */
  sys(
    "inventory-alloc",
    2030,
    192,
    "Inventory Allocation Check",
    "In-stock vs backorder fork",
    "IA",
    "#fbbf24",
    "Materials"
  ),
  sys(
    "procurement-wait",
    2051,
    356,
    "Procurement Wait Loop",
    "Backordered · 10-day SLA buffer",
    "PW",
    "#f59e0b",
    "Purchasing"
  ),
  sys(
    "outsourced-accessories",
    2066,
    509,
    "Outsourced Accessories Hold",
    "Umbrellas · pool chairs · skip fab",
    "OS",
    "#d97706",
    "Bypass"
  ),

  /* ── Factory + QC + Mirror ── */
  {
    id: "work-centers",
    type: "pipeline",
    position: { x: 2427, y: 61 },
    data: {
      title: "Factory Work Centers",
      subtitle: "Chop saw · 3-man fabrication pods",
      accent: "#fbbf24",
      stages: [...FACTORY_WORK_CENTER_STAGES],
    } satisfies PipelineNodeData,
  },
  {
    id: "qc-gates",
    type: "pipeline",
    position: { x: 2417, y: 954 },
    data: {
      title: "QC Inspection Gates",
      subtitle: "NCR remake on fail",
      accent: "#f59e0b",
      stages: [
        { id: "qc-a", label: "Gate A Weld / Dim" },
        { id: "qc-b", label: "Gate B DFT / Adhesion" },
        { id: "qc-c", label: "Gate C Pre-Pack Photos" },
      ],
    } satisfies PipelineNodeData,
  },
  {
    id: "mfg-pipe",
    type: "pipeline",
    position: { x: 2428, y: 1268 },
    data: {
      title: "GHL Manufacturing Mirror",
      subtitle: "Katana bi-dir sync",
      accent: "#d97706",
      stages: [
        { id: "mfg-new", label: "New FO / New SO" },
        { id: "mfg-purchasing", label: "Purchasing / Receiving" },
        { id: "mfg-production", label: "Production in Progress" },
        { id: "mfg-ready", label: "Ready for Delivery" },
        { id: "mfg-delivered", label: "Delivered | Rejected" },
      ],
    } satisfies PipelineNodeData,
  },

  {
    id: "dispatch-routes",
    type: "pipeline",
    position: { x: 2841, y: 201 },
    data: {
      title: "3-Way Logistics Dispatch",
      subtitle: "Radius · freight · will-call",
      accent: "#34d399",
      stages: [
        { id: "dispatch-box", label: "CCPatio Box Truck (< 500 mi)" },
        { id: "dispatch-3pl", label: "3PL Freight Dispatch (> 500 mi)" },
        { id: "dispatch-willcall", label: "Customer Will-Call / Pickup" },
      ],
    } satisfies PipelineNodeData,
  },
  sys(
    "delivery",
    2854,
    734,
    "White-Glove Delivery",
    "Level · e-Sign · photos",
    "WG",
    "#6ee7b7",
    "Logistics"
  ),

  /* ── Treasury & Post-Care ── */
  sys(
    "qbo",
    3242,
    144,
    "QBO Final Invoice",
    "inv_${opportunity_id} · OAuth mutex",
    "QB",
    "#34d399",
    "Treasury"
  ),
  sys(
    "clover",
    3268,
    434,
    "Clover POS Matcher",
    "Fuzzy deposit recon",
    "CL",
    "#2dd4bf",
    "Treasury"
  ),
  sys(
    "reconciled",
    3274,
    772,
    "Terminal Reconciled",
    "08. Delivered · ledger",
    "OK",
    "#4ade80",
    "Terminal"
  ),
  sys(
    "postcare",
    3241,
    972,
    "NPS · Care · Warranty",
    "Day 0/3/7/30 · serial registry",
    "PC",
    "#86efac",
    "Lifecycle"
  ),
];

export const initialNodes: Node[] = applyZoneCorridorShift([
  ...buildZoneNodes(),
  ..._buildingNodes,
]);

const beam = { type: "trunkBus" as const };

export const initialEdges: Edge<BeamEdgeData>[] = [
  /* Ambient traffic → hub (visual mesh) */
  {
    id: "e-google-hub",
    source: "traffic-google",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Ads" },
  },
  {
    id: "e-organic-hub",
    source: "traffic-organic",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: {},
  },
  {
    id: "e-sms-hub",
    source: "chan-sms",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: {},
  },
  {
    id: "e-email-hub",
    source: "chan-email",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: {},
  },
  {
    id: "e-social-hub",
    source: "chan-social",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: {},
  },

  {
    id: "e-walkin-leads",
    source: "showroom-walkin",
    target: "leads-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Walk-in → New", lane: "retail", utility: "physical" },
  },

  /* Beam 1 retail */
  {
    id: "e-ig-chat",
    source: "traffic-meta",
    target: "chan-webchat",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "IG → Chat", lane: "retail" },
  },
  {
    id: "e-chat-hub",
    source: "chan-webchat",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Inbox", lane: "retail" },
  },
  {
    id: "e-hub-leads",
    source: "ghl-hub",
    target: "leads-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "retail_az", lane: "retail" },
  },

  /* Beam 2 trade */
  {
    id: "e-phone-hub",
    source: "chan-phone",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Call", lane: "trade" },
  },
  {
    id: "e-hub-trade",
    source: "ghl-hub",
    target: "trade-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "commercial", lane: "trade" },
  },

  /* Beam 3 warranty */
  {
    id: "e-wa-hub",
    source: "chan-whatsapp",
    target: "ghl-hub",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "WA", lane: "warranty" },
  },
  {
    id: "e-hub-warranty",
    source: "ghl-hub",
    target: "warranty-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "warranty", lane: "warranty" },
  },

  {
    id: "e-leads-az",
    source: "leads-pipe",
    target: "sales-az",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "→ AZ", lane: "retail" },
  },
  {
    id: "e-leads-new-az",
    source: "leads-pipe",
    target: "sales-az",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Manual → AZ", lane: "retail" },
  },
  {
    id: "e-trade-ca",
    source: "trade-pipe",
    target: "sales-ca",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "→ CA", lane: "trade" },
  },
  {
    id: "e-az-survey",
    source: "sales-az",
    target: "field-survey",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "01.D", lane: "retail" },
  },
  {
    id: "e-ca-survey",
    source: "sales-ca",
    target: "field-survey",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "01.D", lane: "trade" },
  },
  {
    id: "e-survey-sketchup",
    source: "field-survey",
    target: "sketchup",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "02.D" },
  },
  {
    id: "e-sketchup-cutlists",
    source: "sketchup",
    target: "cut-lists",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "Cut lists" },
  },
  {
    id: "e-cutlists-bom",
    source: "cut-lists",
    target: "bom-packet",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "BOM" },
  },
  {
    id: "e-bom-az",
    source: "bom-packet",
    target: "sales-az",
    sourceHandle: "left-src",
    targetHandle: "right-tgt",
    ...beam,
    data: { label: "→ Proposal", lane: "retail" },
  },
  {
    id: "e-bom-ca",
    source: "bom-packet",
    target: "sales-ca",
    sourceHandle: "left-src",
    targetHandle: "right-tgt",
    ...beam,
    data: { label: "→ Proposal", lane: "trade" },
  },
  {
    id: "e-az-produce-deposit-qbo",
    source: "sales-az",
    target: "qbo-deposit-link",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "50% email", lane: "retail" },
  },
  {
    id: "e-az-produce-deposit-clover",
    source: "sales-az",
    target: "clover-showroom",
    sourceHandle: "bottom",
    targetHandle: "left",
    ...beam,
    data: { label: "50% swipe", lane: "retail" },
  },
  {
    id: "e-ca-produce-deposit-qbo",
    source: "sales-ca",
    target: "qbo-deposit-link",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "50% email", lane: "trade" },
  },
  {
    id: "e-ca-produce-deposit-clover",
    source: "sales-ca",
    target: "clover-showroom",
    sourceHandle: "bottom",
    targetHandle: "left",
    ...beam,
    data: { label: "50% swipe", lane: "trade" },
  },
  {
    id: "e-deposit-qbo-gateway",
    source: "qbo-deposit-link",
    target: "payment-gateway",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "QBO cleared" },
  },
  {
    id: "e-deposit-clover-gateway",
    source: "clover-showroom",
    target: "payment-gateway",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Clover cleared" },
  },
  {
    id: "e-gateway-approval-az",
    source: "payment-gateway",
    target: "sales-az",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "→ 07.S Approval", lane: "retail" },
  },
  {
    id: "e-gateway-approval-ca",
    source: "payment-gateway",
    target: "sales-ca",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "→ 07.S Approval", lane: "trade" },
  },
  {
    id: "e-az-produce",
    source: "sales-az",
    target: "produce-az",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Gate 1", lane: "retail" },
  },
  {
    id: "e-ca-produce",
    source: "sales-ca",
    target: "produce-ca",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Gate 1", lane: "trade" },
  },
  {
    id: "e-warranty-produce",
    source: "warranty-pipe",
    target: "produce-warranty",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Gate 1", lane: "warranty" },
  },
  {
    id: "e-produce-az-ingress",
    source: "produce-az",
    target: "ingress",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Webhook", lane: "retail" },
  },
  {
    id: "e-produce-ca-ingress",
    source: "produce-ca",
    target: "ingress",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Webhook", lane: "trade" },
  },
  {
    id: "e-produce-wr-ingress",
    source: "produce-warranty",
    target: "ingress",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Webhook", lane: "warranty" },
  },
  {
    id: "e-ingress-redis",
    source: "ingress",
    target: "redis",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "L1", brief: true },
  },
  {
    id: "e-ingress-pg",
    source: "ingress",
    target: "postgres",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "Outbox" },
  },
  {
    id: "e-pg-inngest",
    source: "postgres",
    target: "inngest",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "CCR" },
  },
  {
    id: "e-inngest-katana",
    source: "inngest",
    target: "katana",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "mo_create" },
  },
  {
    id: "e-katana-alloc",
    source: "katana",
    target: "inventory-alloc",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Alloc check" },
  },
  {
    id: "e-alloc-chop",
    source: "inventory-alloc",
    target: "work-centers",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "In-stock → Chop Saw", lane: "retail" },
  },
  {
    id: "e-alloc-procure",
    source: "inventory-alloc",
    target: "procurement-wait",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "Backorder · 10d" },
  },
  {
    id: "e-procure-stock",
    source: "procurement-wait",
    target: "work-centers",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "→ Tube stock" },
  },
  {
    id: "e-alloc-outsourced",
    source: "inventory-alloc",
    target: "outsourced-accessories",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Outsourced bypass" },
  },
  {
    id: "e-outsourced-marriage",
    source: "outsourced-accessories",
    target: "work-centers",
    sourceHandle: "bottom",
    targetHandle: "left",
    ...beam,
    data: { label: "→ Marriage hold" },
  },
  {
    id: "e-inngest-mfg",
    source: "inngest",
    target: "mfg-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Mirror", cable: true, gridLevel: "trunk" },
  },
  {
    id: "e-wc-flow",
    source: "work-centers",
    target: "qc-gates",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    hidden: true,
    data: { brief: true, gridLevel: "local" },
  },
  {
    id: "e-wc-qc",
    source: "work-centers",
    target: "qc-gates",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "QC", gridLevel: "local" },
  },
  {
    id: "e-qc-mfg",
    source: "qc-gates",
    target: "mfg-pipe",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "Pass", gridLevel: "branch" },
  },
  {
    id: "e-katana-mfg-new",
    source: "katana",
    target: "mfg-pipe",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "New FO sync", cable: true, gridLevel: "trunk" },
  },
  {
    id: "e-procure-mfg-sync",
    source: "procurement-wait",
    target: "mfg-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Purchasing sync", cable: true, gridLevel: "trunk" },
  },
  {
    id: "e-tube-mfg-purchasing",
    source: "work-centers",
    target: "mfg-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: {
      label: "Purchasing / Receiving",
      cable: true,
      gridLevel: "branch",
    },
  },
  {
    id: "e-pod-mfg-production",
    source: "work-centers",
    target: "mfg-pipe",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: {
      label: "Production in Progress",
      cable: true,
      gridLevel: "branch",
    },
  },
  {
    id: "e-mfg-dispatch-box",
    source: "mfg-pipe",
    target: "dispatch-routes",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Box truck" },
  },
  {
    id: "e-mfg-dispatch-3pl",
    source: "mfg-pipe",
    target: "dispatch-routes",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "3PL freight" },
  },
  {
    id: "e-mfg-dispatch-willcall",
    source: "mfg-pipe",
    target: "dispatch-routes",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Will-call" },
  },
  {
    id: "e-dispatch-box-delivery",
    source: "dispatch-routes",
    target: "delivery",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Local delivery" },
  },
  {
    id: "e-dispatch-3pl-delivery",
    source: "dispatch-routes",
    target: "delivery",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "National freight" },
  },
  {
    id: "e-dispatch-willcall-delivery",
    source: "dispatch-routes",
    target: "delivery",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Pickup" },
  },
  {
    id: "e-delivery-qbo",
    source: "delivery",
    target: "qbo",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Delivered" },
  },
  {
    id: "e-qbo-clover",
    source: "qbo",
    target: "clover",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "Fuzzy" },
  },
  {
    id: "e-clover-ok",
    source: "clover",
    target: "reconciled",
    sourceHandle: "bottom",
    targetHandle: "top",
    ...beam,
    data: { label: "Close" },
  },
  {
    id: "e-ok-postcare",
    source: "reconciled",
    target: "postcare",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Lifecycle" },
  },
  {
    id: "e-delivery-postcare",
    source: "delivery",
    target: "postcare",
    sourceHandle: "right",
    targetHandle: "left",
    ...beam,
    data: { label: "Skip QBO", lane: "warranty" },
  },
];

const _granular = buildGranularGraph(initialNodes, initialEdges);
export const granularNodes = _granular.nodes;
export const granularEdges = _granular.edges;
