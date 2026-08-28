/**
 * Executive focus presets — zoom + optional playback subset so demos
 * avoid panning across all nine zone columns.
 */

export type FocusPresetId = "sales" | "factory" | "close" | "all";

export type FocusPreset = {
  id: FocusPresetId;
  label: string;
  description: string;
  /** Zone shell IDs (z0…z8) and key task nodes to fit into view */
  focusNodeIds: string[];
  /** Spine task IDs used when playing a subset journey (empty = full spine) */
  playTaskIds: string[];
};

export const FOCUS_PRESETS: Record<FocusPresetId, FocusPreset> = {
  all: {
    id: "all",
    label: "Full Map",
    description: "All zones",
    focusNodeIds: [],
    playTaskIds: [],
  },
  sales: {
    id: "sales",
    label: "Sales Story",
    description: "Marketing → CRM → Showroom (Z0–Z3)",
    focusNodeIds: [
      "z0",
      "z1",
      "z2",
      "z3",
      "ghl-hub",
      "lead-new",
      "az-onsite",
      "produce-az",
    ],
    playTaskIds: [
      "traffic-meta",
      "traffic-google",
      "chan-phone",
      "showroom-walkin",
      "ghl-hub",
      "lead-new",
      "lead-interested",
      "lead-website",
      "trade-app",
      "trade-approved",
      "az-onsite",
      "az-sketchup-needed",
      "az-sketchup-done",
      "az-proposal",
      "az-finalize",
      "az-produce",
      "produce-az",
    ],
  },
  factory: {
    id: "factory",
    label: "Factory Story",
    description: "Design → Middleware → Factory (Z4–Z6)",
    focusNodeIds: [
      "z4",
      "z5",
      "z6",
      "sketchup",
      "ingress",
      "katana",
      "wc-chop-saw",
      "qc-a",
    ],
    playTaskIds: [
      "field-survey",
      "sketchup",
      "cut-lists",
      "bom-packet",
      "payment-gateway",
      "produce-az",
      "ingress",
      "redis",
      "postgres",
      "inngest",
      "katana",
      "inventory-alloc",
      "wc-tube-stock",
      "wc-chop-saw",
      "wc-tack",
      "qc-a",
      "wc-powder",
      "qc-b",
      "wc-final",
      "qc-c",
      "mfg-ready",
    ],
  },
  close: {
    id: "close",
    label: "Close Story",
    description: "Logistics → Treasury (Z7–Z8)",
    focusNodeIds: [
      "z7",
      "z8",
      "dispatch-box",
      "delivery",
      "qbo",
      "clover",
      "reconciled",
      "postcare",
    ],
    playTaskIds: [
      "dispatch-box",
      "dispatch-willcall",
      "dispatch-3pl",
      "delivery",
      "qbo",
      "inv-waiting",
      "inv-paid",
      "clover",
      "reconciled",
      "postcare",
    ],
  },
};

export const FOCUS_PRESET_LIST: FocusPresetId[] = [
  "all",
  "sales",
  "factory",
  "close",
];
