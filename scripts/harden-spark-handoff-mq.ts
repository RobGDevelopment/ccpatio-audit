/**
 * Canonical optimizer for the sole vendor handoff workbook:
 *   docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx
 *
 * Rebuilds the Q&A control panel as a PrimeView-scrapable relational config:
 * - System_Variable_Key (uppercase snake_case) beside ID
 * - Locked dropdowns on Management Selected Option (helper-sheet lists)
 * - WooCommerce checkout logic rows (payment / tax / shipping / cancellation)
 * - Tab 03 upcharges hard-linked via XLOOKUP(System_Variable_Key)
 * - Tab 01 MSRP + derived prices via XLOOKUP
 * - Tab 07 VW Asset column yellow + locked VW instruction row
 * - Monsoon/storage copy moved off Q&A into Tab 01 ottoman marketing text
 *
 * Usage:
 *   npm run ecom:harden-spark
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dektonDefaultsForId } from "./lib/dekton-tab02-defaults";
import { hexPreviewForInternalId } from "./lib/material-hex-preview";
import { isVendorSafeMaterialId } from "./lib/sellable-powders";

export const SPARK_HANDOFF_XLSX = path.resolve(
  process.cwd(),
  "docs/Vividworks/Handoff/Spark_Generated/Vividworks_Primeview E-Commerce Handoff (Spark).xlsx",
);

const QA = "Q&A";
const QA_OPTIONS = "_QA_OPTIONS";
const TAB01 = "01 - PHASE 1 & 2 PRODUCTS";
const TAB02 = "02 - WEB FABRICS & FINISHES";
const TAB03 = "03 - UPCHARGE MATRIX";
const TAB07 = "07 - VW ASSET BINDINGS";
const TAB08 = "08 - HANDOFF CHECKLIST";

const YELLOW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF111827" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
  name: "Calibri",
};
const LOCK_NOTE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF3CD" },
};

type QaOption = { label: string; value: number };

export const OTHER_OPTION_LABEL = "Other (specify in Other_Value)";

export function yesNoOptions(defaultYes = true): QaOption[] {
  return defaultYes
    ? [
        { label: "Yes [Default]", value: 1 },
        { label: "No", value: 0 },
      ]
    : [
        { label: "Yes", value: 1 },
        { label: "No [Default]", value: 0 },
      ];
}

export function withOtherOption(options: QaOption[], allowOther = true): QaOption[] {
  if (!allowOther) return options;
  if (options.some((o) => o.label === OTHER_OPTION_LABEL)) return options;
  return [...options, { label: OTHER_OPTION_LABEL, value: 0 }];
}

export type QaQuestion = {
  id: string;
  systemKey: string;
  category: string;
  topic: string;
  clarifying: string;
  selected: string;
  options: QaOption[];
  impact: string;
};

/** Canonical Q&A catalog — logic / math / routing only (no marketing prose). */
export const QA_QUESTIONS: QaQuestion[] = [
  {
    id: "Q01",
    systemKey: "MSRP_MARKUP_MULT",
    category: "Pricing Strategy",
    topic: "MSRP Aluminum Markup Multiplier",
    clarifying:
      "What markup multiplier should apply to Web Base Price to establish MSRP Aluminum across all products?",
    selected: "MSRP Multiplier 1.15x (baseline)",
    options: [
      { label: "MSRP Multiplier 1.15x (baseline)", value: 1.15 },
      { label: "MSRP Multiplier 1.20x", value: 1.2 },
      { label: "MSRP Multiplier 1.25x", value: 1.25 },
      { label: "MSRP Multiplier 1.10x", value: 1.1 },
    ],
    impact: "Drives Tab 01 Column F (MSRP Aluminum) via XLOOKUP(MSRP_MARKUP_MULT).",
  },
  {
    id: "Q02",
    systemKey: "BROOKLYN_BRAVADA_PARITY",
    category: "Seating Architecture",
    topic: "Brooklyn vs Bravada Seating Parity",
    clarifying:
      "Should Brooklyn seating maintain exact 1:1 price parity with Bravada, or carry a design adjustment?",
    selected: "100% Parity (1.00x Bravada) [Approved by Management]",
    options: [
      { label: "100% Parity (1.00x Bravada) [Approved by Management]", value: 1 },
      { label: "5% Design Discount (0.95x Bravada)", value: 0.95 },
      { label: "5% Architectural Premium (1.05x Bravada)", value: 1.05 },
    ],
    impact: "Multiplies Bravada peer Web Base for Brooklyn sofas/corners on Tab 01.",
  },
  {
    id: "Q03A",
    systemKey: "FIRE_INCLUDE_BURNER",
    category: "Fire Tables",
    topic: "Include Commercial Burner Kit (65,000 BTU + Electronic Ignition)",
    clarifying:
      "Should the commercial burner kit be included in fire table Web Base Price? No deducts $850.",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Tab 01 fire table Web Base: deduct $850 when No (0).",
  },
  {
    id: "Q03B",
    systemKey: "FIRE_INCLUDE_GLASS",
    category: "Fire Tables",
    topic: "Include Glass Wind Guard",
    clarifying: "Should the glass wind guard be included in fire table Web Base Price? No deducts $200.",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Tab 01 fire table Web Base: deduct $200 when No (0).",
  },
  {
    id: "Q03C",
    systemKey: "FIRE_INCLUDE_MEDIA",
    category: "Fire Tables",
    topic: "Include Lava / Fire Glass Media",
    clarifying: "Should fire glass / lava media be included in fire table Web Base Price? No deducts $150.",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Tab 01 fire table Web Base: deduct $150 when No (0).",
  },
  {
    id: "Q04",
    systemKey: "WATERFALL_MITER_PREMIUM",
    category: "Stone Fabrication",
    topic: "Waterfall Dekton Table Miter Premium",
    clarifying:
      "What premium factor applies to Waterfall tables to cover dual vertical miter cuts and epoxy lamination?",
    selected: "22% Miter Premium (1.22x Base Table) [Approved by Management]",
    options: [
      { label: "22% Miter Premium (1.22x Base Table) [Approved by Management]", value: 1.22 },
      { label: "15% Volume Fabrication (1.15x Base Table)", value: 1.15 },
      { label: "30% Custom Artisan Miter (1.30x Base Table)", value: 1.3 },
    ],
    impact: "Multiplies Brooklyn perimeter table base for Waterfall rows on Tab 01.",
  },
  {
    id: "Q05",
    systemKey: "FLAT_RATE_LOCAL_WHITE_GLOVE",
    category: "Logistics & Delivery",
    topic: "Phoenix Metro Local White-Glove Flat Rate",
    clarifying:
      "What flat rate should apply for local white-glove direct delivery within Maricopa County / Phoenix / Scottsdale?",
    selected: "$150.00 Flat Rate (Maricopa County) [Approved by Management]",
    options: [
      { label: "$150.00 Flat Rate (Maricopa County) [Approved by Management]", value: 150 },
      { label: "$125.00 Promotional Rate", value: 125 },
      { label: "$175.00 Standard Local Rate", value: 175 },
      { label: "$195.00 Heavy/Multi-Piece Rate", value: 195 },
    ],
    impact: "Tab 03 Local White-Glove Delivery upcharge via XLOOKUP.",
  },
  {
    id: "Q06",
    systemKey: "FLAT_RATE_REGIONAL_500MI",
    category: "Logistics & Delivery",
    topic: "500-Mile Regional Direct Delivery Tier",
    clarifying:
      "What flat rate should apply for CC Patio dedicated fleet direct delivery within a 500-mile radius of Phoenix?",
    selected: "$495.00 Regional Fleet Rate (AZ/NV/SoCal/NM) [Approved by Management]",
    options: [
      { label: "$495.00 Regional Fleet Rate (AZ/NV/SoCal/NM) [Approved by Management]", value: 495 },
      { label: "$450.00 Direct Delivery Tier", value: 450 },
      { label: "$550.00 Extended Range Rate", value: 550 },
      { label: "$600.00 Two-Person White Glove", value: 600 },
    ],
    impact: "Tab 03 500-Mile Direct White-Glove Delivery via XLOOKUP.",
  },
  {
    id: "Q07",
    systemKey: "EXPEDITE_SURCHARGE_PCT",
    category: "Operations",
    topic: "Expedited / Rush Production Surcharge",
    clarifying: "What percentage surcharge applies for 3-4 week expedited manufacturing in Phoenix?",
    selected: "20% Expedite Surcharge (+0.20) [Recommended]",
    options: [
      { label: "20% Expedite Surcharge (+0.20) [Recommended]", value: 0.2 },
      { label: "25% Expedite Surcharge (+0.25)", value: 0.25 },
      { label: "15% Fast-Track (+0.15)", value: 0.15 },
      { label: "No Rush Allowed (0.00)", value: 0 },
    ],
    impact: "Tab 03 Rush / Expedite Production Surcharge (%) via XLOOKUP.",
  },
  {
    id: "Q08",
    systemKey: "SIDEARM_SKU_ARCHITECTURE",
    category: "Master SKU Architecture",
    topic: "Swivel Chair w/ Dekton Sidearm SKU Architecture",
    clarifying:
      "Should Swivel Chairs w/ Dekton Sidearm exist as separate Master SKUs or be collapsed to base SKUs + line attribute?",
    selected: "Line Attribute Option (Collapsed to Base Swivel SKU) [Approved by Management]",
    options: [
      {
        label: "Line Attribute Option (Collapsed to Base Swivel SKU) [Approved by Management]",
        value: 0,
      },
      { label: "Keep Separate Master SKUs (FIN-BRV-SWV-CHA / FIN-OCN-SWV-CHA)", value: 1 },
    ],
    impact: "Woo catalog visibility + Katana attribute routing for sidearm configurations.",
  },
  {
    id: "Q09A",
    systemKey: "OFFER_DEKTON_SIDEARM_SINGLE",
    category: "Modular Add-Ons",
    topic: "Offer Dekton Sidearm (Single)",
    clarifying: "Should WooCommerce offer a single Dekton sidearm as a modular add-on line item?",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Catalog visibility for single Dekton sidearm add-on.",
  },
  {
    id: "Q09B",
    systemKey: "OFFER_DEKTON_SIDEARM_PAIR",
    category: "Modular Add-Ons",
    topic: "Offer Dekton Sidearms (Bilateral Pair)",
    clarifying: "Should WooCommerce offer a bilateral pair of Dekton sidearms as a modular add-on?",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Catalog visibility for Dekton sidearm pair bundle.",
  },
  {
    id: "Q09C",
    systemKey: "DEKTON_SIDEARM_SINGLE_USD",
    category: "Modular Add-Ons",
    topic: "Dekton Sidearm Single Retail Price",
    clarifying: "Confirm retail upcharge for a single Dekton sidearm on applicable sofas.",
    selected: "$450.00 Single Sidearm [Recommended]",
    options: [
      { label: "$450.00 Single Sidearm [Recommended]", value: 450 },
      { label: "$395.00 Volume Rate", value: 395 },
      { label: "$495.00 Premium Rate", value: 495 },
    ],
    impact: "Tab 03 Dekton Sidearm (single) via XLOOKUP(DEKTON_SIDEARM_SINGLE_USD).",
  },
  {
    id: "Q09D",
    systemKey: "DEKTON_SIDEARM_PAIR_USD",
    category: "Modular Add-Ons",
    topic: "Dekton Sidearms Pair Retail Price",
    clarifying: "Confirm retail upcharge for a bilateral pair of Dekton sidearms.",
    selected: "$850.00 Pair Bundle [Recommended]",
    options: [
      { label: "$850.00 Pair Bundle [Recommended]", value: 850 },
      { label: "$795.00 Volume Pair Rate", value: 795 },
      { label: "$950.00 Premium Pair Rate", value: 950 },
    ],
    impact: "Tab 03 Dekton Sidearms (pair) via XLOOKUP(DEKTON_SIDEARM_PAIR_USD).",
  },
  {
    id: "Q10",
    systemKey: "TENJAM_SHELF_DEPTH_MODE",
    category: "WooCommerce Checkout",
    topic: "Tenjam Shayz In-Pool Shelf Depth Cart Validation",
    clarifying:
      "Should WooCommerce enforce mandatory water depth selection (5\", 9\", 13\", 17\") for Tenjam Shayz loungers?",
    selected: 'Mandatory Cart Prompt (Select 5", 9", 13", 17") [Recommended]',
    options: [
      { label: 'Mandatory Cart Prompt (Select 5", 9", 13", 17") [Recommended]', value: 1 },
      { label: "Customer Order Note Optional", value: 0 },
      { label: 'Default to 9" Depth (4" Risers Bundled)', value: 2 },
    ],
    impact: "PrimeView checkout validation rule for Tenjam riser SKUs.",
  },
  {
    id: "Q11",
    systemKey: "FIM_MAP_PRICE_MULT",
    category: "3rd-Party Products",
    topic: "FIM Shade Systems MAP & Dealer Margin Policy",
    clarifying:
      "Are recommended retail prices for FIM Flexy Twin ($5,200) and Flexy Zen ($4,400) compliant with dealer MAP guidelines?",
    selected: "Approved at Proposed Retail (MAP Compliant) [Recommended]",
    options: [
      { label: "Approved at Proposed Retail (MAP Compliant) [Recommended]", value: 1 },
      { label: "Increase to FIM Published List Price (+10%)", value: 1.1 },
      { label: "Custom Contract Trade Margin (-15%)", value: 0.85 },
    ],
    impact: "Multiplies Tab 01 FIM / Flexy Web Base Price.",
  },
  {
    id: "Q12",
    systemKey: "FABRIC_GRADE_F_USD",
    category: "Textiles & Upholstery",
    topic: "Fabric Grade F Commercial Scope",
    clarifying: "What textile tier will populate Fabric Grade F cart upcharge?",
    selected: "Customer's Own Material (COM) / Specialty Velvets [Recommended]",
    options: [
      { label: "Customer's Own Material (COM) / Specialty Velvets [Recommended]", value: 1400 },
      { label: "Set to Inquire Only (Hide from Web Cart)", value: 0 },
      { label: "Eliminate Grade F (Cap at Grade E David Rockwell)", value: 0 },
    ],
    impact: "Tab 03 Fabric Grade F via XLOOKUP(FABRIC_GRADE_F_USD).",
  },
  {
    id: "Q13",
    systemKey: "PILLOW_FABRIC_UPCHARGE_MODE",
    category: "Textiles & Upholstery",
    topic: "Throw Pillow Fabric Grade Upcharge Behavior",
    clarifying:
      "Does upgrading pillow fabric trigger a cart upcharge, or are pillows sold at flat rates ($65 / $95)?",
    selected: "Flat Rate Regardless of Fabric Grade ($65 / $95) [Recommended]",
    options: [
      { label: "Flat Rate Regardless of Fabric Grade ($65 / $95) [Recommended]", value: 0 },
      { label: "Tiered Upcharge (+20% for Grade D/E)", value: 0.2 },
      { label: "Proportional Fabric Grade Upcharge", value: 1 },
    ],
    impact: "Woo cart rule: 0 = flat pillow SKUs only; >0 enables fabric tier math.",
  },
  {
    id: "Q15A",
    systemKey: "VW_LOCK_POWDER_3P",
    category: "Configurator Rules",
    topic: "Lock Powder Coat Slot on 3rd-Party Products",
    clarifying:
      "Should VividWorks disable powder coat slot on Tenjam, Scolaro, and Kindle Living products?",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Tab 05 / VW rule: lock powder coat on 3rd-party SKUs when Yes (1).",
  },
  {
    id: "Q15B",
    systemKey: "VW_LOCK_FABRIC_3P",
    category: "Configurator Rules",
    topic: "Lock Fabric / Upholstery Slot on 3rd-Party Products",
    clarifying:
      "Should VividWorks disable upholstery slot on Tenjam, Scolaro, and Kindle Living products?",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Tab 05 / VW rule: lock fabric slot on 3rd-party SKUs when Yes (1).",
  },
  {
    id: "Q15C",
    systemKey: "VW_LOCK_DEKTON_3P",
    category: "Configurator Rules",
    topic: "Lock Dekton Slot on 3rd-Party Products",
    clarifying:
      "Should VividWorks disable Dekton finish slot on Tenjam, Scolaro, and Kindle Living products?",
    selected: "Yes [Default]",
    options: yesNoOptions(true),
    impact: "Tab 05 / VW rule: lock Dekton slot on 3rd-party SKUs when Yes (1).",
  },
  {
    id: "Q16",
    systemKey: "FLAT_RATE_LTL_SEATING",
    category: "Logistics & Delivery",
    topic: "National LTL Seating Flat Rate",
    clarifying:
      "What national LTL white-glove / threshold delivery flat rate should apply to Class 175 assembled seating?",
    selected: "$250.00 National Seating Flat [Recommended]",
    options: [
      { label: "$250.00 National Seating Flat [Recommended]", value: 250 },
      { label: "$225.00 Promotional Seating Rate", value: 225 },
      { label: "$295.00 Standard Carrier Rate", value: 295 },
      { label: "$350.00 White-Glove Threshold Rate", value: 350 },
    ],
    impact: "Tab 03 National LTL Seating Delivery via XLOOKUP(FLAT_RATE_LTL_SEATING).",
  },
  {
    id: "Q17",
    systemKey: "FLAT_RATE_LTL_TABLE",
    category: "Logistics & Delivery",
    topic: "National LTL Table / Stone Flat Rate",
    clarifying:
      "What national LTL flat rate should apply to Class 85 crated Dekton tables and Class 100 fire tables?",
    selected: "$450.00 National Table Flat [Recommended]",
    options: [
      { label: "$450.00 National Table Flat [Recommended]", value: 450 },
      { label: "$395.00 Volume Table Rate", value: 395 },
      { label: "$525.00 White-Glove Table Rate", value: 525 },
      { label: "$595.00 Oversized / Dual-Crate Rate", value: 595 },
    ],
    impact: "Tab 03 National LTL Table Delivery via XLOOKUP(FLAT_RATE_LTL_TABLE).",
  },
  {
    id: "Q18",
    systemKey: "STANDARD_LEAD_TIME_WEEKS",
    category: "Operations",
    topic: "Standard Made-to-Order Lead Time",
    clarifying:
      "What standard production lead time midpoint (weeks) should publish for aluminum / Dekton MTO products?",
    selected: "6-8 weeks [Current Baseline]",
    options: [
      { label: "6-8 weeks [Current Baseline]", value: 7 },
      { label: "5-7 weeks (Capacity Optimized)", value: 6 },
      { label: "8-10 weeks (Peak Season)", value: 9 },
      { label: "4-6 weeks (Aggressive Promise)", value: 5 },
    ],
    impact: "Ops / PDP lead-time midpoint; human label remains Selected Option text.",
  },
  {
    id: "Q19",
    systemKey: "IRONWOOD_ARM_USD",
    category: "Modular Add-Ons",
    topic: "Ironwood Arm Accent Unit Price",
    clarifying: "Confirm Ironwood arm accent retail upcharge (per applicable arm).",
    selected: "$250.00 per Arm [Approved]",
    options: [
      { label: "$250.00 per Arm [Approved]", value: 250 },
      { label: "$200.00 Volume Arm Rate", value: 200 },
      { label: "$300.00 Premium Species Rate", value: 300 },
      { label: "$350.00 Teak Upgrade Rate", value: 350 },
    ],
    impact: "Tab 03 Ironwood Arms / Ironwood synonym rows.",
  },
  {
    id: "Q20",
    systemKey: "CASTERS_SET_USD",
    category: "Modular Add-Ons",
    topic: "Casters / Wheels Set Price",
    clarifying: "Confirm heavy-duty locking caster set (4) retail upcharge for chaises and daybeds.",
    selected: "$300.00 per Set [Approved]",
    options: [
      { label: "$300.00 per Set [Approved]", value: 300 },
      { label: "$250.00 Promotional Set", value: 250 },
      { label: "$350.00 Stainless Marine Set", value: 350 },
      { label: "$400.00 Commercial Soft-Wheel Set", value: 400 },
    ],
    impact: "Tab 03 Casters / Wheels synonym rows.",
  },
  {
    id: "Q21",
    systemKey: "PILLOW_BASE_SMALL_USD",
    category: "Textiles & Upholstery",
    topic: "Accent Pillow Base Prices (17x17 / 23x23 / Lumbar)",
    clarifying:
      "Lock flat pillow SKU prices used when pillow fabric upcharge mode is flat-rate. Active value = 17x17 & lumbar; 23x23 derived.",
    selected: "$65 / $95 Flat Bundle [Approved]",
    options: [
      { label: "$65 / $95 Flat Bundle [Approved]", value: 65 },
      { label: "$55 / $85 Promotional Bundle", value: 55 },
      { label: "$75 / $110 Premium Bundle", value: 75 },
      { label: "$85 / $125 Designer Bundle", value: 85 },
    ],
    impact: "Tab 03 Square 17x17 / Lumbar; 23x23 mapped from small base.",
  },
  {
    id: "Q22",
    systemKey: "DEKTON_SCALE_FACTOR",
    category: "Stone Fabrication",
    topic: "Dekton Grade Ladder Scale Factor",
    clarifying:
      "Global multiplier for Dekton Grade B–F ladder (A remains $0). Annual Cosentino inflation control.",
    selected: "1.00x Locked Ladder [Current]",
    options: [
      { label: "1.00x Locked Ladder [Current]", value: 1 },
      { label: "1.05x Mild Inflation", value: 1.05 },
      { label: "1.10x Cosentino Pass-Through", value: 1.1 },
      { label: "0.95x Launch Promo", value: 0.95 },
    ],
    impact: "Multiplies Tab 03 Dekton Grade B–F via XLOOKUP(DEKTON_SCALE_FACTOR).",
  },
  {
    id: "Q23",
    systemKey: "FABRIC_SCALE_FACTOR",
    category: "Textiles & Upholstery",
    topic: "Fabric Grade Ladder Scale Factor",
    clarifying:
      "Global multiplier for Fabric Grade B–E ladder (A=$0; F controlled by FABRIC_GRADE_F_USD).",
    selected: "1.00x Locked Ladder [Current]",
    options: [
      { label: "1.00x Locked Ladder [Current]", value: 1 },
      { label: "1.05x Mild Inflation", value: 1.05 },
      { label: "1.10x Mill Pass-Through", value: 1.1 },
      { label: "0.90x Launch Promo", value: 0.9 },
    ],
    impact: "Multiplies Tab 03 Fabric Grade B–E via XLOOKUP(FABRIC_SCALE_FACTOR).",
  },
  {
    id: "Q24",
    systemKey: "DUPLICATE_SKU_POLICY",
    category: "Master SKU Architecture",
    topic: "Duplicate Master SKU Remediation Policy",
    clarifying:
      "How should MDM remediate duplicate FIN-* values before Katana publish / Woo import?",
    selected: "Block Publish Until Unique [Recommended]",
    options: [
      { label: "Block Publish Until Unique [Recommended]", value: 0 },
      { label: "Auto-Suffix Height/Arm Codes (FIN-…-BAR / -ARM)", value: 1 },
      { label: "Allow Duplicates (Manual Ops Risk)", value: 2 },
    ],
    impact: "Fail-closed gate for Katana sync scripts when Active Value = 0.",
  },
  {
    id: "Q25",
    systemKey: "HIDE_MERGED_SIDEARM_SKUS",
    category: "Master SKU Architecture",
    topic: "Hide Merged Sidearm Master SKUs on Web",
    clarifying:
      "Q08 collapses Dekton Sidearm to a line attribute. Hide convenience FIN-* rows from Woo catalog?",
    selected: "Hide from Web; Keep Internal Alias [Recommended]",
    options: [
      { label: "Hide from Web; Keep Internal Alias [Recommended]", value: 0 },
      { label: "Delete Rows; Alias Only in Dictionary", value: 1 },
      { label: "Keep Visible as Convenience SKUs", value: 2 },
    ],
    impact: "PrimeView catalog visibility for MERGED sidearm rows.",
  },
  {
    id: "Q26",
    systemKey: "POWDER_PREMIUM_USD",
    category: "Powder Coat",
    topic: "Premium Powder Retail Upcharge",
    clarifying:
      "Should Oil Rub Bronze / Wild Rice carry a retail powder upcharge vs baseline powders ($0)?",
    selected: "$0 All Powders Parity [Approved]",
    options: [
      { label: "$0 All Powders Parity [Approved]", value: 0 },
      { label: "$75 Premium Metallic / Texture", value: 75 },
      { label: "$125 Oil Rub Bronze Only", value: 125 },
      { label: "$150 All Non-Black Powders", value: 150 },
    ],
    impact: "Tab 03 Powder Premium Upcharge row.",
  },
  {
    id: "Q27",
    systemKey: "FRAME_WARRANTY_YEARS",
    category: "Warranty & Care",
    topic: "Aluminum Frame Structural Warranty Term",
    clarifying: "Publish years of structural frame warranty on product Details / PDP template.",
    selected: "15 Years Structural [Current Policy]",
    options: [
      { label: "15 Years Structural [Current Policy]", value: 15 },
      { label: "10 Years Structural", value: 10 },
      { label: "20 Years Structural", value: 20 },
      { label: "Lifetime Limited Structural", value: 99 },
    ],
    impact: "PDP warranty module constant for PrimeView.",
  },
  {
    id: "Q28",
    systemKey: "SLOT_FAIL_MODE",
    category: "Configurator Rules",
    topic: "Illegal Slot Combinations Fail Mode",
    clarifying:
      "When Tab 05 marks a slot N/A, should VividWorks / Woo fail closed (block add-to-cart) or warn only?",
    selected: "Fail Closed (Block Illegal Combos) [Recommended]",
    options: [
      { label: "Fail Closed (Block Illegal Combos) [Recommended]", value: 0 },
      { label: "Warn Only (Allow Quote Escape Hatch)", value: 1 },
      { label: "Silent Hide Unavailable Slots", value: 2 },
    ],
    impact: "VW / Woo constraint fail mode for illegal finish combinations.",
  },
  // --- WooCommerce checkout programming (PrimeView) ---
  {
    id: "Q29",
    systemKey: "PAYMENT_AUTH_CAPTURE_MODE",
    category: "WooCommerce Checkout",
    topic: "Payment Auth vs. Capture",
    clarifying:
      "Should WooCommerce capture payment immediately at checkout, or authorize at checkout and capture at shipment?",
    selected: "Capture immediately at checkout",
    options: [
      { label: "Capture immediately at checkout", value: 1 },
      { label: "Auth at checkout / Capture at shipment", value: 2 },
    ],
    impact: "PrimeView payment gateway setting (WooCommerce global).",
  },
  {
    id: "Q30",
    systemKey: "TAXATION_STRATEGY",
    category: "WooCommerce Checkout",
    topic: "Taxation Strategy",
    clarifying: "How should WooCommerce compute sales tax for national e-commerce orders?",
    selected: "Flat AZ Rate (Nexus Only)",
    options: [
      { label: "Flat AZ Rate (Nexus Only)", value: 1 },
      { label: "3rd-Party API (TaxJar/Avalara)", value: 2 },
      { label: "Tax-Inclusive Pricing", value: 3 },
    ],
    impact: "PrimeView tax plugin / WooCommerce tax mode global.",
  },
  {
    id: "Q31",
    systemKey: "SHIPPING_RULE_ITEM_VS_CART",
    category: "WooCommerce Checkout",
    topic: "Shipping Rule (Item vs Cart)",
    clarifying:
      "Should LTL flat-rate shipping (seating/table/local/regional) apply per line item or once per cart?",
    selected: "Apply LTL Flat Rate Per Item",
    options: [
      { label: "Apply LTL Flat Rate Per Item", value: 1 },
      { label: "Apply LTL Flat Rate Per Cart", value: 2 },
    ],
    impact: "WooCommerce shipping method aggregation rule for LTL flats.",
  },
  {
    id: "Q32",
    systemKey: "ORDER_CANCELLATION_WINDOW",
    category: "WooCommerce Checkout",
    topic: "Order Cancellation Window",
    clarifying:
      "How long after checkout may a customer cancel a made-to-order aluminum / Dekton order?",
    selected: "24 Hours",
    options: [
      { label: "24 Hours", value: 24 },
      { label: "48 Hours", value: 48 },
      { label: "Final Sale (No Cancellations)", value: 0 },
    ],
    impact: "WooCommerce cancellation policy / customer portal window (hours; 0 = final sale).",
  },
];

/** Locked monsoon copy — formerly Q14; now Tab 01 marketing only. */
export const OTTOMAN_MONSOON_MARKETING =
  "Fully gasketed commercial waterproof lid with perimeter rubber seal and lined aluminum interior engineered for Arizona monsoon outdoor cushion storage.";

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      const f = value as ExcelJS.CellFormulaValue & { sharedFormula?: string };
      if (f.result != null && f.result !== "") return String(f.result).trim();
      return "";
    }
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("").trim();
    }
    if ("text" in value) return String((value as { text?: string }).text ?? "").trim();
  }
  return String(value).trim();
}

function escapeIfsLabel(label: string): string {
  return label.replace(/"/g, '""');
}

function buildIfsFormula(selectedCol: string, row: number, options: QaOption[]): string {
  const parts = options
    .map((o) => `${selectedCol}${row}="${escapeIfsLabel(o.label)}", ${o.value}`)
    .join(", ");
  return `IFS(${parts})`;
}

function buildActiveMultiplierFormula(row: number, options: QaOption[]): string {
  const nonOther = options.filter((o) => o.label !== OTHER_OPTION_LABEL);
  const ifsPart = buildIfsFormula("F", row, nonOther);
  // Other_Value is column H after Q&A column cleanup
  return `IF(F${row}="${escapeIfsLabel(OTHER_OPTION_LABEL)}",IF(H${row}="",0,H${row}),${ifsPart})`;
}

/** Live XLOOKUP for Tab 02 Retail Upcharge (col J) from Pricing Grade (col H). */
export function tab02RetailUpchargeFormula(row: number): string {
  return `IF(H${row}="","",IFERROR(XLOOKUP(IF(A${row}="Dekton","Dekton Grade ","Fabric Grade ")&H${row},'03 - UPCHARGE MATRIX'!$A:$A,'03 - UPCHARGE MATRIX'!$B:$B,0),0))`;
}

/** XLOOKUP System_Variable_Key → Active Multiplier (col G). */
export function xlookupMultiplier(systemKey: string): string {
  return `XLOOKUP("${systemKey}",'${QA}'!$B:$B,'${QA}'!$G:$G)`;
}

function rebuildQaOptionsSheet(wb: ExcelJS.Workbook, questions: QaQuestion[]): void {
  let sheet = wb.getWorksheet(QA_OPTIONS);
  if (sheet) wb.removeWorksheet(sheet.id);
  sheet = wb.addWorksheet(QA_OPTIONS, { state: "hidden" });

  questions.forEach((q, qi) => {
    const col = qi + 1;
    sheet!.getCell(1, col).value = q.systemKey;
    withOtherOption(q.options).forEach((opt, oi) => {
      sheet!.getCell(oi + 2, col).value = opt.label;
    });
  });
}

function optionRange(questionIndex: number, optionCount: number): string {
  const col = questionIndex + 1;
  let n = col;
  let letter = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    letter = String.fromCharCode(65 + m) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return `'${QA_OPTIONS}'!$${letter}$2:$${letter}$${optionCount + 1}`;
}

function rebuildQaSheet(wb: ExcelJS.Workbook, questions: QaQuestion[]): void {
  let sheet = wb.getWorksheet(QA);
  if (sheet) wb.removeWorksheet(sheet.id);
  sheet = wb.addWorksheet(QA, { views: [{ state: "frozen", ySplit: 2 }] });

  // exceljs keeps a sparse 1-based _worksheets array — move Q&A to front safely
  const internal = (wb as unknown as { _worksheets?: (ExcelJS.Worksheet | undefined)[] })
    ._worksheets;
  if (Array.isArray(internal)) {
    const idx = internal.findIndex((s) => s?.name === QA);
    if (idx > 1) {
      const qaSheet = internal[idx]!;
      internal.splice(idx, 1);
      // slot 0 is unused; insert at index 1 (first real sheet)
      internal.splice(1, 0, qaSheet);
    }
  }

  // Prefer orderNo (survives xlsx write more reliably than array splice alone)
  type OrderedSheet = ExcelJS.Worksheet & { orderNo?: number };
  const all = wb.worksheets.filter(Boolean) as OrderedSheet[];
  const qaWs = all.find((s) => s.name === QA);
  const others = all.filter((s) => s.name !== QA && s.name !== QA_OPTIONS);
  const hidden = all.find((s) => s.name === QA_OPTIONS);
  if (qaWs) qaWs.orderNo = 0;
  others.forEach((s, i) => {
    s.orderNo = i + 1;
  });
  if (hidden) hidden.orderNo = others.length + 1;

  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value =
    "CC PATIO — Q&A CONTROL PANEL (PrimeView WooCommerce Globals + Merchandising Math)";
  sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = HEADER_FILL;
  sheet.getRow(1).height = 28;

  const headers = [
    "ID",
    "System_Variable_Key",
    "Category",
    "Decision Topic",
    "Clarifying Question & Merchandising Context",
    "Management Selected Option",
    "Multiplier",
    "Other_Value",
  ];
  headers.forEach((h, i) => {
    const cell = sheet!.getRow(2).getCell(i + 1);
    cell.value = h;
    cell.fill = h === "Other_Value" ? YELLOW_FILL : HEADER_FILL;
    cell.font = h === "Other_Value" ? { ...HEADER_FONT, color: { argb: "FF111827" } } : HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.getRow(2).height = 32;

  // Clear stale validations by replacing sheet (already new)

  questions.forEach((q, qi) => {
    const r = qi + 3;
    const row = sheet!.getRow(r);
    const expandedOptions = withOtherOption(q.options);
    row.getCell(1).value = q.id;
    row.getCell(2).value = q.systemKey;
    row.getCell(2).font = { bold: true, name: "Consolas", size: 10 };
    row.getCell(3).value = q.category;
    row.getCell(4).value = q.topic;
    row.getCell(5).value = q.clarifying;
    row.getCell(6).value = q.selected;
    row.getCell(7).value = { formula: buildActiveMultiplierFormula(r, expandedOptions) };
    row.getCell(8).value = "";

    // Strict dropdown — range on hidden helper sheet (options may contain commas)
    (
      sheet as ExcelJS.Worksheet & {
        dataValidations: { add: (address: string, validation: ExcelJS.DataValidation) => void };
      }
    ).dataValidations.add(`F${r}`, {
      type: "list",
      allowBlank: false,
      formulae: [optionRange(qi, expandedOptions.length)],
      showErrorMessage: true,
      showInputMessage: true,
      promptTitle: "Locked choice",
      prompt: "Select exactly one option. Free-typing is not allowed.",
      errorTitle: "Invalid option",
      error: "Choose a value from the dropdown list only.",
      errorStyle: "stop",
      operator: "equal",
    });
  });

  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 32;
  sheet.getColumn(3).width = 22;
  sheet.getColumn(4).width = 40;
  sheet.getColumn(5).width = 56;
  sheet.getColumn(6).width = 52;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 18;

  // Note row under last question
  const noteRow = questions.length + 3;
  sheet.mergeCells(`A${noteRow}:H${noteRow}`);
  sheet.getCell(`A${noteRow}`).value =
    "PrimeView: scrape System_Variable_Key (col B) + Multiplier (col G) + Management Selected Option (col F) to define WooCommerce globals. When 'Other (specify in Other_Value)' is selected, enter the override numeric value in Other_Value (col H). Dropdown options live on hidden _QA_OPTIONS. Q&A is logic/math/routing only — product marketing copy lives on Tab 01.";
  sheet.getCell(`A${noteRow}`).fill = LOCK_NOTE_FILL;
  sheet.getCell(`A${noteRow}`).alignment = { wrapText: true };
  sheet.getRow(noteRow).height = 36;
}

function findTab03Row(sheet: ExcelJS.Worksheet, name: string): number | null {
  for (let r = 2; r <= 80; r++) {
    if (cellText(sheet.getRow(r).getCell(1).value) === name) return r;
  }
  return null;
}

function ensureTab03Row(sheet: ExcelJS.Worksheet, name: string, rule: string): number {
  const existing = findTab03Row(sheet, name);
  if (existing) {
    sheet.getRow(existing).getCell(3).value = rule;
    return existing;
  }
  let r = 2;
  while (cellText(sheet.getRow(r).getCell(1).value)) r += 1;
  sheet.getRow(r).getCell(1).value = name;
  sheet.getRow(r).getCell(3).value = rule;
  return r;
}

function wireTab03(sheet: ExcelJS.Worksheet): void {
  const setFormula = (name: string, formula: string, rule: string) => {
    const row = ensureTab03Row(sheet, name, rule);
    sheet.getRow(row).getCell(2).value = { formula };
  };

  // Fabric ladder
  setFormula("Fabric Grade A", "0", "Baseline — no add to Web Base Price");
  for (const [g, base] of [
    ["B", 150],
    ["C", 350],
    ["D", 600],
    ["E", 950],
  ] as const) {
    setFormula(
      `Fabric Grade ${g}`,
      `ROUND(${base}*${xlookupMultiplier("FABRIC_SCALE_FACTOR")},0)`,
      `Base $${base} × XLOOKUP(FABRIC_SCALE_FACTOR)`,
    );
  }
  setFormula(
    "Fabric Grade F",
    xlookupMultiplier("FABRIC_GRADE_F_USD"),
    "XLOOKUP(FABRIC_GRADE_F_USD) from Q&A",
  );

  // Dekton ladder
  setFormula("Dekton Grade A", "0", "Baseline Dekton — no add to Web Base Price");
  for (const [g, base] of [
    ["B", 250],
    ["C", 550],
    ["D", 950],
    ["E", 1500],
    ["F", 2200],
  ] as const) {
    setFormula(
      `Dekton Grade ${g}`,
      `ROUND(${base}*${xlookupMultiplier("DEKTON_SCALE_FACTOR")},0)`,
      `Base $${base} × XLOOKUP(DEKTON_SCALE_FACTOR)`,
    );
  }

  setFormula(
    "Ironwood Arms (per applicable arm)",
    xlookupMultiplier("IRONWOOD_ARM_USD"),
    "XLOOKUP(IRONWOOD_ARM_USD)",
  );
  setFormula("Ironwood", xlookupMultiplier("IRONWOOD_ARM_USD"), "Synonym → IRONWOOD_ARM_USD");

  setFormula("Casters (per set)", xlookupMultiplier("CASTERS_SET_USD"), "XLOOKUP(CASTERS_SET_USD)");
  setFormula("Casters", xlookupMultiplier("CASTERS_SET_USD"), "Synonym → CASTERS_SET_USD");
  setFormula("Wheels", xlookupMultiplier("CASTERS_SET_USD"), "Synonym → CASTERS_SET_USD");

  setFormula(
    "Square Pillow 17x17",
    xlookupMultiplier("PILLOW_BASE_SMALL_USD"),
    "XLOOKUP(PILLOW_BASE_SMALL_USD)",
  );
  setFormula(
    "Lumbar Pillow 12x24",
    xlookupMultiplier("PILLOW_BASE_SMALL_USD"),
    "XLOOKUP(PILLOW_BASE_SMALL_USD)",
  );
  setFormula(
    "Square Pillow 23x23",
    `IF(${xlookupMultiplier("PILLOW_BASE_SMALL_USD")}=65,95,IF(${xlookupMultiplier("PILLOW_BASE_SMALL_USD")}=55,85,IF(${xlookupMultiplier("PILLOW_BASE_SMALL_USD")}=75,110,IF(${xlookupMultiplier("PILLOW_BASE_SMALL_USD")}=85,125,${xlookupMultiplier("PILLOW_BASE_SMALL_USD")}+30))))`,
    "Derived from PILLOW_BASE_SMALL_USD bundle map",
  );

  setFormula(
    "Dekton Sidearm (when not a finish row)",
    xlookupMultiplier("DEKTON_SIDEARM_SINGLE_USD"),
    "XLOOKUP(DEKTON_SIDEARM_SINGLE_USD)",
  );
  setFormula(
    "Dekton Sidearm",
    xlookupMultiplier("DEKTON_SIDEARM_SINGLE_USD"),
    "Synonym → DEKTON_SIDEARM_SINGLE_USD",
  );
  setFormula(
    "Dekton Sidearms",
    xlookupMultiplier("DEKTON_SIDEARM_PAIR_USD"),
    "XLOOKUP(DEKTON_SIDEARM_PAIR_USD)",
  );

  setFormula(
    "Local White-Glove Delivery (Phoenix Metro / Maricopa County)",
    xlookupMultiplier("FLAT_RATE_LOCAL_WHITE_GLOVE"),
    "XLOOKUP(FLAT_RATE_LOCAL_WHITE_GLOVE)",
  );
  setFormula(
    "500-Mile Direct White-Glove Delivery (AZ / NV / SoCal / NM)",
    xlookupMultiplier("FLAT_RATE_REGIONAL_500MI"),
    "XLOOKUP(FLAT_RATE_REGIONAL_500MI)",
  );
  setFormula(
    "National LTL Seating Delivery (Class 175)",
    xlookupMultiplier("FLAT_RATE_LTL_SEATING"),
    "XLOOKUP(FLAT_RATE_LTL_SEATING)",
  );
  setFormula(
    "National LTL Table Delivery (Class 85/100)",
    xlookupMultiplier("FLAT_RATE_LTL_TABLE"),
    "XLOOKUP(FLAT_RATE_LTL_TABLE)",
  );
  setFormula(
    "Powder Premium Upcharge (non-baseline)",
    xlookupMultiplier("POWDER_PREMIUM_USD"),
    "XLOOKUP(POWDER_PREMIUM_USD)",
  );
  setFormula(
    "Rush / Expedite Production Surcharge (%)",
    xlookupMultiplier("EXPEDITE_SURCHARGE_PCT"),
    "XLOOKUP(EXPEDITE_SURCHARGE_PCT)",
  );

  // Static add-ons without Q&A keys yet — leave numeric if present
  for (const [name, amount] of [
    ["Metal Arms upgrade", 350],
    ["Arms", 350],
    ["Fly Tables", 650],
    ["Umbrella Holder", 180],
  ] as const) {
    const row = findTab03Row(sheet, name);
    if (row && !cellText(sheet.getRow(row).getCell(2).value)) {
      sheet.getRow(row).getCell(2).value = amount;
    }
  }
}

function rewriteTab01Formulas(t1: ExcelJS.Worksheet): {
  msrp: number;
  brooklyn: number;
  waterfall: number;
  fire: number;
  fim: number;
} {
  const stats = { msrp: 0, brooklyn: 0, waterfall: 0, fire: 0, fim: 0 };
  const bravadaByKey = new Map<string, number>();
  const brooklynTables = new Map<string, number>();

  for (let r = 2; r <= 266; r++) {
    const sku = cellText(t1.getRow(r).getCell(2).value);
    if (/^FIN-BRV-SOF-\d+X34$/.test(sku) || /^FIN-BRV-LOV-SOF-60X34$/.test(sku)) {
      bravadaByKey.set(sku.replace("FIN-BRV-", ""), r);
    }
    if (/^FIN-BRV-COR-SOF-\d+X34$/.test(sku)) {
      bravadaByKey.set(sku.replace("FIN-BRV-", ""), r);
    }
    if (/^FIN-BRK-(DIN|CNT|BAR)-TAB-\d+X\d+$/.test(sku)) {
      brooklynTables.set(sku, r);
    }
  }

  for (let r = 2; r <= 266; r++) {
    const sku = cellText(t1.getRow(r).getCell(2).value);
    if (!sku.startsWith("FIN-")) continue;
    const name = cellText(t1.getRow(r).getCell(1).value);

    // MSRP always XLOOKUP markup
    t1.getRow(r).getCell(6).value = {
      formula: `ROUND(E${r}*${xlookupMultiplier("MSRP_MARKUP_MULT")},2)`,
    };
    stats.msrp += 1;

    const brkSofa = sku.match(/^FIN-BRK-(SOF-\d+X34|COR-SOF-\d+X34)$/);
    if (brkSofa) {
      let peer =
        bravadaByKey.get(brkSofa[1]!) ||
        (brkSofa[1] === "SOF-60X34" ? bravadaByKey.get("LOV-SOF-60X34") : undefined);
      if (peer) {
        t1.getRow(r).getCell(5).value = {
          formula: `ROUND('${TAB01}'!E${peer}*${xlookupMultiplier("BROOKLYN_BRAVADA_PARITY")},0)`,
        };
        stats.brooklyn += 1;
      }
    }

    const wft = sku.match(/^FIN-WFT-(DIN|CNT|BAR)-TAB-(\d+X\d+)$/);
    if (wft) {
      const brkSku = `FIN-BRK-${wft[1]}-TAB-${wft[2]}`;
      const brkRow = brooklynTables.get(brkSku);
      if (brkRow) {
        t1.getRow(r).getCell(5).value = {
          formula: `ROUND('${TAB01}'!E${brkRow}*${xlookupMultiplier("WATERFALL_MITER_PREMIUM")},0)`,
        };
        stats.waterfall += 1;
      }
    }

    if (/FIR-TAB|FIRE|PROPANE/i.test(sku + name)) {
      const cell = t1.getRow(r).getCell(5);
      let base: number | null = null;
      const v = cell.value;
      if (typeof v === "number") base = v;
      else if (typeof v === "object" && v && "formula" in v) {
        const m = String(v.formula).match(/^ROUND\((-?\d+(?:\.\d+)?)\+/);
        if (m) base = Number(m[1]);
        else {
          const n = Number(cellText(v as ExcelJS.CellValue));
          if (!Number.isNaN(n) && n > 0) base = n;
        }
      } else {
        const n = Number(cellText(v));
        if (!Number.isNaN(n) && n > 0) base = n;
      }
      if (base != null) {
        const burner = xlookupMultiplier("FIRE_INCLUDE_BURNER");
        const glass = xlookupMultiplier("FIRE_INCLUDE_GLASS");
        const media = xlookupMultiplier("FIRE_INCLUDE_MEDIA");
        t1.getRow(r).getCell(5).value = {
          formula: `ROUND(${base}-(IF(${burner}=0,850,0)+IF(${glass}=0,200,0)+IF(${media}=0,150,0)),0)`,
        };
        stats.fire += 1;
      }
    }

    if (/FIM|FLEXY|FLEX/i.test(sku + name)) {
      const cell = t1.getRow(r).getCell(5);
      let base: number | null = null;
      const v = cell.value;
      if (typeof v === "number") base = v;
      else if (typeof v === "object" && v && "formula" in v) {
        const m = String(v.formula).match(/^ROUND\((-?\d+(?:\.\d+)?)\*/);
        if (m) base = Number(m[1]);
      } else {
        const n = Number(cellText(v));
        if (!Number.isNaN(n) && n > 0) base = n;
      }
      if (base != null) {
        t1.getRow(r).getCell(5).value = {
          formula: `ROUND(${base}*${xlookupMultiplier("FIM_MAP_PRICE_MULT")},0)`,
        };
        stats.fim += 1;
      }
    }
  }

  return stats;
}

export const OPS_DEFAULT_FREIGHT_SEATING = "175";
export const OPS_DEFAULT_FREIGHT_TABLES = "85";
export const OPS_DEFAULT_LEAD_TIME = "6-8 weeks";

/** True when SKU/name looks like table / stone / fire table (NMFC tables class). */
export function isTableOrStoneProduct(sku: string, name: string): boolean {
  const hay = `${sku} ${name}`.toUpperCase();
  return /TAB|TABLE|FIR-TAB|FIRE\s*TABLE|DEKTON\s*TOP|STONE\s*TOP|DIN-TAB|CNT-TAB|BAR-TAB|COF-TAB|SIDE-TAB/.test(
    hay,
  );
}

/**
 * A3 — blank-only Freight Class + Lead Time from ops_defaults.
 * Tab 01 cols: L=Freight Class (12), M=Lead Time (13).
 */
export function fillTab01LogisticsDefaults(t1: ExcelJS.Worksheet): {
  freightFilled: number;
  leadFilled: number;
} {
  let freightFilled = 0;
  let leadFilled = 0;
  for (let r = 2; r <= Math.max(t1.rowCount, 266); r++) {
    const row = t1.getRow(r);
    const sku = cellText(row.getCell(2).value);
    const name = cellText(row.getCell(1).value);
    if (!sku && !name) continue;

    const freightCell = row.getCell(12);
    if (!cellText(freightCell.value)) {
      freightCell.value = isTableOrStoneProduct(sku, name)
        ? OPS_DEFAULT_FREIGHT_TABLES
        : OPS_DEFAULT_FREIGHT_SEATING;
      freightFilled += 1;
    }

    const leadCell = row.getCell(13);
    if (!cellText(leadCell.value)) {
      leadCell.value = OPS_DEFAULT_LEAD_TIME;
      leadFilled += 1;
    }
  }
  return { freightFilled, leadFilled };
}

/** S1 — remove CostFromId column from 99 - DICTIONARY (never ship COGS). */
export function stripDictionaryCostFromId(wb: ExcelJS.Workbook): {
  removed: boolean;
  cellsCleared: number;
} {
  const sheet = wb.getWorksheet("99 - DICTIONARY");
  if (!sheet) return { removed: false, cellsCleared: 0 };

  let costCol = 0;
  const headerRow = 1;
  for (let c = 1; c <= 20; c++) {
    if (/^CostFromId$/i.test(cellText(sheet.getRow(headerRow).getCell(c).value))) {
      costCol = c;
      break;
    }
  }
  if (!costCol) return { removed: false, cellsCleared: 0 };

  let cellsCleared = 0;
  const lastCol = 20;
  const maxRow = Math.max(sheet.rowCount, 500);
  for (let r = 1; r <= maxRow; r++) {
    const row = sheet.getRow(r);
    for (let c = costCol; c < lastCol; c++) {
      const src = row.getCell(c + 1);
      const dest = row.getCell(c);
      dest.value = src.value ?? null;
    }
    row.getCell(lastCol).value = null;
    cellsCleared += 1;
  }
  return { removed: true, cellsCleared };
}

function applyOttomanMarketing(t1: ExcelJS.Worksheet): number {
  let n = 0;
  for (let r = 2; r <= 266; r++) {
    const sku = cellText(t1.getRow(r).getCell(2).value);
    const name = cellText(t1.getRow(r).getCell(1).value);
    if (!/CUS-OTT|STORAGE OTTOMAN/i.test(sku + name)) continue;
    const marketingCell = t1.getRow(r).getCell(9);
    const existing = cellText(marketingCell.value);
    if (existing.includes("gasketed commercial waterproof")) continue;
    marketingCell.value = existing
      ? `${existing} ${OTTOMAN_MONSOON_MARKETING}`
      : OTTOMAN_MONSOON_MARKETING;
    n += 1;
  }
  return n;
}

export const VW_CAPABILITY_ONE_TO_ONE = "We can use CC Patio IDs (1:1 Mapping)";
export const VW_CAPABILITY_FORCE_UUID = "Our system forces UUIDs";
export const VW_UUID_PASTE_PROMPT = "--> PASTE UUID HERE <--";

/** Self-filling VW Asset ID: mirrors Internal ID unless toggle forces UUID paste. */
export function vwAssetIdFormula(row: number): string {
  return `IF($C$2="${VW_CAPABILITY_ONE_TO_ONE}",A${row},"${VW_UUID_PASTE_PROMPT}")`;
}

function upgradeTab07(t7: ExcelJS.Worksheet): { rows: number; mode: string } {
  type MatRow = {
    internalId: string;
    category: string;
    displayName: string;
    thumbnail: string;
    status: string;
    pastedUuid: string;
  };

  // Capture existing material rows (skip instruction / capability / header rows)
  const materials: MatRow[] = [];
  for (let r = 1; r <= Math.max(t7.rowCount, 5); r++) {
    const a = cellText(t7.getRow(r).getCell(1).value);
    const b = cellText(t7.getRow(r).getCell(2).value);
    const c = cellText(t7.getRow(r).getCell(3).value);
    if (a === "Internal ID" || a.startsWith("INSTRUCTIONS:") || a.startsWith("VividWorks")) {
      continue;
    }
    if (a.startsWith("VividWorks 3D Engine Capability")) continue;
    if (!a && !c && !b) continue;
    // Skip capability label row if stored in col A
    if (/3D Engine Capability/i.test(a + b)) continue;

    const dCell = t7.getRow(r).getCell(4).value;
    let pastedUuid = "";
    if (typeof dCell === "string" && dCell && !dCell.includes("PASTE UUID")) {
      pastedUuid = dCell;
    } else if (typeof dCell === "object" && dCell && "formula" in dCell) {
      // keep prior paste only if formula already evaluated to a custom UUID (rare in exceljs)
      pastedUuid = "";
    } else if (dCell != null && typeof dCell !== "object") {
      const t = String(dCell).trim();
      if (t && t !== VW_UUID_PASTE_PROMPT) pastedUuid = t;
    }

    materials.push({
      internalId: a,
      category: b,
      displayName: c,
      thumbnail: cellText(t7.getRow(r).getCell(5).value),
      status: cellText(t7.getRow(r).getCell(6).value) || "PENDING",
      pastedUuid,
    });
  }

  // S2 — drop factory consumable powders (primer / plugs / hang wire)
  const vendorMaterials = materials.filter((m) => isVendorSafeMaterialId(m.internalId));

  // Clear used grid (leave sheet object)
  try {
    // Drop existing merges so A1:F1 / A2:B2 can be re-applied cleanly
    const model = t7.model as { merges?: string[] };
    if (Array.isArray(model.merges)) {
      for (const m of [...model.merges]) {
        try {
          t7.unMergeCells(m);
        } catch {
          /* ignore stale merge */
        }
      }
    }
  } catch {
    /* ignore */
  }

  const maxClear = Math.max(t7.rowCount, materials.length + 10);
  for (let r = 1; r <= maxClear; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = t7.getRow(r).getCell(c);
      cell.value = null;
    }
  }

  // Row 1 — locked instructions
  t7.mergeCells("A1:F1");
  const instr = t7.getCell("A1");
  instr.value =
    "INSTRUCTIONS: We expect a 1:1 ID mapping between our ERP and your 3D Engine. If your engine supports custom IDs, leave the dropdown above as-is. If your engine forces system-generated UUIDs, change the dropdown, and paste your UUIDs directly over the column below.";
  instr.fill = LOCK_NOTE_FILL;
  instr.font = { bold: true, size: 11, name: "Calibri" };
  instr.alignment = { wrapText: true, vertical: "middle" };
  instr.protection = { locked: true };
  t7.getRow(1).height = 52;

  // Row 2 — global capability toggle
  t7.getCell("A2").value = "VividWorks 3D Engine Capability:";
  t7.getCell("A2").font = { bold: true, name: "Calibri", size: 11 };
  t7.mergeCells("A2:B2");
  t7.getCell("C2").value = VW_CAPABILITY_ONE_TO_ONE;
  t7.getCell("C2").fill = YELLOW_FILL;
  t7.getCell("C2").font = { bold: true, name: "Calibri", size: 11 };
  t7.getCell("C2").dataValidation = {
    type: "list",
    allowBlank: false,
    formulae: [`"${VW_CAPABILITY_ONE_TO_ONE},${VW_CAPABILITY_FORCE_UUID}"`],
    showErrorMessage: true,
    showInputMessage: true,
    promptTitle: "Engine capability",
    prompt: "Choose 1:1 CC Patio IDs or force UUID paste mode.",
    errorTitle: "Invalid option",
    error: "Select a value from the dropdown only.",
    errorStyle: "stop",
  };
  t7.getCell("D2").value =
    "Default = 1:1 mapping. Column D formulas mirror Internal ID until you switch to UUID mode.";
  t7.getCell("D2").font = { italic: true, size: 9, color: { argb: "FF6B7280" }, name: "Calibri" };

  // Row 3 — table headers
  const headers = [
    "Internal ID",
    "Category",
    "Public Display Name",
    "VW Asset / Material ID",
    "Thumbnail / Map URI",
    "Status",
  ];
  headers.forEach((h, i) => {
    const cell = t7.getRow(3).getCell(i + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  t7.getRow(3).getCell(4).fill = YELLOW_FILL;
  t7.getRow(3).getCell(4).font = { bold: true, name: "Calibri", size: 11, color: { argb: "FF111827" } };
  t7.getRow(3).height = 28;

  // Data rows from row 4
  let r = 4;
  for (const m of vendorMaterials) {
    t7.getRow(r).getCell(1).value = m.internalId || null;
    t7.getRow(r).getCell(1).font = { name: "Consolas", size: 10 };
    t7.getRow(r).getCell(2).value = m.category || null;
    t7.getRow(r).getCell(3).value = m.displayName || null;

    // If VW already pasted a real UUID under force mode, preserve it; else self-fill formula
    if (m.pastedUuid && m.pastedUuid !== m.internalId) {
      t7.getRow(r).getCell(4).value = m.pastedUuid;
    } else {
      t7.getRow(r).getCell(4).value = { formula: vwAssetIdFormula(r) };
    }
    t7.getRow(r).getCell(4).fill = YELLOW_FILL;

    t7.getRow(r).getCell(5).value = m.thumbnail || null;
    t7.getRow(r).getCell(6).value = m.status || "PENDING";
    t7.getRow(r).getCell(6).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"PENDING,BOUND,N/A"'],
    };
    r += 1;
  }

  [22, 14, 28, 36, 36, 12].forEach((w, i) => {
    t7.getColumn(i + 1).width = w;
  });
  t7.views = [{ state: "frozen", ySplit: 3 }];

  return { rows: vendorMaterials.length, mode: VW_CAPABILITY_ONE_TO_ONE };
}

function wireTab02RetailUpcharges(t2: ExcelJS.Worksheet): number {
  let headerRow = 1;
  for (let r = 1; r <= 10; r++) {
    const row = t2.getRow(r);
    for (let c = 1; c <= 20; c++) {
      if (cellText(row.getCell(c).value).includes("Pricing Grade")) {
        headerRow = r;
        break;
      }
    }
    if (headerRow > 1) break;
  }

  let updated = 0;
  for (let r = headerRow + 1; r <= Math.max(t2.rowCount, 500); r++) {
    const row = t2.getRow(r);
    const category = cellText(row.getCell(1).value);
    const internalId = cellText(row.getCell(2).value);
    if (!category && !internalId) continue;
    row.getCell(10).value = { formula: tab02RetailUpchargeFormula(r) };
    updated += 1;
  }
  return updated;
}

/**
 * Vendor-safe Tab 02: drop wholesale Dictionary Cost (COGS) and fill Hex / Preview.
 * Columns to the right of Dictionary Cost shift left to close the gap.
 */
export function sanitizeTab02ForVendors(t2: ExcelJS.Worksheet): {
  dictionaryCostRemoved: boolean;
  hexFilled: number;
  headerRow: number;
  powdersRemoved: number;
  thicknessNaFilled: number;
  dektonThicknessFilled: number;
  cosentinoFilled: number;
} {
  let headerRow = 1;
  let costCol = 0;
  let hexCol = 0;
  let idCol = 2;
  let categoryCol = 1;
  let thicknessCol = 6;
  let cosentinoCol = 9;
  let lastCol = 1;

  for (let r = 1; r <= 10; r++) {
    const row = t2.getRow(r);
    for (let c = 1; c <= 30; c++) {
      const h = cellText(row.getCell(c).value);
      if (!h) continue;
      lastCol = Math.max(lastCol, c);
      if (h.includes("Pricing Grade") || h === "Material Category") headerRow = r;
      if (h === "Dictionary Cost" || h.toLowerCase().includes("dictionary cost")) costCol = c;
      if (h.includes("Hex") && h.toLowerCase().includes("preview")) hexCol = c;
      if (h.includes("Internal ID")) idCol = c;
      if (h === "Material Category") categoryCol = c;
      if (h.includes("Thickness")) thicknessCol = c;
      if (h.includes("Cosentino")) cosentinoCol = c;
    }
    if (costCol || hexCol) break;
  }

  // Re-scan header row for accurate lastCol
  const header = t2.getRow(headerRow);
  for (let c = 1; c <= 40; c++) {
    if (cellText(header.getCell(c).value)) lastCol = Math.max(lastCol, c);
  }

  let dictionaryCostRemoved = false;
  if (costCol > 0) {
    dictionaryCostRemoved = true;
    const maxRow = Math.max(t2.rowCount, headerRow + 200);
    for (let r = 1; r <= maxRow; r++) {
      const row = t2.getRow(r);
      const hasData =
        r === headerRow ||
        cellText(row.getCell(1).value) ||
        cellText(row.getCell(idCol).value) ||
        cellText(row.getCell(costCol).value) ||
        cellText(row.getCell(Math.min(costCol + 1, lastCol)).value);
      if (!hasData && r > headerRow + 5) continue;

      for (let c = costCol; c < lastCol; c++) {
        const src = row.getCell(c + 1);
        const dest = row.getCell(c);
        dest.value = src.value;
        if (src.style) dest.style = { ...src.style };
      }
      row.getCell(lastCol).value = null;
      row.getCell(lastCol).style = {};
    }

    // Swatch / Notes image anchors: any col at/after removed cost (0-based) shifts left
    const costZeroBased = costCol - 1;
    for (const img of t2.getImages()) {
      const tl = img.range?.tl as { col?: number; row?: number } | undefined;
      if (tl && typeof tl.col === "number" && tl.col >= costZeroBased) {
        tl.col -= 1;
      }
      const br = img.range?.br as { col?: number; row?: number } | undefined;
      if (br && typeof br.col === "number" && br.col >= costZeroBased) {
        br.col -= 1;
      }
    }

    if (hexCol > costCol) hexCol -= 1;
    if (thicknessCol > costCol) thicknessCol -= 1;
    if (cosentinoCol > costCol) cosentinoCol -= 1;
    lastCol -= 1;
  }

  if (!hexCol) {
    for (let c = 1; c <= lastCol; c++) {
      const h = cellText(header.getCell(c).value);
      if (h.includes("Hex") && h.toLowerCase().includes("preview")) hexCol = c;
    }
  }
  if (!hexCol) hexCol = 14;

  // S2 — remove non-sellable powders (primer / plugs / hang wire)
  let powdersRemoved = 0;
  for (let r = Math.max(t2.rowCount, headerRow + 200); r >= headerRow + 1; r--) {
    const internalId = cellText(t2.getRow(r).getCell(idCol).value);
    if (!internalId) continue;
    if (isVendorSafeMaterialId(internalId)) continue;
    t2.spliceRows(r, 1);
    powdersRemoved += 1;
  }

  let hexFilled = 0;
  let thicknessNaFilled = 0;
  let dektonThicknessFilled = 0;
  let cosentinoFilled = 0;

  for (let r = headerRow + 1; r <= Math.max(t2.rowCount, 500); r++) {
    const row = t2.getRow(r);
    const internalId = cellText(row.getCell(idCol).value);
    const category = cellText(row.getCell(categoryCol).value);
    if (!internalId && !category) continue;

    const hex = hexPreviewForInternalId(internalId);
    if (hex) {
      row.getCell(hexCol).value = hex;
      hexFilled += 1;
    }

    const catLower = category.toLowerCase();
    const isDekton = catLower.includes("dekton") || internalId.toUpperCase().startsWith("STN-");
    const isFabricOrPowder =
      catLower.includes("upholster") ||
      catLower.includes("fabric") ||
      catLower.includes("powder") ||
      internalId.toUpperCase().startsWith("FAB-") ||
      internalId.toUpperCase().startsWith("PWD-");

    if (isFabricOrPowder && !isDekton) {
      row.getCell(thicknessCol).value = "N/A";
      thicknessNaFilled += 1;
    }

    if (isDekton) {
      const defaults = dektonDefaultsForId(internalId);
      if (defaults) {
        row.getCell(thicknessCol).value = defaults.thicknessMm;
        dektonThicknessFilled += 1;
        row.getCell(cosentinoCol).value = defaults.cosentinoGroup;
        cosentinoFilled += 1;
      } else if (!cellText(row.getCell(thicknessCol).value)) {
        // Fallback: leave blank only if unknown SKU
      }
    }
  }

  if (dictionaryCostRemoved) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = header.getCell(c);
      if (!cellText(cell.value)) continue;
      cell.fill = HEADER_FILL;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
  }

  return {
    dictionaryCostRemoved,
    hexFilled,
    headerRow,
    powdersRemoved,
    thicknessNaFilled,
    dektonThicknessFilled,
    cosentinoFilled,
  };
}

function updateChecklist(t8: ExcelJS.Worksheet, qaCount: number): void {
  let r = 2;
  while (cellText(t8.getRow(r).getCell(1).value)) r += 1;
  const rows = [
    [
      "Q&A System_Variable_Key column for Woo globals",
      "Architecture / PrimeView",
      "DONE",
      `${qaCount} keys (uppercase snake_case) — scrape col B`,
    ],
    [
      "Q&A Management Selected Option locked dropdowns",
      "Architecture",
      "DONE",
      "exceljs list validation → _QA_OPTIONS (stop on free-type)",
    ],
    [
      "Tab 03 upcharges XLOOKUP to Q&A System_Variable_Key",
      "Architecture",
      "DONE",
      "Fabric/Dekton ladders + delivery + add-ons live-wired",
    ],
    [
      "WooCommerce checkout Qs (payment/tax/ship/cancel)",
      "PrimeView",
      "DONE",
      "PAYMENT_AUTH_CAPTURE_MODE / TAXATION_STRATEGY / SHIPPING_RULE_ITEM_VS_CART / ORDER_CANCELLATION_WINDOW",
    ],
    [
      "Tab 07 VW Asset ID yellow + VW instruction lock row",
      "VividWorks",
      "OPEN",
      "C2 capability toggle + self-fill 1:1 formulas; UUID paste when forced",
    ],
    [
      "Ottoman monsoon copy on Tab 01 (removed from Q&A)",
      "Merch",
      "DONE",
      "Marketing Description updated for storage ottomans",
    ],
    [
      "Tab 02 Hex filled; Dictionary Cost (COGS) removed for vendors",
      "Security / Merch",
      "DONE",
      "Vendors see Retail Upcharge only — no wholesale Dictionary Cost",
    ],
    [
      "Wave 1 security: CostFromId stripped; sellable powders only; Q01 MSRP Multiplier",
      "Security",
      "DONE",
      "99-DICTIONARY CostFromId gone; Tab 02/07 powder allow-list (6)",
    ],
    [
      "Q&A columns streamlined (Multiplier only; no Options/Impact cols)",
      "Architecture",
      "DONE",
      "Cols: ID, Key, Category, Topic, Clarifying, Selected, Multiplier, Other_Value",
    ],
  ];
  for (const row of rows) {
    t8.getRow(r).values = row;
    r += 1;
  }
}

export async function optimizeSparkHandoff(
  target = SPARK_HANDOFF_XLSX,
): Promise<Record<string, unknown>> {
  if (!fs.existsSync(target)) throw new Error(`Missing sole handoff workbook: ${target}`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(target);

  const t1 = wb.getWorksheet(TAB01);
  const t2 = wb.getWorksheet(TAB02);
  const t3 = wb.getWorksheet(TAB03);
  const t7 = wb.getWorksheet(TAB07);
  const t8 = wb.getWorksheet(TAB08);
  if (!t1 || !t3 || !t7 || !t8) throw new Error("Required tabs missing from Spark workbook");

  // Drop legacy Management Questions List if present
  const legacy = wb.getWorksheet("Management Questions List");
  if (legacy) wb.removeWorksheet(legacy.id);

  rebuildQaOptionsSheet(wb, QA_QUESTIONS);
  rebuildQaSheet(wb, QA_QUESTIONS);
  wireTab03(t3);
  const dictionaryCost = stripDictionaryCostFromId(wb);
  const tab02Sanitize = t2 ? sanitizeTab02ForVendors(t2) : null;
  const tab02RetailRows = t2 ? wireTab02RetailUpcharges(t2) : 0;
  const tab01Stats = rewriteTab01Formulas(t1);
  const tab01Logistics = fillTab01LogisticsDefaults(t1);
  const ottomanRows = applyOttomanMarketing(t1);
  const tab07 = upgradeTab07(t7);
  updateChecklist(t8, QA_QUESTIONS.length);

  await wb.xlsx.writeFile(target);

  return {
    target,
    qaQuestions: QA_QUESTIONS.length,
    systemKeys: QA_QUESTIONS.map((q) => q.systemKey),
    removedFromQa: ["Q14 Custom Storage Ottoman Monsoon Weatherproofing"],
    qaColumns: [
      "ID",
      "System_Variable_Key",
      "Category",
      "Decision Topic",
      "Clarifying Question & Merchandising Context",
      "Management Selected Option",
      "Multiplier",
      "Other_Value",
    ],
    ottomanMarketingRows: ottomanRows,
    tab01: tab01Stats,
    tab01Logistics,
    dictionaryCost,
    tab02Sanitize,
    tab02RetailUpchargeRows: tab02RetailRows,
    tab07,
    checkoutKeys: [
      "PAYMENT_AUTH_CAPTURE_MODE",
      "TAXATION_STRATEGY",
      "SHIPPING_RULE_ITEM_VS_CART",
      "ORDER_CANCELLATION_WINDOW",
    ],
  };
}

async function main(): Promise<void> {
  const summary = await optimizeSparkHandoff();
  console.log(JSON.stringify(summary, null, 2));
}

const thisFile = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === thisFile) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
