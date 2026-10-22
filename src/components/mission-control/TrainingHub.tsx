"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GoldBeam } from "@/components/ui/GoldBeam";
import {
  badge,
  btnPrimary,
  card,
  eyebrow,
  field,
  innerCard,
  noticeError,
} from "@/components/mission-control/soft-ui";
import { submitTrainingSignOffAction } from "@/app/embed/training/actions";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  ExternalLink,
  FileCheck2,
  ListChecks,
  PackageCheck,
  Play,
  ShieldAlert,
  ShoppingCart,
  Smartphone,
  Truck,
  Wrench,
} from "lucide-react";

export type TrainingRoleId =
  | "procurement_manager"
  | "receiving_dock"
  | "warehouse_manager"
  | "floor_foreman"
  | "line_operator"
  | "shipping_fulfillment";

export type TrainingViewMode = "full" | "cheat_sheet";

interface StepItem {
  title: string;
  detail: string;
  cheatSheetAction: string;
  subBullets?: string[];
}

interface RoleConfig {
  id: TrainingRoleId;
  label: string;
  katanaTab: string;
  subtitle: string;
  hoverDescription: string;
  videoTitle: string;
  videoWatchNote: string;
  watchUrl: string;
  steps: StepItem[];
  wipOverview?: {
    title: string;
    subtitle: string;
    description: string;
    stages: Array<{
      status: string;
      badgeColor: string;
      meaning: string;
    }>;
  };
  accountingNotice: {
    title: string;
    body: string;
    bullets?: string[];
  };
  workCenters?: Array<{
    zone: string;
    resource: string;
    operation: string;
    role: string;
  }>;
  checklist: string[];
}

/**
 * Ordered strictly to match the physical factory lifecycle:
 * 1. Procurement Manager -> 2. Receiving Dock -> 3. Warehouse Manager ->
 * 4. Floor Foreman -> 5. Line Operator -> 6. Shipping & Fulfillment
 */
const ROLES: RoleConfig[] = [
  {
    id: "procurement_manager",
    label: "Procurement Manager",
    katanaTab: "Katana STOCK & BUY Screen",
    subtitle: "Shortage Detection, Vendor Minimums & Purchase Order Generation",
    hoverDescription:
      "Responsible for monitoring raw material shortages on the Stock screen, verifying vendor minimums, and generating Purchase Orders.",
    videoTitle: "Katana Purchasing & Receiving Full Demo (Creating POs)",
    videoWatchNote: "Watch from 0:00 – 2:00",
    watchUrl: "https://www.youtube.com/watch?v=fxxbW0robyA&t=0s",
    steps: [
      {
        title: "1. Open the Stock Screen",
        detail:
          'Click the "Stock" tab in the top navigation bar and switch to the "Materials" view (FAB-*, FRM-*, PWD-*, RM-*).',
        cheatSheetAction: 'Step 1: Open the "Stock" screen and select the "Materials" tab.',
      },
      {
        title: "2. Filter for Negative Numbers (Not Available / Shortages)",
        detail:
          'Sort or filter the "Available" or "Missing / Excess" column to isolate negative numbers (Red / Not Available). These represent raw materials where Committed production demand exceeds current In-Stock quantity.',
        cheatSheetAction:
          'Step 2: Filter for negative numbers ("Not Available" / Red shortages) in the Stock columns.',
      },
      {
        title: "3. Check Vendor Minimums & Pack Sizes",
        detail:
          "Before ordering the raw deficit, verify supplier Minimum Order Quantities (MOQs), standard roll lengths (e.g., 50-yard Sunbrella rolls), extrusion bundle minimums, and lead times.",
        cheatSheetAction:
          "Step 3: Check vendor minimums (MOQs, full fabric rolls, extrusion bundle sizes).",
      },
      {
        title: "4. Click + Create PO for Shortages",
        detail:
          'Click "+ Create PO" (or click the "Buy" action button on the shortage row) to generate the Purchase Order for the supplier, verify unit cost, and submit.',
        cheatSheetAction: 'Step 4: Click "+ Create PO" for all flagged material shortages.',
        subBullets: [
          "Verify the default Supplier and Purchase Price per unit match the vendor's current rate sheet.",
          "Set the Expected Arrival Date based on the vendor's confirmed transit window so the Foreman sees accurate Yellow (Expected) badges on the Make screen.",
        ],
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (PURCHASE ORDERS & VENDOR BILLING)",
      body: "Purchase Order unit costs in Katana set the exact material prices used when the Receiving Dock marks the PO Received and automatically creates the Vendor Bill in QuickBooks Online.",
      bullets: [
        "Always verify the unit cost and unit of measure on the PO before sending it to the vendor.",
        "Never create duplicate POs for a custom showroom shortage that has already auto-generated a PO-PA-* document.",
      ],
    },
    checklist: [
      "Review the Stock -> Materials screen every morning at 7:30 AM for negative Available balances.",
      "Verify vendor minimums and standard roll/bundle pack sizes before issuing POs.",
      "Update Expected Arrival Dates on open POs so the Floor Foreman has accurate material arrival dates.",
    ],
  },
  {
    id: "receiving_dock",
    label: "Receiving Dock",
    katanaTab: "Katana BUY Screen",
    subtitle: "Inbound Raw Materials, Freight Inspection & PO Receiving",
    hoverDescription:
      "Responsible for unloading freight, inspecting incoming raw materials against packing slips, and receiving Purchase Orders.",
    videoTitle: "Katana Purchasing & Receiving Full Demo (Receiving Freight)",
    videoWatchNote: "Watch from 2:00 – 4:30",
    watchUrl: "https://www.youtube.com/watch?v=fxxbW0robyA&t=120s",
    steps: [
      {
        title: "1. Collect Documentation",
        detail:
          "Obtain the physical Packing Slip and Bill of Lading (BOL) from the freight driver before signing for the delivery.",
        cheatSheetAction: "Grab physical Packing Slip & BOL from the freight driver before signing.",
      },
      {
        title: "2. Open the Buy Screen",
        detail:
          'Log into Katana on the Receiving Station desktop/tablet and tap the "Buy" tab in the top navigation bar.',
        cheatSheetAction: 'Open Katana -> Tap the "Buy" tab.',
      },
      {
        title: "3. Locate the Purchase Order (PO)",
        detail:
          "Search by PO Number (e.g., PO-PA-...) or filter by Supplier Name (e.g., Sunbrella / Glen Raven, Tiger Drylac, Dekton) and tap the row to open line items.",
        cheatSheetAction: "Search matching PO # or Supplier Name and open the PO.",
      },
      {
        title: "4. Physical Count & Quality Inspection",
        detail:
          "Inspect all pallets, extrusion tubes, and fabric rolls for freight damage prior to releasing the driver. Verify that the Unit of Measure on the packing slip matches Katana (Linear Feet vs. Sticks, Yards vs. Rolls, Pounds vs. Boxes).",
        cheatSheetAction: "Count physical units unloaded & verify Unit of Measure matches Katana.",
      },
      {
        title: '5. Update Status to "Received" (or "Partially received")',
        detail:
          'If 100% of the items arrived undamaged and match expected quantities, tap the Delivery Status dropdown and select "Received".',
        cheatSheetAction:
          'Select "Received" (if 100% complete) OR "Partially received" (enter exact quantity unloaded today).',
        subBullets: [
          'Partial Delivery / Freight Damage: Do NOT tap full "Received". Select "Partially received" and enter the exact physical quantity unloaded in good condition today.',
          "Record the carrier tracking number and any damage notes in the PO Additional Info field.",
        ],
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (PO RECEIVING)",
      body: 'The exact moment you tap "Received" on a Purchase Order, Our Custom Software automatically creates a Vendor Bill in QuickBooks Online and updates Raw Materials Inventory so ownership can pay the vendor.',
      bullets: [
        'NEVER mark a PO as "Received" based on an emailed invoice or carrier tracking notice alone.',
        'ONLY mark "Received" when the physical material is sitting on the CC Patio receiving dock and has been counted.',
      ],
    },
    checklist: [
      "Inspect all inbound freight for damage before signing carrier BOL.",
      'Match every delivery to an open PO on the "Buy" screen.',
      'Mark full deliveries "Received" or short deliveries "Partially received" within 15 minutes of unloading.',
    ],
  },
  {
    id: "warehouse_manager",
    label: "Warehouse Manager",
    katanaTab: "Katana STOCK Screen",
    subtitle: "Weekly Cycle Counting, Stock Adjustments & Showroom Hold Integrity",
    hoverDescription:
      "Responsible for weekly physical cycle counts, recording Stock Adjustments, and maintaining First-In, First-Out dye lot integrity.",
    videoTitle: "Katana Inventory Management Tutorial",
    videoWatchNote: "Watch Full Video",
    watchUrl: "https://www.youtube.com/watch?v=c-JWBGA1mcY&t=0s",
    steps: [
      {
        title: "1. Open the Stock Screen",
        detail: 'Tap the "Stock" tab in the top navigation bar.',
        cheatSheetAction: 'Open Katana -> Tap the "Stock" tab.',
      },
      {
        title: "2. Verify Current System Stock",
        detail:
          'Filter between Products (FIN-*, ASM-*) and Materials (FAB-*, FRM-*, PWD-*, RM-*). Review "In stock" (physical shelf qty) vs. "Committed" (allocated to open orders) and "Available".',
        cheatSheetAction: 'Filter Materials (FAB-*, FRM-*, PWD-*) and review the "In stock" column.',
      },
      {
        title: "3. Initiate a Stock Adjustment",
        detail:
          'Tap the global "+" icon in the top-right corner of Katana and select "Stock adjustment".',
        cheatSheetAction: 'Tap global "+" icon (top right) -> Select "Stock adjustment".',
      },
      {
        title: "4. Log the Adjustment & Standardized Reason Code",
        detail:
          "Search for the exact SKU (e.g., FAB-SUN-5404 Sunbrella Canvas Natural) and enter the Actual In-Stock Quantity so Katana matches the physical shelf count.",
        cheatSheetAction:
          "Enter Reason Code (e.g., CYCLE-COUNT), search SKU, and input Actual In-Stock Quantity.",
        subBullets: [
          "CYCLE-COUNT: Weekly physical audit",
          "DAMAGE-SCRAP: Forklift / water / warehouse damage",
          "CUT-VARIANCE: Remnant / roll-end yardage reconciliation",
          'Showroom Holds (HOLD-*): Never delete or manually ship HOLD-* orders. They reserve showroom stock for 14 days and convert automatically to GHL-* orders upon deposit.',
        ],
      },
      {
        title: "5. Complete Adjustment",
        detail: 'Review the Cost per unit and total value impact, then tap "Done" / "Save".',
        cheatSheetAction: 'Review unit cost impact and tap "Done" / "Save".',
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (QUICKBOOKS INVENTORY UPDATE)",
      body: "Stock Adjustments directly update our live inventory counts and dollar values in QuickBooks Online. Any single stock adjustment exceeding $250.00 in material value requires dual sign-off from the Factory Plant Manager in the Reason field.",
    },
    checklist: [
      "Execute Friday afternoon physical cycle counts on the Stock screen via Stock Adjustments.",
      "Store and pull Sunbrella rolls (FAB-*) and Tiger Drylac powder (PWD-*) on a strict First-In, First-Out (FIFO) basis.",
      "Never mix two different Sunbrella dye lots on the same customer Sales Order.",
    ],
  },
  {
    id: "floor_foreman",
    label: "Floor Foreman",
    katanaTab: "Katana MAKE & TASKS Screen",
    subtitle: "Master Build Queue, Live Floor Progress, Work Center Filtering & Order Completion",
    hoverDescription:
      "Responsible for prioritizing the Make queue, filtering Tasks by physical Work Centers, bulk-assigning operators, and marking completed builds Done.",
    videoTitle: "How Katana Smart Manufacturing Works (Production & Scheduling)",
    videoWatchNote: "Watch from 0:45 – 2:20",
    watchUrl: "https://www.youtube.com/watch?v=OwoSsyzTtZg&t=45s",
    steps: [
      {
        title: "1. Priority Ranking on the Master Build Queue (Make -> Schedule)",
        detail:
          'Tap the "Make" tab. Manufacturing Orders (MOs) at the top of the list (Rank 1, 2, 3...) are the highest priority. Verify that custom showroom orders (PA-*) have their 3D Digital Cut Card link attached.',
        cheatSheetAction:
          'Open "Make" -> "Schedule". Top rows = highest priority. Verify 3D Cut Cards are attached.',
      },
      {
        title: "2. Never Release Red Material Orders to the Floor",
        detail: 'Check the "Ingredients" column before releasing any order to operators:',
        cheatSheetAction:
          'Check "Ingredients" column: ONLY release Green (In stock) orders. Hold Yellow/Red orders.',
        subBullets: [
          "🟢 In stock (Green): All extrusions, fabrics, powder, and Pre-Built Parts are on hand. Safe to start.",
          "🟡 Expected (Yellow): Waiting on an open Purchase Order delivery. Hold until Receiving marks the PO Received.",
          "🔴 Not available (Red): Material shortage detected. Do NOT start.",
          "3D Extraction Variance Rule: If the 3D Engine extracted a material quantity incorrectly, adjust the 'Ingredients' on the specific Manufacturing Order (NEVER edit the Master BOM).",
        ],
      },
      {
        title: "3. Task Scheduling & Work Center Filtering (Make -> Tasks View)",
        detail:
          'Tap the "Tasks" sub-tab inside Make. Filter the "Resource" column by your physical Work Center (e.g., Metal Cutting, FAB POD A/B/C, Powder Coating Booth, Fabric Sewing) and bulk-select tasks using the left checkboxes to assign them to specific operators for the shift.',
        cheatSheetAction:
          'Open "Make" -> "Tasks", filter by physical Work Center (Resource), and bulk-assign tasks to operators.',
        subBullets: [
          "Load-Level Welding Pods: Standard tracks default to FAB POD A. Re-route overflow orders to FAB POD B or FAB POD C to balance shift capacity.",
          "Make-to-Stock Pre-Built Parts: During off-peak hours, create Make-to-Stock Manufacturing Orders on the Make screen for approved ASM-*-FRAME and ASM-*-CUSH Pre-Built Parts so frames and cushions sit ready in stock.",
        ],
      },
      {
        title: "4. Real-Time Work-In-Progress (WIP) Overview Tracking",
        detail:
          'Monitor the "Production Status" column on the Make -> Schedule screen as it transitions across Not Started -> Work in Progress -> Done. As line operators tap Start, Pause, and Finish on their workstation tablets, this column updates live—allowing you to view real-time factory operations and bottleneck stations from your desk without walking the floor.',
        cheatSheetAction:
          'Read the "Production Status" column (Not Started -> Work in Progress -> Done) to monitor live floor progress without walking the floor.',
      },
      {
        title: '5. Final Quality Control & Closing Manufacturing Orders ("Done")',
        detail:
          'When all operations on a Manufacturing Order are finished and the piece passes Final Quality Control and Assembly & Packaging, change the MO Status dropdown to "Done".',
        cheatSheetAction:
          'After Final QC passes, change the MO Status dropdown to "Done" to trigger the QuickBooks Inventory Update.',
      },
    ],
    wipOverview: {
      title: "Reading the Real-Time Work-In-Progress (WIP) Overview",
      subtitle: "Monitor live floor execution without walking the shop floor",
      description:
        "Tracking the Production Status column across Not Started -> Work in Progress -> Done gives the Floor Foreman a live radar of every order across the 1st Floor (Metal/Powder) and 2nd Floor (Upholstery) driven directly by operator tablet clicks:",
      stages: [
        {
          status: "Not Started",
          badgeColor: "bg-slate-100 text-slate-800 ring-slate-300",
          meaning:
            "Order is queued in the schedule; no operator has tapped Start on Sequence 10 (Metal Cutting / Fabric Cutting) yet.",
        },
        {
          status: "Work in Progress",
          badgeColor: "bg-amber-100 text-amber-900 ring-amber-300",
          meaning:
            "Active on the shop floor. Hover/click the status pill to see which exact Work Center (e.g., FAB POD A, Powder Coating Booth, Fabric Sewing) is currently running or completed.",
        },
        {
          status: "Done",
          badgeColor: "bg-emerald-100 text-emerald-900 ring-emerald-300",
          meaning:
            "All operations and Final QC are complete. Raw materials and labor automatically trigger a QuickBooks Inventory Update into Finished Goods.",
        },
      ],
    },
    workCenters: [
      {
        zone: "1st Floor — Metal",
        resource: "Metal Cutting",
        operation: "Cold Saw Fabrication (Seq 10)",
        role: "Saw Operator",
      },
      {
        zone: "1st Floor — Metal",
        resource: "FAB POD A / B / C",
        operation: "Fabrication & Welding (Seq 20)",
        role: "Master Welder",
      },
      {
        zone: "1st Floor — Finishing",
        resource: "Sandblasting",
        operation: "Sandblast (Seq 30)",
        role: "Blast Booth Operator",
      },
      {
        zone: "1st Floor — Finishing",
        resource: "Powder Coating Booth",
        operation: "Powder Coat — Active Labor (Seq 40)",
        role: "Powder Tech",
      },
      {
        zone: "1st Floor — Finishing",
        resource: "Curing Oven",
        operation: "Cure — Passive Oven Dwell (Seq 50)",
        role: "Powder Tech",
      },
      {
        zone: "2nd Floor — Soft Goods",
        resource: "Fabric Cutting",
        operation: "Fabric Cut (Seq 10)",
        role: "Cutter / CNC Table",
      },
      {
        zone: "2nd Floor — Soft Goods",
        resource: "Fabric Sewing",
        operation: "Sew (Seq 20)",
        role: "Seamstress",
      },
      {
        zone: "2nd Floor — Soft Goods",
        resource: "Cushion Stuffing",
        operation: "Stuff (Seq 30)",
        role: "Cushion Finisher",
      },
      {
        zone: "Specialty Pod — Stone",
        resource: "Dekton Fabrication",
        operation: "Dekton Fabrication (Seq 10)",
        role: "Stone CNC Operator",
      },
      {
        zone: "Convergence — Final",
        resource: "Quality Control",
        operation: "Upholstery QC / Final QC",
        role: "QC Inspector",
      },
      {
        zone: "Convergence — Final",
        resource: "Assembly & Packaging",
        operation: "Assemble & Pack (Seq 20)",
        role: "Pack & Skid Crew",
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (MO COMPLETION & QUICKBOOKS INVENTORY UPDATE)",
      body: 'The exact moment a Manufacturing Order is marked "Done", Our Custom Software automatically posts a QuickBooks Inventory Update moving Raw Materials, Packaging, and Tracked Labor into Finished Goods Inventory.',
      bullets: [
        "If the 3D Engine extracted a material quantity with a variance, adjust the Ingredients on the specific Manufacturing Order—NEVER edit the Master Product Recipe.",
      ],
    },
    checklist: [
      "6:45 AM: Review Make -> Schedule, verify Ingredients are Green (In stock), and confirm 3D Cut Cards are attached.",
      "6:50 AM: Open Make -> Tasks, filter by physical Resource, and bulk-assign shifts to operators.",
      "Monitor the Production Status column (Not Started -> Work in Progress -> Done) to track real-time floor progress.",
      "Mid-Shift & End-of-Shift: Audit the Tasks view to ensure no operator left an active timer running over lunch or overnight.",
      'Continuous: Inspect completed builds and mark verified Manufacturing Orders "Done".',
    ],
  },
  {
    id: "line_operator",
    label: "Line Operator",
    katanaTab: "Katana SHOP FLOOR APP (Tablet)",
    subtitle: "PIN/QR Login, Digital 3D Cut Cards, Start/Pause/Finish Timers & Scrap Reporting",
    hoverDescription:
      "Responsible for logging into workstation tablets, viewing 3D Digital Cut Cards, tracking exact Start/Pause/Finish times, and reporting actual materials used.",
    videoTitle: "How Katana Smart Manufacturing Works (Shop Floor App UI)",
    videoWatchNote: "Watch from 2:20 – End for Shop Floor UI",
    watchUrl: "https://www.youtube.com/watch?v=OwoSsyzTtZg&t=140s",
    steps: [
      {
        title: "1. Tablet Login (6-Digit PIN or QR Badge)",
        detail:
          "Wake your workstation tablet and enter your personal 6-digit PIN code or scan your laminated Employee QR Badge. Always tap Log out before leaving for lunch or end of shift.",
        cheatSheetAction: "Log into tablet via 6-digit PIN or QR Badge (Log out at lunch/shift end).",
      },
      {
        title: "2. Work Your Queue Top-to-Bottom",
        detail:
          'Your tablet opens directly to "My Tasks" sorted by Foreman priority. Always work strictly from the top task downward—never cherry-pick down the list.',
        cheatSheetAction: 'Work strictly from the top of "My Tasks" downward.',
      },
      {
        title: "3. Open Task Instructions & 3D Digital Cut Card",
        detail:
          "Tap the top task to view the SKU, Target Quantity, and Notes. For Metal Cutting & Welding (FAB POD A/B/C), tap the attached Digital Cut Card link (/factory/cut-cards/[token]) to view the 3D render, exact tube lengths, and mitre angles.",
        cheatSheetAction: "Tap task -> Open the Digital Cut Card link for exact 3D lengths & mitre angles.",
      },
      {
        title: "4. Mandatory Time Tracking (START / PAUSE / FINISH)",
        detail:
          "Every operation has a target build time, and our accounting system requires your exact start and stop timestamps:",
        cheatSheetAction:
          "Tap 🟢 START when beginning work, 🟡 PAUSE for any stop > 3 mins, and 🔵 FINISH when 100% complete.",
        subBullets: [
          "🟢 START (Green): Tap the exact moment you begin physical setup or work on the piece.",
          "🟡 PAUSE (Yellow): Tap immediately for breaks, lunch, machine maintenance, blade/gas changes, or waiting for materials (any stop > 3 minutes).",
          "🔵 FINISH (Blue): Tap the exact moment the physical operation is 100% complete, self-inspected, and placed in the outbound rack.",
        ],
      },
      {
        title: "5. Reporting Actual Material Usage & Scrap",
        detail:
          'When tapping Finish, confirm the "Actual Consumed" materials. If you had to re-cut an aluminum tube, pull extra Sunbrella yardage due to a flaw, or if the 3D Engine extracted a slightly off quantity, you MUST update the Actual Consumed quantity on the tablet so inventory and QuickBooks stay 100% accurate.',
        cheatSheetAction:
          'Update "Actual Consumed" on your tablet before finishing if you recut a tube, wasted fabric, or spotted a 3D extraction variance.',
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (SHOP FLOOR TIME TRACKING & LABOR)",
      body: "Accurate Start, Pause, and Finish times on the Katana Shop Floor App are MANDATORY. Our Custom Software uses your exact tracked minutes to automatically record Direct Labor costs in QuickBooks Online.",
      bullets: [
        'NEVER "batch-click" Start and Finish back-to-back at the end of your shift (0m 02s corrupts labor costing).',
        "NEVER leave a task timer running overnight.",
      ],
    },
    checklist: [
      "Log into the Katana Shop Floor App using your personal 6-Digit PIN or QR Badge.",
      "Work strictly from the top of My Tasks downward.",
      "Open the 3D Digital Cut Card link before cutting or welding.",
      "Tap Start when beginning work, Pause for any break > 3 minutes, and Finish immediately upon completion.",
      "Update Actual Consumed quantities if any tube recut or extra fabric scrap occurred.",
    ],
  },
  {
    id: "shipping_fulfillment",
    label: "Shipping & Fulfillment",
    katanaTab: "Katana SELL Screen",
    subtitle: "Outbound Staging, Marking Orders Packed/Delivered & QuickBooks Accounting",
    hoverDescription:
      "Responsible for staging completed skids on the outbound dock, verifying carrier Bills of Lading, and marking Sales Orders Packed and Delivered.",
    videoTitle: "How Katana Smart Manufacturing Works (Fulfillment & Delivery)",
    videoWatchNote: "Watch Full Overview",
    watchUrl: "https://www.youtube.com/watch?v=OwoSsyzTtZg&t=0s",
    steps: [
      {
        title: "1. Open the Sell Screen & Filter Ready Orders",
        detail:
          'Click the "Sell" tab in the top navigation bar. Filter "Sales items" (Product Availability) to "In stock" (Green) and "Manufacturing" status to "Done". Verify the order prefix is PA-*, GHL-*, or WOO-* (NEVER ship a HOLD-* reservation).',
        cheatSheetAction:
          'Step 1: Open the "Sell" screen and filter for Sales items "In stock" (Green) & Manufacturing "Done".',
      },
      {
        title: "2. Verify Packaging Mode & Stage on Dock",
        detail:
          "Print the Packing Slip and verify every line item against the physical skids staged in the Shipping Bay. Confirm whether cushions are married to the frame (standard) or vacuum-sealed in corrugated boxes (vacuum_compressed).",
        cheatSheetAction:
          "Step 2: Match physical skids/boxes to the Packing Slip and confirm carrier routing (Priority1, FedEx Freight, Shippo, or Fleet).",
      },
      {
        title: '3. Mark Sales Order as "Packed"',
        detail:
          'Once the order is wrapped, strapped to the pallet with edge board and stretch film, and staged in the outbound bay awaiting carrier pickup, change the Sales Order Delivery Status dropdown from "Not shipped" to "Packed".',
        cheatSheetAction:
          'Step 3: Change Delivery Status from "Not shipped" to "Packed" once skids are wrapped and staged on the dock.',
      },
      {
        title: '4. Final Dispatch — Mark Sales Order as "Delivered"',
        detail:
          'Once the LTL freight driver signs the Bill of Lading (BOL) and departs the dock—or our Internal Fleet completes white-glove delivery—record the PRO / Tracking Number and change the Delivery Status dropdown to "Delivered" (or "Partially delivered" for split shipments).',
        cheatSheetAction:
          'Step 4: Record BOL/PRO tracking and change status to "Delivered" the moment the truck departs.',
        subBullets: [
          "Strict Warning: Marking a Sales Order Delivered instantly records final Sales Revenue and product costs in QuickBooks Online.",
          "Never mark an order Delivered before the truck physically leaves the dock or while a customer balance hold is unresolved.",
        ],
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (ORDER DELIVERY & QUICKBOOKS UPDATE)",
      body: "Marking a Sales Order Delivered instantly records final Sales Revenue and product costs in QuickBooks Online, deducts the finished piece from inventory, and marks the customer order complete in GoHighLevel.",
      bullets: [
        "1. QuickBooks Sales Update: Finalizes the customer invoice and applies their deposit.",
        "2. QuickBooks Inventory Update: Moves the finished furniture piece out of warehouse inventory.",
        "3. GoHighLevel Update: Automatically notifies the showroom team that the order has shipped.",
      ],
    },
    checklist: [
      'Filter the "Sell" screen for orders with Sales items: In stock and Manufacturing: Done.',
      "Verify order prefix is PA-*, GHL-*, or WOO-* (Never ship a HOLD-* order).",
      'Change status to "Packed" when skids are strapped and staged in the outbound bay.',
      'Record carrier BOL / PRO tracking and mark "Delivered" immediately upon truck departure.',
    ],
  },
];

export function TrainingHub() {
  // Phase 1: Progressive Disclosure Gatekeeper State
  const [unlockedRules, setUnlockedRules] = useState<number>(1);
  const [rule1Checked, setRule1Checked] = useState(false);
  const [rule2Checked, setRule2Checked] = useState(false);
  const [rule3Checked, setRule3Checked] = useState(false);
  const [acknowledgedQbo, setAcknowledgedQbo] = useState(false);
  const [employeeName, setEmployeeName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [protocolSigned, setProtocolSigned] = useState<{
    confirmationId: string;
    employeeName: string;
    signedAtIso: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Phase 2 & 3: Clean Role Selector (null initially until clicked) & Hover Tooltip
  const [selectedRole, setSelectedRole] = useState<TrainingRoleId | null>(null);
  const [hoveredRole, setHoveredRole] = useState<TrainingRoleId | null>(null);
  const [viewMode, setViewMode] = useState<TrainingViewMode>("full");

  const activeRole = ROLES.find((r) => r.id === selectedRole) ?? null;

  function handleRule1Toggle(checked: boolean) {
    setRule1Checked(checked);
    if (checked && unlockedRules < 2) {
      setUnlockedRules(2);
    }
  }

  function handleRule2Toggle(checked: boolean) {
    setRule2Checked(checked);
    if (checked && unlockedRules < 3) {
      setUnlockedRules(3);
    }
  }

  function handleRule3Toggle(checked: boolean) {
    setRule3Checked(checked);
    if (checked && unlockedRules < 4) {
      setUnlockedRules(4);
    }
  }

  function handleGatekeeperSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    if (!rule1Checked || !rule2Checked || !rule3Checked) {
      setFormError("Please read and check all three Golden Rules before signing off.");
      return;
    }

    startTransition(async () => {
      const result = await submitTrainingSignOffAction({
        employeeName,
        roleId: selectedRole ?? "factory_protocol",
        roleLabel: activeRole?.label ?? "Mandatory Factory Protocol",
        acknowledgedQboImpact: acknowledgedQbo,
      });

      if (!result.ok) {
        setFormError(result.error);
        return;
      }

      setProtocolSigned({
        confirmationId: result.confirmationId,
        employeeName: result.employeeName,
        signedAtIso: result.signedAtIso,
      });
    });
  }

  return (
    <div className="space-y-8" data-testid="training-hub">
      {/* Top Portal Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div>
          <div className={eyebrow}>Shop Floor Tablet Portal • SOP-OPS-KATANA-002 v2.3</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Katana MRP Digital Training Hub
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {protocolSigned
              ? "Protocol verified. Select your factory workstation role below to unlock your training module."
              : "Complete the Mandatory Factory Protocol gatekeeper below to unlock role training."}
          </p>
        </div>

        {protocolSigned && (
          <div
            className="inline-flex items-center rounded-2xl bg-slate-100 p-1.5 transition-all duration-500"
            role="group"
            aria-label="Training view mode toggle"
            data-testid="training-mode-toggle"
          >
            <button
              type="button"
              data-testid="mode-btn-full"
              aria-pressed={viewMode === "full"}
              onClick={() => setViewMode("full")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                viewMode === "full"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <BookOpen className="h-4 w-4 text-[#D4AF37]" />
              Full Training
            </button>
            <button
              type="button"
              data-testid="mode-btn-cheat-sheet"
              aria-pressed={viewMode === "cheat_sheet"}
              onClick={() => setViewMode("cheat_sheet")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                viewMode === "cheat_sheet"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ListChecks className="h-4 w-4 text-[#D4AF37]" />
              Cheat Sheet
            </button>
          </div>
        )}
      </div>

      {/* PHASE 1: THE GATEKEEPER (PROGRESSIVE RULES) OR COLLAPSED FOREST GREEN BANNER */}
      <AnimatePresence mode="wait">
        {!protocolSigned ? (
          <motion.section
            key="gatekeeper-expanded"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45 }}
            aria-label="Mandatory Factory Protocol"
            data-testid="golden-rules-banner"
            className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:p-8"
          >
            <GoldBeam />
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3.5">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-[#D4AF37] shadow-sm">
                  <ShieldAlert className="h-6 w-6" />
                </span>
                <div>
                  <div className={eyebrow}>Step 0 — Cognitive Safety Gatekeeper</div>
                  <h2 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">
                    MANDATORY FACTORY PROTOCOL
                  </h2>
                </div>
              </div>
              <span className="rounded-full bg-amber-50 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-900">
                Rule {Math.min(unlockedRules, 3)} of 3 Unlocked
              </span>
            </div>

            <div className="mt-6 space-y-6">
              {/* RULE #1 (Visible Immediately) */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                data-testid="golden-rule-1"
                className={`rounded-2xl p-6 transition-all duration-500 ${
                  rule1Checked
                    ? "bg-emerald-950/[0.03] shadow-xs"
                    : "bg-slate-50 shadow-[0_4px_20px_rgb(0,0,0,0.03)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-widest text-rose-800">
                    RULE #1: NO MANUAL ORDERS
                  </span>
                  {rule1Checked && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Confirmed
                    </span>
                  )}
                </div>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  NEVER MANUALLY CREATE SALES ORDERS IN KATANA.
                </p>
                <p className="mt-1.5 text-base leading-relaxed text-slate-700">
                  Sales Orders (
                  <code className="font-mono text-sm font-semibold text-slate-900">PA-*</code>,{" "}
                  <code className="font-mono text-sm font-semibold text-slate-900">GHL-*</code>,{" "}
                  <code className="font-mono text-sm font-semibold text-slate-900">WOO-*</code>) are
                  automatically pushed by Our Custom Software the exact second a customer pays their{" "}
                  <span className="font-semibold text-slate-900">50% deposit</span>.
                </p>

                <label
                  htmlFor="ack-rule-1"
                  className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl bg-white p-4 shadow-xs transition hover:bg-slate-50"
                >
                  <input
                    id="ack-rule-1"
                    type="checkbox"
                    checked={rule1Checked}
                    onChange={(e) => handleRule1Toggle(e.target.checked)}
                    data-testid="checkbox-rule-1"
                    className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-[#D4AF37]"
                  />
                  <span className="text-base font-semibold text-slate-900">
                    I understand and agree to Rule #1.
                  </span>
                </label>
              </motion.div>

              {/* RULE #2 (Fades in when Rule #1 is checked) */}
              <AnimatePresence>
                {unlockedRules >= 2 && (
                  <motion.div
                    key="rule-2-block"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    data-testid="golden-rule-2"
                    className={`rounded-2xl p-6 transition-all duration-500 ${
                      rule2Checked
                        ? "bg-emerald-950/[0.03] shadow-xs"
                        : "bg-slate-50 shadow-[0_4px_20px_rgb(0,0,0,0.03)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-widest text-amber-800">
                        RULE #2: NO MANUAL RECIPES (BOMs)
                      </span>
                      {rule2Checked && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Confirmed
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      NEVER EDIT MASTER PRODUCT RECIPES.
                    </p>
                    <p className="mt-1.5 text-base leading-relaxed text-slate-700">
                      If the 3D Engine extracts data incorrectly, DO NOT edit the Master BOM. The
                      Foreman must adjust the &apos;Ingredients&apos; on the specific Manufacturing
                      Order, OR the Line Operator must report &apos;Actual Consumed&apos; amounts on
                      their tablet. Report all 3D errors to the System Admin.
                    </p>

                    <label
                      htmlFor="ack-rule-2"
                      className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl bg-white p-4 shadow-xs transition hover:bg-slate-50"
                    >
                      <input
                        id="ack-rule-2"
                        type="checkbox"
                        checked={rule2Checked}
                        onChange={(e) => handleRule2Toggle(e.target.checked)}
                        data-testid="checkbox-rule-2"
                        className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-[#D4AF37]"
                      />
                      <span className="text-base font-semibold text-slate-900">
                        I understand and agree to Rule #2.
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* RULE #3 (Fades in when Rule #2 is checked) */}
              <AnimatePresence>
                {unlockedRules >= 3 && (
                  <motion.div
                    key="rule-3-block"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    data-testid="golden-rule-3"
                    className={`rounded-2xl p-6 transition-all duration-500 ${
                      rule3Checked
                        ? "bg-emerald-950/[0.03] shadow-xs"
                        : "bg-slate-50 shadow-[0_4px_20px_rgb(0,0,0,0.03)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-800">
                        RULE #3: LIVE QUICKBOOKS ACCOUNTING
                      </span>
                      {rule3Checked && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Confirmed
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      EVERY CLICK UPDATES QUICKBOOKS LIVE.
                    </p>
                    <p className="mt-1.5 text-base leading-relaxed text-slate-700">
                      Every button you click in Katana automatically updates our live accounting in
                      QuickBooks. Never click Done or Received until the physical work is actually
                      finished.
                    </p>

                    <label
                      htmlFor="ack-rule-3"
                      className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl bg-white p-4 shadow-xs transition hover:bg-slate-50"
                    >
                      <input
                        id="ack-rule-3"
                        type="checkbox"
                        checked={rule3Checked}
                        onChange={(e) => handleRule3Toggle(e.target.checked)}
                        data-testid="checkbox-rule-3"
                        className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-[#D4AF37]"
                      />
                      <span className="text-base font-semibold text-slate-900">
                        I understand and agree to Rule #3.
                      </span>
                    </label>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* FINAL QBO ACKNOWLEDGMENT + EMPLOYEE SIGN-OFF FORM (Fades in when Rule #3 is checked) */}
              <AnimatePresence>
                {unlockedRules >= 4 && (
                  <motion.div
                    key="final-signoff-block"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    data-testid="accountability-signoff-section"
                    className="rounded-2xl bg-slate-900 p-6 text-white shadow-[0_14px_40px_-8px_rgba(212,175,55,0.3)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#D4AF37]">
                        <FileCheck2 className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="text-xs font-bold uppercase tracking-widest text-[#D4AF37]">
                          Final Gatekeeper Verification
                        </div>
                        <h3 className="text-lg font-bold text-white">
                          Sign Off to Unlock Factory Role Training
                        </h3>
                      </div>
                    </div>

                    <form onSubmit={handleGatekeeperSubmit} className="mt-5 space-y-4" noValidate>
                      <label
                        htmlFor="training-qbo-ack"
                        className="flex cursor-pointer items-center gap-3 rounded-xl bg-white/10 p-4 transition hover:bg-white/15"
                      >
                        <input
                          id="training-qbo-ack"
                          name="acknowledgedQboImpact"
                          type="checkbox"
                          checked={acknowledgedQbo}
                          onChange={(e) => setAcknowledgedQbo(e.target.checked)}
                          className="h-5 w-5 rounded border-slate-400 text-[#D4AF37] focus:ring-[#D4AF37]"
                          data-testid="signoff-qbo-checkbox"
                        />
                        <span className="text-base font-semibold text-white">
                          I understand my actions impact QuickBooks Online
                        </span>
                      </label>

                      <div>
                        <label
                          htmlFor="training-employee-name"
                          className="block text-xs font-bold uppercase tracking-wider text-slate-300"
                        >
                          Employee Name
                        </label>
                        <input
                          id="training-employee-name"
                          name="employeeName"
                          type="text"
                          autoComplete="off"
                          required
                          value={employeeName}
                          onChange={(e) => setEmployeeName(e.target.value)}
                          placeholder="Enter your full first and last name..."
                          className={`${field} mt-1.5 bg-white py-3 text-base text-slate-900`}
                          data-testid="signoff-employee-name"
                        />
                      </div>

                      {formError && (
                        <div role="alert" className={noticeError} data-testid="signoff-error-toast">
                          {formError}
                        </div>
                      )}

                      <div className="flex items-center justify-end pt-2">
                        <button
                          type="submit"
                          disabled={isPending}
                          data-testid="signoff-submit-btn"
                          className="rounded-full bg-[#D4AF37] px-7 py-3 text-base font-bold text-slate-950 shadow-md transition hover:bg-[#e3be42] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPending ? "Unlocking Training Hub..." : "Submit Sign-Off"}
                        </button>
                      </div>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.section>
        ) : (
          /* Sleek, Minimalist Deep Forest Green Success Banner after Gatekeeper Submission */
          <motion.div
            key="gatekeeper-collapsed"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            role="status"
            data-testid="protocol-acknowledged-banner"
            className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#0B3B24] px-6 py-4 text-white shadow-[0_10px_30px_rgba(11,59,36,0.25)]"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/20 text-[#D4AF37]">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <span className="text-base font-bold tracking-tight sm:text-lg">
                ✓ Mandatory Protocol Acknowledged by {protocolSigned.employeeName}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-xs text-emerald-100">
                {protocolSigned.confirmationId}
              </span>
              <button
                type="button"
                onClick={() => setProtocolSigned(null)}
                className="text-xs font-semibold text-emerald-200 underline-offset-4 hover:text-white hover:underline"
              >
                Review Rules
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PHASE 2: THE CLEAN ROLE SELECTOR (Hidden until Gatekeeper is signed) */}
      <AnimatePresence>
        {protocolSigned && (
          <motion.section
            key="phase-2-role-selector"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            aria-label="Select Factory Role"
            className={card}
            data-testid="phase-2-role-selector"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="w-full sm:w-auto">
                <div className={eyebrow}>Factory Lifecycle Order (1 → 6)</div>
                <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  Step 1: Select Your Factory Role
                </h2>
                {/* The Animated Champagne Gold Beam */}
                <div
                  data-testid="role-heading-beam"
                  className="mt-2 h-[2px] w-full bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent bg-[length:200%_auto] animate-pulse"
                />
              </div>
              <span className={`${badge} bg-slate-100 text-slate-700 ring-slate-200`}>
                {selectedRole
                  ? `Active: ${activeRole?.label}`
                  : "Touch a role card below to reveal training"}
              </span>
            </div>

            <div
              className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              role="tablist"
              aria-label="Factory roles"
              data-testid="role-selector-grid"
            >
              {ROLES.map((role, index) => {
                const isSelected = role.id === selectedRole;
                const isHovered = role.id === hoveredRole;
                const Icon =
                  role.id === "procurement_manager"
                    ? ShoppingCart
                    : role.id === "receiving_dock"
                      ? Truck
                      : role.id === "warehouse_manager"
                        ? Boxes
                        : role.id === "floor_foreman"
                          ? Wrench
                          : role.id === "line_operator"
                            ? Smartphone
                            : PackageCheck;

                return (
                  <button
                    key={role.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    data-testid={`role-btn-${role.id}`}
                    onMouseEnter={() => setHoveredRole(role.id)}
                    onMouseLeave={() => setHoveredRole(null)}
                    onFocus={() => setHoveredRole(role.id)}
                    onBlur={() => setHoveredRole(null)}
                    onClick={() => setSelectedRole(role.id)}
                    className={`group relative flex min-h-[132px] flex-col justify-between rounded-2xl p-5 text-left backdrop-blur-md transition-all duration-300 hover:scale-[1.02] ${
                      isSelected
                        ? "bg-slate-900 text-white ring-2 ring-[#D4AF37] shadow-[0_14px_38px_-6px_rgba(212,175,55,0.5)]"
                        : "bg-slate-900/5 text-slate-900 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:bg-slate-900/10 hover:shadow-[0_10px_28px_rgb(212,175,55,0.18)]"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span
                        className={`inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                          isSelected
                            ? "bg-white/15 text-[#D4AF37]"
                            : "bg-white/90 text-slate-700 shadow-xs"
                        }`}
                      >
                        <Icon className="h-6 w-6" />
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                          isSelected
                            ? "bg-[#D4AF37]/20 text-[#F3E5AB]"
                            : "bg-white/80 text-slate-600"
                        }`}
                      >
                        {index + 1}. {role.katanaTab}
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="text-lg font-bold tracking-tight">{role.label}</div>
                      <p
                        className={`mt-0.5 text-xs ${
                          isSelected ? "text-slate-300" : "text-slate-500"
                        }`}
                      >
                        {role.subtitle}
                      </p>
                    </div>

                    {/* Sleek Hover / Active Tooltip Expansion */}
                    <div
                      data-testid={`role-tooltip-${role.id}`}
                      className={`overflow-hidden transition-all duration-300 ${
                        isHovered || isSelected
                          ? "mt-3 max-h-28 opacity-100"
                          : "mt-0 max-h-0 opacity-0"
                      }`}
                    >
                      <p
                        className={`rounded-xl p-2.5 text-xs leading-relaxed ${
                          isSelected
                            ? "bg-white/10 text-[#F3E5AB]"
                            : "bg-white/90 text-slate-700 shadow-xs"
                        }`}
                      >
                        {role.hoverDescription}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* PHASE 3: FOCUSED CONTENT REVEAL (Only rendered after user clicks a specific role) */}
      <AnimatePresence mode="wait">
        {protocolSigned && activeRole && (
          <motion.section
            key={`role-content-${activeRole.id}-${viewMode}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5 }}
            aria-label={`${activeRole.label} SOP Training`}
            data-testid={`role-panel-${activeRole.id}`}
            className="space-y-6"
          >
            {viewMode === "full" ? (
              <>
                {/* Video Lesson Card */}
                <a
                  href={activeRole.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="video-lesson-card"
                  className="group relative block overflow-hidden rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_14px_40px_-8px_rgba(212,175,55,0.35)]"
                >
                  <GoldBeam />
                  <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
                    <div className="flex items-start gap-4 sm:items-center">
                      <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-[#D4AF37] shadow-[0_8px_24px_rgba(212,175,55,0.3)] transition-transform duration-200 group-hover:scale-105">
                        <Play className="ml-0.5 h-8 w-8 fill-current" />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={eyebrow}>📺 Video Lesson • {activeRole.label}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-0.5 text-xs font-semibold text-amber-900">
                            <Clock className="h-3.5 w-3.5 text-[#D4AF37]" />
                            {activeRole.videoWatchNote}
                          </span>
                        </div>
                        <h3 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                          Watch the Katana Video Tutorial
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {activeRole.videoTitle} — Opens directly in YouTube at the exact timestamp
                          for your station.
                        </p>
                      </div>
                    </div>

                    <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xs transition group-hover:bg-slate-800 sm:self-center">
                      <span>Watch on YouTube</span>
                      <ExternalLink className="h-4 w-4 text-[#D4AF37]" />
                    </div>
                  </div>
                </a>

                {/* Full Step-by-Step Instructions Card */}
                <div className={card} data-testid="full-training-card">
                  <div className="border-b border-slate-100 pb-4">
                    <div className={eyebrow}>{activeRole.katanaTab}</div>
                    <h3 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                      {activeRole.label} — Step-by-Step Standard Operating Procedure
                    </h3>
                    <p className="mt-1 text-base text-slate-600">{activeRole.subtitle}</p>
                  </div>

                  <div className="mt-6 space-y-4">
                    {activeRole.steps.map((step) => (
                      <div
                        key={step.title}
                        className="rounded-2xl bg-slate-50/90 p-5 shadow-[0_2px_10px_rgb(0,0,0,0.02)]"
                      >
                        <h4 className="text-lg font-bold text-slate-900">{step.title}</h4>
                        <p className="mt-2 text-base leading-relaxed text-slate-700">
                          {step.detail}
                        </p>
                        {step.subBullets && step.subBullets.length > 0 && (
                          <ul className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
                            {step.subBullets.map((bullet) => (
                              <li
                                key={bullet}
                                className="flex items-start gap-2.5 text-base text-slate-700"
                              >
                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#D4AF37]" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Floor Foreman Real-Time WIP Overview Section */}
                  {activeRole.wipOverview && (
                    <div
                      data-testid="foreman-wip-overview"
                      className="mt-6 rounded-2xl bg-slate-50 p-6 shadow-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-900 shadow-xs">
                          <Activity className="h-5 w-5 text-[#D4AF37]" />
                        </span>
                        <div>
                          <div className={eyebrow}>{activeRole.wipOverview.subtitle}</div>
                          <h4 className="text-lg font-bold text-slate-900">
                            {activeRole.wipOverview.title}
                          </h4>
                        </div>
                      </div>
                      <p className="mt-3 text-base leading-relaxed text-slate-700">
                        {activeRole.wipOverview.description}
                      </p>
                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        {activeRole.wipOverview.stages.map((stage, idx) => (
                          <div key={stage.status} className="rounded-xl bg-white p-4 shadow-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                Stage {idx + 1}
                              </span>
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${stage.badgeColor}`}
                              >
                                {stage.status}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-relaxed text-slate-700">
                              {stage.meaning}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Foreman Work Center Reference Table */}
                  {activeRole.workCenters && (
                    <div className="mt-6 overflow-hidden rounded-2xl bg-slate-50/70 shadow-xs">
                      <div className="bg-slate-100 px-5 py-3.5">
                        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-800">
                          Locked CC Patio Physical Work Centers (Katana Resources Filter)
                        </h4>
                      </div>
                      <div className="overflow-x-auto bg-white">
                        <table className="w-full text-left text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                            <tr>
                              <th className="px-4 py-3">Floor / Zone</th>
                              <th className="px-4 py-3">Katana Resource Filter</th>
                              <th className="px-4 py-3">Standard Operation</th>
                              <th className="px-4 py-3">Primary Operator Role</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeRole.workCenters.map((wc) => (
                              <tr key={wc.resource} className="hover:bg-slate-50/80">
                                <td className="px-4 py-3 font-medium text-slate-700">{wc.zone}</td>
                                <td className="px-4 py-3">
                                  <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-900">
                                    {wc.resource}
                                  </code>
                                </td>
                                <td className="px-4 py-3 text-slate-700">{wc.operation}</td>
                                <td className="px-4 py-3 text-slate-600">{wc.role}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Accounting Automation Notice Callout */}
                  <div
                    data-testid="accounting-automation-notice"
                    className="mt-6 rounded-2xl bg-amber-50/90 p-6 shadow-[0_8px_24px_rgba(212,175,55,0.15)]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-800 shadow-xs">
                        <DollarSign className="h-6 w-6" />
                      </span>
                      <h4 className="text-base font-extrabold uppercase tracking-wide text-amber-950">
                        💰 {activeRole.accountingNotice.title}
                      </h4>
                    </div>
                    <p className="mt-3 text-base font-medium leading-relaxed text-amber-950">
                      {activeRole.accountingNotice.body}
                    </p>
                    {activeRole.accountingNotice.bullets && (
                      <ul className="mt-3 space-y-1.5 border-t border-amber-200/80 pt-3">
                        {activeRole.accountingNotice.bullets.map((item) => (
                          <li
                            key={item}
                            className="flex items-start gap-2 text-sm font-semibold text-amber-900"
                          >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Condensed High-Contrast Cheat Sheet View (Videos Hidden) */
              <div
                className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.06)]"
                data-testid="cheat-sheet-card"
              >
                <GoldBeam />
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div>
                    <div className="text-xs font-extrabold uppercase tracking-widest text-[#D4AF37]">
                      ⚡ CONDENSED SHOP FLOOR CHEAT SHEET • {activeRole.katanaTab}
                    </div>
                    <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-900">
                      {activeRole.label} — Rapid Action Steps
                    </h3>
                  </div>
                  <span className="rounded-xl bg-slate-900 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                    Videos Hidden • High Contrast
                  </span>
                </div>

                <ul className="mt-6 space-y-3" data-testid="cheat-sheet-steps">
                  {activeRole.steps.map((step, index) => (
                    <li
                      key={step.title}
                      className="flex items-start gap-4 rounded-xl bg-slate-50 p-4 shadow-xs"
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-extrabold text-white">
                        {index + 1}
                      </span>
                      <div className="text-lg font-bold leading-snug text-slate-900">
                        {step.cheatSheetAction}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 rounded-xl bg-amber-50 p-4">
                  <p className="text-base font-extrabold text-amber-950">
                    💰 {activeRole.accountingNotice.title}:{" "}
                    <span className="font-semibold">{activeRole.accountingNotice.body}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Daily Shift Checklist Card */}
            <div className={card} data-testid="role-checklist-card">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <div>
                  <div className={eyebrow}>Shift Verification & Compliance</div>
                  <h3 className="text-lg font-bold tracking-tight text-slate-900">
                    {activeRole.label} — Daily Shift Checklist
                  </h3>
                </div>
              </div>

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {activeRole.checklist.map((item) => (
                  <li
                    key={item}
                    className={`${innerCard} flex items-start gap-3 text-base text-slate-800`}
                  >
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
