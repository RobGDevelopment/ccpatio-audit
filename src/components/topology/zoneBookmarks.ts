/**
 * Manual camera bookmarks — full map stays mounted; zoom is reversible.
 */

export type ZoneBookmarkId =
  | "omnichannel"
  | "sales"
  | "design"
  | "factory"
  | "logistics"
  | "treasury";

export type ZoneBookmark = {
  label: string;
  shortLabel: string;
  zoneId: string;
  focusNodeIds: string[];
};

export const ZONE_BOOKMARKS: Record<ZoneBookmarkId, ZoneBookmark> = {
  omnichannel: {
    label: "Omnichannel & Routing",
    shortLabel: "Omnichannel",
    zoneId: "z0",
    focusNodeIds: [
      "z0",
      "z1",
      "traffic-meta",
      "traffic-google",
      "traffic-organic",
      "chan-phone",
      "chan-sms",
      "chan-whatsapp",
      "chan-webchat",
      "chan-email",
      "chan-social",
      "ghl-hub",
      "leads-pipe",
      "trade-pipe",
      "warranty-pipe",
    ],
  },
  sales: {
    label: "Showroom Sales (AZ / CA)",
    shortLabel: "Sales",
    zoneId: "z2",
    focusNodeIds: [
      "z2",
      "z3",
      "sales-az",
      "sales-ca",
      "produce-az",
      "produce-ca",
      "produce-warranty",
      "field-survey",
      "sketchup",
      "cut-lists",
      "bom-packet",
    ],
  },
  design: {
    label: "Design / CAD",
    shortLabel: "Design",
    zoneId: "z3",
    focusNodeIds: [
      "z3",
      "field-survey",
      "sketchup",
      "cut-lists",
      "bom-packet",
    ],
  },
  factory: {
    label: "Factory / QC",
    shortLabel: "Factory",
    zoneId: "z5",
    focusNodeIds: [
      "z4",
      "z5",
      "ingress",
      "redis",
      "postgres",
      "inngest",
      "katana",
      "work-centers",
      "qc-gates",
      "mfg-pipe",
    ],
  },
  logistics: {
    label: "Logistics & Post-Care",
    shortLabel: "Logistics",
    zoneId: "z6",
    focusNodeIds: [
      "z6",
      "z8",
      "dispatch-routes",
      "delivery",
      "postcare",
      "qbo",
      "clover",
      "reconciled",
    ],
  },
  treasury: {
    label: "Treasury",
    shortLabel: "Treasury",
    zoneId: "z7",
    focusNodeIds: ["z7", "qbo", "clover", "reconciled", "delivery"],
  },
};

export const ZONE_BOOKMARK_LIST: ZoneBookmarkId[] = [
  "omnichannel",
  "sales",
  "design",
  "factory",
  "logistics",
  "treasury",
];
