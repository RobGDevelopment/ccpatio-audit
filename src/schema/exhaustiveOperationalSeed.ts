import type { OperationalTask, OperationalZone } from "./operationalTask";

/** Bump when the canonical seed graph changes so persisted truncated maps are replaced. */
export const EXHAUSTIVE_SEED_VERSION = 3;

const Z0: OperationalZone = "Zone 0: Inbound Marketing";
const Z1: OperationalZone = "Zone 1: CRM / Inbound Triage";
const Z2: OperationalZone = "Zone 2: CRM Pipeline";
const Z3: OperationalZone = "Zone 3: Showroom Sales (AZ/CA)";
const Z4: OperationalZone = "Zone 4: Design & Cut Lists";
const Z5: OperationalZone = "Zone 5: Middleware Core";
const Z6: OperationalZone = "Zone 6: Factory Production & QA";
const Z7: OperationalZone = "Zone 7: Logistics Dispatch";
const Z8: OperationalZone = "Zone 8: Treasury & Post-Care";

function t(
  id: string,
  title: string,
  zone: OperationalZone,
  duration: string,
  dependencies: string[],
  extras: Partial<
    Pick<
      OperationalTask,
      | "inputsRequired"
      | "outputsGenerated"
      | "digitalTriggers"
      | "techStack"
      | "nodeType"
    >
  > = {}
): OperationalTask {
  return {
    id,
    title,
    zone,
    duration,
    dependencies,
    inputsRequired: extras.inputsRequired ?? [],
    outputsGenerated: extras.outputsGenerated ?? [],
    digitalTriggers: extras.digitalTriggers ?? [],
    techStack: extras.techStack ?? [],
    nodeType: extras.nodeType ?? "standard",
  };
}

const Z0_INTAKE_IDS = [
  "traffic-meta",
  "traffic-google",
  "traffic-organic",
  "chan-phone",
  "chan-sms",
  "chan-whatsapp",
  "chan-webchat",
  "chan-social",
  "chan-email",
  "showroom-walkin",
] as const;

/**
 * Exhaustive Command Center graph: every GHL micro-stage, human hold loop,
 * AZ/CA sales swimlane, middleware hop, factory workstation, QA gate,
 * Katana↔GHL manufacturing mirror, and treasury terminal.
 */
export const EXHAUSTIVE_OPERATIONAL_TASKS: OperationalTask[] = [
  /* ── Zone 0: Inbound Marketing (parallel intake) ── */
  t("traffic-meta", "Meta / Instagram Ads", Z0, "1d", [], {
    outputsGenerated: ["Paid social click", "UTM campaign"],
    digitalTriggers: ["traffic-meta"],
    techStack: ["Meta Ads", "GHL"],
  }),
  t("traffic-google", "Google Search / Max", Z0, "1d", [], {
    outputsGenerated: ["gclid", "SEM click"],
    digitalTriggers: ["traffic-google"],
    techStack: ["Google Ads", "GHL"],
  }),
  t("traffic-organic", "SEO / Organic / Pinterest", Z0, "1d", [], {
    outputsGenerated: ["Organic session"],
    digitalTriggers: ["traffic-organic"],
    techStack: ["GHL"],
  }),
  t("chan-phone", "Inbound Phone / Voicemail", Z0, "1d", [], {
    inputsRequired: ["Caller ID"],
    digitalTriggers: ["chan-phone"],
    techStack: ["GHL"],
  }),
  t("chan-sms", "SMS / Text Messaging", Z0, "1d", [], {
    digitalTriggers: ["chan-sms"],
    techStack: ["GHL"],
  }),
  t("chan-whatsapp", "WhatsApp Business", Z0, "1d", [], {
    digitalTriggers: ["chan-whatsapp"],
    techStack: ["GHL"],
  }),
  t("chan-webchat", "Web Chat Widget", Z0, "1d", [], {
    digitalTriggers: ["chan-webchat"],
    techStack: ["GHL"],
  }),
  t("chan-social", "Social DMs (IG / Messenger)", Z0, "1d", [], {
    digitalTriggers: ["chan-social"],
    techStack: ["GHL"],
  }),
  t("chan-email", "Email Sequences", Z0, "1d", [], {
    digitalTriggers: ["chan-email"],
    techStack: ["GHL"],
  }),
  t("showroom-walkin", "Showroom Walk-in / In-Person Visit", Z0, "1d", [], {
    inputsRequired: ["Floor staff"],
    outputsGenerated: ["Walk-in contact"],
    digitalTriggers: ["showroom-walkin"],
    techStack: ["GHL"],
  }),

  /* ── Zone 1: CRM / Inbound Triage ── */
  t("ghl-hub", "GHL Unified Inbox & Workflow Router", Z1, "1d", [...Z0_INTAKE_IDS], {
    inputsRequired: ["Omnichannel contact"],
    outputsGenerated: ["Opportunity card", "Pipeline route"],
    digitalTriggers: ["ghl-hub"],
    techStack: ["GHL"],
    nodeType: "milestone",
  }),

  /* ── Zone 2: CRM Pipeline — Retail Leads ── */
  t("lead-new", "New | Uncontacted", Z2, "1d", ["ghl-hub"], {
    digitalTriggers: ["leads-pipe::lead-new"],
    techStack: ["GHL"],
  }),
  t(
    "lead-contacted-no-response",
    "Contacted | No Response",
    Z2,
    "2d",
    ["lead-new"],
    {
      inputsRequired: ["Outbound attempt"],
      digitalTriggers: ["leads-pipe::lead-contacted-no-response"],
      techStack: ["GHL"],
    }
  ),
  t(
    "lead-interested",
    "Interested | Needs Follow Up",
    Z2,
    "2d",
    ["lead-new"],
    {
      digitalTriggers: ["leads-pipe::lead-interested"],
      techStack: ["GHL"],
    }
  ),
  t(
    "lead-nurture",
    "Nurture | Needs Follow Up",
    Z2,
    "5d",
    ["lead-new", "lead-contacted-no-response"],
    {
      digitalTriggers: ["leads-pipe::lead-nurture"],
      techStack: ["GHL"],
    }
  ),
  t(
    "lead-website",
    "Website Order Form",
    Z2,
    "1d",
    ["lead-new", "lead-interested"],
    {
      outputsGenerated: ["Retail opportunity → AZ sales"],
      digitalTriggers: ["leads-pipe::lead-website"],
      techStack: ["GHL"],
    }
  ),

  /* ── Zone 2: CRM Pipeline — Trade ── */
  t("trade-app", "Application Submitted", Z2, "1d", ["ghl-hub"], {
    digitalTriggers: ["trade-pipe::trade-app"],
    techStack: ["GHL"],
  }),
  t("trade-approved", "Approved", Z2, "2d", ["trade-app"], {
    outputsGenerated: ["Trade partner → CA sales"],
    digitalTriggers: ["trade-pipe::trade-approved"],
    techStack: ["GHL"],
  }),
  t("trade-declined", "Declined", Z2, "1d", ["trade-app"], {
    digitalTriggers: ["trade-pipe::trade-declined"],
    techStack: ["GHL"],
  }),

  /* ── Zone 2: CRM Pipeline — Commercials ── */
  t("commercials-called-in", "Commercials · Called In", Z2, "1d", ["ghl-hub"], {
    digitalTriggers: ["commercials-pipe::called-in"],
    techStack: ["GHL"],
  }),
  t(
    "commercials-qualifying",
    "Commercials · Qualifying",
    Z2,
    "2d",
    ["commercials-called-in"],
    {
      outputsGenerated: ["Qualified commercial → Trade"],
      digitalTriggers: ["commercials-pipe::qualifying"],
      techStack: ["GHL"],
    }
  ),

  /* ── Zone 2: CRM Pipeline — CRM Segmentation (classification) ── */
  t(
    "crm-seg-mfr",
    "CRM Segmentation · Furniture Manufacturer",
    Z2,
    "1d",
    ["ghl-hub"],
    {
      digitalTriggers: ["crm-seg::furniture-manufacturer"],
      techStack: ["GHL"],
    }
  ),
  t(
    "crm-seg-distributor",
    "CRM Segmentation · Distributor",
    Z2,
    "1d",
    ["ghl-hub"],
    {
      digitalTriggers: ["crm-seg::distributor"],
      techStack: ["GHL"],
    }
  ),
  t(
    "crm-seg-retailer",
    "CRM Segmentation · Retailer",
    Z2,
    "1d",
    ["ghl-hub"],
    {
      digitalTriggers: ["crm-seg::retailer"],
      techStack: ["GHL"],
    }
  ),

  /* ── Zone 2: CRM Pipeline — Warranty micro-stages (before FO gate) ── */
  t("war-discovery", "Warranty · Discovery", Z2, "1d", ["ghl-hub"], {
    inputsRequired: ["Serial / photos"],
    digitalTriggers: ["warranty-pipe::war-discovery"],
    techStack: ["GHL"],
  }),
  t("war-paused", "Warranty · Paused", Z2, "3d", ["war-discovery"], {
    digitalTriggers: ["warranty-pipe::war-paused"],
    techStack: ["GHL"],
  }),
  t("war-file-claim", "Warranty · File Claim", Z2, "1d", ["war-paused"], {
    inputsRequired: ["Claim packet"],
    digitalTriggers: ["warranty-pipe::war-file-claim"],
    techStack: ["GHL"],
  }),
  t("war-claim-filed", "Warranty · Claim Filed", Z2, "2d", ["war-file-claim"], {
    digitalTriggers: ["warranty-pipe::war-claim-filed"],
    techStack: ["GHL"],
  }),
  t("war-claim-denied", "Warranty · Claim Denied", Z2, "1d", ["war-claim-filed"], {
    digitalTriggers: ["warranty-pipe::war-claim-denied"],
    techStack: ["GHL"],
  }),
  t(
    "war-claim-approved",
    "Warranty · Claim Approved",
    Z2,
    "1d",
    ["war-claim-filed"],
    {
      digitalTriggers: ["warranty-pipe::war-claim-approved"],
      techStack: ["GHL"],
    }
  ),
  t(
    "war-selecting-colors",
    "Warranty · Selecting Colors",
    Z2,
    "2d",
    ["war-claim-approved"],
    {
      digitalTriggers: ["warranty-pipe::war-selecting-colors"],
      techStack: ["GHL"],
    }
  ),
  t("war-produce-fo", "Warranty · Produce FO", Z2, "1d", ["war-selecting-colors"], {
    outputsGenerated: ["Gate 1 bypass trigger"],
    digitalTriggers: ["warranty-pipe::war-produce-fo"],
    techStack: ["GHL"],
  }),
  t(
    "war-send-to-mfg",
    "Warranty · Send To Manufacturing",
    Z2,
    "1d",
    ["produce-warranty"],
    {
      digitalTriggers: ["warranty-pipe::war-send-to-mfg"],
      techStack: ["GHL"],
    }
  ),
  t("war-claim-closed", "Warranty · Claim Closed", Z2, "1d", ["reconciled"], {
    digitalTriggers: ["warranty-pipe::war-claim-closed"],
    techStack: ["GHL"],
  }),

  /* ── Zone 3: Showroom Sales AZ (Scottsdale) ── */
  t("az-onsite", "AZ 01.D On-Site Scheduled", Z3, "2d", ["lead-website"], {
    digitalTriggers: ["sales-az::az-onsite"],
    techStack: ["GHL"],
  }),
  t(
    "az-sketchup-needed",
    "AZ 02.D SketchUp Needed | Schedule Proposal",
    Z3,
    "1d",
    ["az-onsite"],
    {
      digitalTriggers: ["sales-az::az-sketchup-needed"],
      techStack: ["GHL"],
    }
  ),
  t(
    "az-sketchup-done",
    "AZ 03.S SketchUp Done",
    Z3,
    "1d",
    ["az-sketchup-needed", "sketchup", "field-survey"],
    {
      digitalTriggers: ["sales-az::az-sketchup-done"],
      techStack: ["GHL"],
    }
  ),
  t("az-proposal", "AZ 04.S Proposal Given | Follow Up", Z3, "2d", ["az-sketchup-done"], {
    digitalTriggers: ["sales-az::az-proposal"],
    techStack: ["GHL"],
  }),
  t("az-finalize", "AZ 05.S Finalize Finishes", Z3, "2d", ["az-proposal"], {
    digitalTriggers: ["sales-az::az-finalize"],
    techStack: ["GHL"],
  }),
  t(
    "az-produce",
    "AZ 06.D Produce Factory Order",
    Z3,
    "1d",
    ["az-finalize", "bom-packet", "payment-gateway"],
    {
      outputsGenerated: ["Gate 1 trigger"],
      digitalTriggers: ["sales-az::az-produce"],
      techStack: ["GHL"],
    }
  ),
  t(
    "az-approval",
    "AZ 07.S Get Client Approval | Transfer to Manufacturing",
    Z3,
    "2d",
    ["az-produce", "produce-az"],
    {
      digitalTriggers: ["sales-az::az-approval"],
      techStack: ["GHL"],
    }
  ),
  t("az-delivered", "AZ 08. Delivered", Z3, "1d", ["az-approval", "reconciled"], {
    digitalTriggers: ["sales-az::az-delivered"],
    techStack: ["GHL"],
    nodeType: "milestone",
  }),
  t("produce-az", "AZ Produce + Won (Gate 1)", Z3, "1d", ["az-produce"], {
    outputsGenerated: ["Won opportunity", "mo_create"],
    digitalTriggers: ["produce-az"],
    techStack: ["GHL", "Inngest"],
    nodeType: "gateway",
  }),

  /* ── Zone 3: Showroom Sales CA (Solana Beach) ── */
  t(
    "ca-onsite",
    "CA 01.D On-Site Scheduled",
    Z3,
    "2d",
    ["trade-approved", "commercials-qualifying"],
    {
      digitalTriggers: ["sales-ca::ca-onsite"],
      techStack: ["GHL"],
    }
  ),
  t(
    "ca-sketchup-needed",
    "CA 02.D SketchUp Needed | Schedule Proposal",
    Z3,
    "1d",
    ["ca-onsite"],
    {
      digitalTriggers: ["sales-ca::ca-sketchup-needed"],
      techStack: ["GHL"],
    }
  ),
  t(
    "ca-sketchup-done",
    "CA 03.S SketchUp Done",
    Z3,
    "1d",
    ["ca-sketchup-needed", "sketchup", "field-survey"],
    {
      digitalTriggers: ["sales-ca::ca-sketchup-done"],
      techStack: ["GHL"],
    }
  ),
  t("ca-proposal", "CA 04.S Proposal Given | Follow Up", Z3, "2d", ["ca-sketchup-done"], {
    digitalTriggers: ["sales-ca::ca-proposal"],
    techStack: ["GHL"],
  }),
  t("ca-lost", "CA 09. Lost", Z3, "1d", ["ca-proposal"], {
    digitalTriggers: ["sales-ca::ca-lost"],
    techStack: ["GHL"],
  }),
  t("ca-finalize", "CA 05.S Finalize Finishes", Z3, "2d", ["ca-proposal"], {
    digitalTriggers: ["sales-ca::ca-finalize"],
    techStack: ["GHL"],
  }),
  t(
    "ca-produce",
    "CA 06.D Produce Factory Order",
    Z3,
    "1d",
    ["ca-finalize", "bom-packet", "payment-gateway"],
    {
      outputsGenerated: ["Gate 1 trigger"],
      digitalTriggers: ["sales-ca::ca-produce"],
      techStack: ["GHL"],
    }
  ),
  t(
    "ca-approval",
    "CA 07.S Get Client Approval",
    Z3,
    "2d",
    ["ca-produce", "produce-ca"],
    {
      digitalTriggers: ["sales-ca::ca-approval"],
      techStack: ["GHL"],
    }
  ),
  t("ca-delivered", "CA 08. Delivered", Z3, "1d", ["ca-approval", "reconciled"], {
    digitalTriggers: ["sales-ca::ca-delivered"],
    techStack: ["GHL"],
    nodeType: "milestone",
  }),
  t("produce-ca", "CA Produce + Won (Gate 1)", Z3, "1d", ["ca-produce"], {
    outputsGenerated: ["Won opportunity", "mo_create"],
    digitalTriggers: ["produce-ca"],
    techStack: ["GHL", "Inngest"],
    nodeType: "gateway",
  }),
  t(
    "produce-warranty",
    "Warranty Produce FO (Gate 1 Bypass)",
    Z3,
    "1d",
    ["war-produce-fo"],
    {
      outputsGenerated: ["Warranty remake MO"],
      digitalTriggers: ["produce-warranty"],
      techStack: ["GHL", "Inngest"],
      nodeType: "gateway",
    }
  ),

  /* ── Zone 4: Design & Cut Lists (+ Gate 0.5 deposit) ── */
  t(
    "field-survey",
    "On-Site Lidar / Survey",
    Z4,
    "1d",
    ["az-sketchup-needed", "ca-sketchup-needed"],
    {
      inputsRequired: ["On-site appointment"],
      outputsGenerated: ["Field dimensions"],
      digitalTriggers: ["field-survey"],
      techStack: ["Lidar"],
    }
  ),
  t(
    "sketchup",
    "SketchUp 3D Modeling",
    Z4,
    "5d",
    ["az-sketchup-needed", "ca-sketchup-needed"],
    {
      outputsGenerated: ["3D model", "Proposal render"],
      digitalTriggers: ["sketchup"],
      techStack: ["SketchUp"],
    }
  ),
  t("cut-lists", "Tube Cut Schedules", Z4, "2d", ["sketchup"], {
    outputsGenerated: ["Miter traveler"],
    digitalTriggers: ["cut-lists"],
    techStack: ["CAD"],
  }),
  t("bom-packet", "BOM Assembly Packet", Z4, "2d", ["cut-lists"], {
    outputsGenerated: ["SKU freeze", "Shop drawings"],
    digitalTriggers: ["bom-packet"],
    techStack: ["CAD"],
  }),
  t(
    "qbo-deposit-link",
    "QBO Payment Link (50% deposit)",
    Z4,
    "1d",
    ["az-finalize", "ca-finalize"],
    {
      digitalTriggers: ["qbo-deposit-link"],
      techStack: ["QBO"],
    }
  ),
  t(
    "clover-showroom",
    "Clover Showroom Terminal (50% deposit)",
    Z4,
    "1d",
    ["az-finalize", "ca-finalize"],
    {
      digitalTriggers: ["clover-showroom"],
      techStack: ["Clover"],
    }
  ),
  t(
    "payment-gateway",
    "Omnichannel Payment Gateway (Gate 0.5)",
    Z4,
    "1d",
    ["qbo-deposit-link", "clover-showroom"],
    {
      outputsGenerated: ["Deposit cleared"],
      digitalTriggers: ["payment-gateway"],
      techStack: ["QBO", "Clover", "Stripe"],
      nodeType: "gateway",
    }
  ),

  /* ── Zone 5: Middleware Core ── */
  t(
    "ingress",
    "Next.js Ingress API",
    Z5,
    "1d",
    ["produce-az", "produce-ca", "produce-warranty"],
    {
      inputsRequired: ["HMAC payload", "Won status"],
      digitalTriggers: ["ingress"],
      techStack: ["Next.js"],
    }
  ),
  t("redis", "Upstash Redis L1", Z5, "1d", ["ingress"], {
    digitalTriggers: ["redis"],
    techStack: ["Redis"],
  }),
  t("postgres", "Postgres Outbox & Saga", Z5, "1d", ["ingress"], {
    outputsGenerated: ["frozen_sku", "CCR claim"],
    digitalTriggers: ["postgres"],
    techStack: ["Postgres"],
  }),
  t("inngest", "Inngest Stateful CCR", Z5, "1d", ["redis", "postgres"], {
    digitalTriggers: ["inngest"],
    techStack: ["Inngest"],
  }),
  t("katana", "Katana MRP Bridge", Z5, "2d", ["inngest"], {
    outputsGenerated: ["katana_mo_id", "Manufacturing order"],
    digitalTriggers: ["katana"],
    techStack: ["Katana"],
  }),

  /* ── Zone 6: Materials forks ── */
  t("inventory-alloc", "Inventory Allocation Check", Z6, "1d", ["katana"], {
    outputsGenerated: ["In-stock vs backorder fork"],
    digitalTriggers: ["inventory-alloc"],
    techStack: ["Katana"],
  }),
  t("procurement-wait", "Procurement Wait Loop", Z6, "10d", ["inventory-alloc"], {
    inputsRequired: ["Backorder PO"],
    digitalTriggers: ["procurement-wait"],
    techStack: ["Katana"],
  }),
  t(
    "outsourced-accessories",
    "Outsourced Accessories Hold",
    Z6,
    "5d",
    ["inventory-alloc"],
    {
      outputsGenerated: ["Skip fab · umbrellas / pool chairs"],
      digitalTriggers: ["outsourced-accessories"],
      techStack: ["Katana"],
    }
  ),

  /* ── Zone 6: Physical factory workstations + QA gates ── */
  t(
    "wc-tube-stock",
    "01 Tube Metal Stock & Staging",
    Z6,
    "1d",
    ["inventory-alloc"],
    {
      digitalTriggers: ["work-centers::wc-tube-stock"],
      techStack: ["Katana"],
    }
  ),
  t("wc-chop-saw", "02 Chop Saw Cut & Miter Station", Z6, "3d", ["wc-tube-stock"], {
    digitalTriggers: ["work-centers::wc-chop-saw"],
    techStack: ["Katana"],
  }),
  t("wc-cart-parts", "03 Rolling Cart Parts Staging", Z6, "1d", ["wc-chop-saw"], {
    digitalTriggers: ["work-centers::wc-cart-parts"],
    techStack: ["Katana"],
  }),
  t("wc-tack", "4A Tack Welder Station", Z6, "2d", ["wc-cart-parts"], {
    digitalTriggers: ["work-centers::wc-tack"],
    techStack: ["Katana"],
  }),
  t("wc-weld-out", "4B Weld Out Station", Z6, "2d", ["wc-tack"], {
    digitalTriggers: ["work-centers::wc-weld-out"],
    techStack: ["Katana"],
  }),
  t("wc-grinder", "4C Grinder Station", Z6, "1d", ["wc-weld-out"], {
    digitalTriggers: ["work-centers::wc-grinder"],
    techStack: ["Katana"],
  }),
  t(
    "wc-marriage",
    "05 Component Assembly & Marriage",
    Z6,
    "1d",
    ["wc-grinder"],
    {
      digitalTriggers: ["work-centers::wc-marriage"],
      techStack: ["Katana"],
    }
  ),
  t("qc-a", "QC Gate A: Weld / Dim", Z6, "1d", ["wc-marriage"], {
    outputsGenerated: ["NCR remake on fail"],
    digitalTriggers: ["qc-gates::qc-a"],
    techStack: ["Katana"],
    nodeType: "gateway",
  }),
  t("wc-cart-blast", "06 Cart Staging → Sandblast", Z6, "1d", ["qc-a"], {
    digitalTriggers: ["work-centers::wc-cart-blast"],
    techStack: ["Katana"],
  }),
  t("wc-sandblast", "07 Surface Prep & Sandblaster", Z6, "2d", ["wc-cart-blast"], {
    digitalTriggers: ["work-centers::wc-sandblast"],
    techStack: ["Katana"],
  }),
  t("wc-powder", "08 Powder Coat & Curing Oven", Z6, "3d", ["wc-sandblast"], {
    digitalTriggers: ["work-centers::wc-powder"],
    techStack: ["Katana"],
  }),
  t("qc-b", "QC Gate B: DFT / Adhesion", Z6, "1d", ["wc-powder"], {
    digitalTriggers: ["qc-gates::qc-b"],
    techStack: ["Katana"],
    nodeType: "gateway",
  }),
  t(
    "wc-upholstery",
    "09 Custom Upholstery & Sewing",
    Z6,
    "16d",
    ["wc-tube-stock"],
    {
      digitalTriggers: ["work-centers::wc-upholstery"],
      techStack: ["Katana"],
    }
  ),
  t(
    "wc-final",
    "10 Final Assembly & Hardware",
    Z6,
    "2d",
    ["qc-b", "wc-upholstery"],
    {
      digitalTriggers: ["work-centers::wc-final"],
      techStack: ["Katana"],
    }
  ),
  t(
    "qc-c",
    "QC Gate C: Pre-Pack Photos",
    Z6,
    "1d",
    ["wc-final"],
    {
      digitalTriggers: ["qc-gates::qc-c"],
      techStack: ["Katana"],
      nodeType: "gateway",
    }
  ),

  /* ── Zone 6: Katana → GHL manufacturing mirrors (digital ∥ physical) ── */
  t("mfg-new", "GHL MFG · New FO / New SO", Z6, "1d", ["katana"], {
    digitalTriggers: ["mfg-pipe::mfg-new"],
    techStack: ["Katana", "GHL"],
  }),
  t("mfg-updated-fo", "GHL MFG · Updated FO", Z6, "1d", ["mfg-new"], {
    digitalTriggers: ["mfg-pipe::mfg-updated-fo"],
    techStack: ["Katana", "GHL"],
  }),
  t("mfg-paused", "GHL MFG · Order Paused", Z6, "3d", ["mfg-new"], {
    digitalTriggers: ["mfg-pipe::mfg-paused"],
    techStack: ["Katana", "GHL"],
  }),
  t(
    "mfg-purchasing",
    "GHL MFG · Purchasing",
    Z6,
    "2d",
    ["mfg-new", "inventory-alloc"],
    {
      digitalTriggers: ["mfg-pipe::mfg-purchasing"],
      techStack: ["Katana", "GHL"],
    }
  ),
  t(
    "mfg-receiving",
    "GHL MFG · Receiving",
    Z6,
    "2d",
    ["mfg-purchasing", "procurement-wait"],
    {
      digitalTriggers: ["mfg-pipe::mfg-receiving"],
      techStack: ["Katana", "GHL"],
    }
  ),
  t(
    "mfg-production",
    "GHL MFG · Production in Progress",
    Z6,
    "5d",
    ["mfg-receiving", "wc-chop-saw", "wc-tack"],
    {
      digitalTriggers: ["mfg-pipe::mfg-production"],
      techStack: ["Katana", "GHL"],
    }
  ),
  t(
    "mfg-ready",
    "GHL MFG · Ready for Delivery",
    Z6,
    "1d",
    ["mfg-production", "qc-c"],
    {
      digitalTriggers: ["mfg-pipe::mfg-ready"],
      techStack: ["Katana", "GHL"],
    }
  ),
  t(
    "mfg-collect-payment",
    "GHL MFG · Collect Payment",
    Z6,
    "2d",
    ["mfg-ready"],
    {
      digitalTriggers: ["mfg-pipe::mfg-collect-payment"],
      techStack: ["GHL", "QBO"],
    }
  ),
  t(
    "mfg-schedule-delivery",
    "GHL MFG · Schedule Delivery",
    Z6,
    "1d",
    ["mfg-ready"],
    {
      digitalTriggers: ["mfg-pipe::mfg-schedule-delivery"],
      techStack: ["GHL"],
    }
  ),
  t(
    "mfg-delivery-scheduled",
    "GHL MFG · Delivery Scheduled",
    Z6,
    "1d",
    ["mfg-schedule-delivery"],
    {
      digitalTriggers: ["mfg-pipe::mfg-delivery-scheduled"],
      techStack: ["GHL"],
    }
  ),
  t(
    "mfg-delivered",
    "GHL MFG · Delivered | Rejected",
    Z6,
    "1d",
    ["reconciled"],
    {
      digitalTriggers: ["mfg-pipe::mfg-delivered"],
      techStack: ["Katana", "GHL"],
    }
  ),

  /* ── Zone 7: Logistics Dispatch ── */
  t(
    "dispatch-box",
    "CCPatio Box Truck (< 500 mi)",
    Z7,
    "2d",
    ["qc-c", "mfg-delivery-scheduled"],
    {
      digitalTriggers: ["dispatch-routes::dispatch-box"],
      techStack: ["GHL"],
    }
  ),
  t(
    "dispatch-willcall",
    "Customer Will-Call / Pickup",
    Z7,
    "1d",
    ["qc-c", "mfg-ready"],
    {
      digitalTriggers: ["dispatch-routes::dispatch-willcall"],
      techStack: ["GHL"],
    }
  ),
  t(
    "dispatch-3pl",
    "3PL Freight Dispatch (> 500 mi)",
    Z7,
    "3d",
    ["qc-c", "mfg-ready"],
    {
      digitalTriggers: ["dispatch-routes::dispatch-3pl"],
      techStack: ["GHL"],
    }
  ),
  t("delivery", "White-Glove Delivery", Z7, "5d", ["dispatch-box"], {
    inputsRequired: ["Level · e-Sign · photos"],
    digitalTriggers: ["delivery"],
    techStack: ["GHL"],
    nodeType: "milestone",
  }),

  /* ── Zone 8: Treasury & Post-Care ── */
  t(
    "qbo",
    "QBO Final Invoice",
    Z8,
    "1d",
    ["delivery", "dispatch-willcall", "dispatch-3pl"],
    {
      digitalTriggers: ["qbo"],
      techStack: ["QBO"],
    }
  ),
  t("inv-waiting", "Invoice · Waiting Process", Z8, "1d", ["qbo"], {
    digitalTriggers: ["invoice-pipe::waiting"],
    techStack: ["GHL", "QBO"],
  }),
  t("inv-paid", "Invoice · Paid", Z8, "1d", ["inv-waiting"], {
    digitalTriggers: ["invoice-pipe::paid"],
    techStack: ["GHL", "QBO"],
  }),
  t("inv-overdue", "Invoice · Overdue", Z8, "3d", ["inv-waiting"], {
    digitalTriggers: ["invoice-pipe::overdue"],
    techStack: ["GHL", "QBO"],
  }),
  t("inv-not-paid", "Invoice · Not Paid", Z8, "2d", ["inv-waiting"], {
    digitalTriggers: ["invoice-pipe::not-paid"],
    techStack: ["GHL", "QBO"],
  }),
  t("clover", "Clover POS Matcher", Z8, "1d", ["qbo", "inv-paid"], {
    digitalTriggers: ["clover"],
    techStack: ["Clover"],
  }),
  t("reconciled", "Terminal Reconciled (Gate 2)", Z8, "1d", ["clover"], {
    outputsGenerated: ["invoice_create complete", "08. Delivered sync"],
    digitalTriggers: ["reconciled"],
    techStack: ["QBO", "Clover"],
    nodeType: "gateway",
  }),
  t("postcare", "NPS / Care / Warranty Registry", Z8, "1d", ["reconciled"], {
    digitalTriggers: ["postcare"],
    techStack: ["GHL"],
    nodeType: "milestone",
  }),
];

function assertExhaustiveSeed(tasks: OperationalTask[]): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (ids.size !== tasks.length) {
    const dupes = tasks.map((task) => task.id).filter((id, i, arr) => arr.indexOf(id) !== i);
    throw new Error(`Duplicate operational task ids: ${[...new Set(dupes)].join(", ")}`);
  }
  if (tasks.length < 96) {
    throw new Error(
      `Exhaustive seed must contain at least 96 tasks, got ${tasks.length}`
    );
  }
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (!ids.has(dep)) {
        throw new Error(`Task ${task.id} depends on missing node ${dep}`);
      }
      if (dep === task.id) {
        throw new Error(`Task ${task.id} depends on itself`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string, stack: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Dependency cycle: ${[...stack, id].join(" → ")}`);
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) {
      visit(dep, [...stack, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id, []);
}

assertExhaustiveSeed(EXHAUSTIVE_OPERATIONAL_TASKS);
