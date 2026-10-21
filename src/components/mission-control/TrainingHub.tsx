"use client";

import { useState } from "react";
import { GoldBeam } from "@/components/ui/GoldBeam";
import { badge, card, eyebrow, innerCard } from "@/components/mission-control/soft-ui";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Clock,
  DollarSign,
  PlayCircle,
  ShieldAlert,
  Smartphone,
  Truck,
  Wrench,
} from "lucide-react";

export type TrainingRoleId =
  | "receiving_dock"
  | "warehouse_manager"
  | "floor_foreman"
  | "line_operator";

interface StepItem {
  title: string;
  detail: string;
  subBullets?: string[];
}

interface RoleConfig {
  id: TrainingRoleId;
  label: string;
  katanaTab: string;
  subtitle: string;
  videoTitle: string;
  videoWatchNote: string;
  embedUrl: string;
  watchUrl: string;
  steps: StepItem[];
  accountingNotice?: {
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

const ROLES: RoleConfig[] = [
  {
    id: "receiving_dock",
    label: "Receiving Dock",
    katanaTab: "Katana BUY Screen",
    subtitle: "Inbound Raw Materials, Freight Inspection & PO Receiving",
    videoTitle: "Katana Purchasing & Receiving Full Demo",
    videoWatchNote: "Watch from 2:00 – 4:30",
    embedUrl: "https://www.youtube.com/embed/fxxbW0robyA?start=120&end=270",
    watchUrl: "https://www.youtube.com/watch?v=fxxbW0robyA",
    steps: [
      {
        title: "1. Collect Documentation",
        detail:
          "Obtain the physical Packing Slip and Bill of Lading (BOL) from the freight driver before signing for the delivery.",
      },
      {
        title: "2. Open the Buy Screen",
        detail:
          'Log into Katana on the Receiving Station desktop/tablet and tap the "Buy" tab in the top navigation bar.',
      },
      {
        title: "3. Locate the Purchase Order (PO)",
        detail:
          "Search by PO Number (e.g., PO-PA-...) or filter by Supplier Name (e.g., Sunbrella / Glen Raven, Tiger Drylac, Dekton) and tap the row to open line items.",
      },
      {
        title: "4. Physical Count & Quality Inspection",
        detail:
          "Inspect all pallets, extrusion tubes, and fabric rolls for freight damage prior to releasing the driver. Verify that the Unit of Measure (UoM) on the packing slip matches Katana (Linear Feet vs. Sticks, Yards vs. Rolls, Pounds vs. Boxes).",
      },
      {
        title: '5. Update Status to "Received" (or "Partially received")',
        detail:
          'If 100% of the items arrived undamaged and match expected quantities, tap the Delivery Status dropdown and select "Received".',
        subBullets: [
          'Partial Delivery / Freight Damage: Do NOT tap full "Received". Select "Partially received" and enter the exact physical quantity unloaded in good condition today.',
          "Record the carrier PRO number and any damage notes in the PO Additional Info field.",
        ],
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (PO RECEIVING)",
      body: 'The exact moment you tap "Received" on a Purchase Order, our middleware automatically creates an Accounts Payable (A/P) Vendor Bill in QuickBooks Online and debits Raw Materials Inventory so ownership can pay the vendor.',
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
    videoTitle: "Katana Inventory Management Tutorial",
    videoWatchNote: "Watch Full Video",
    embedUrl: "https://www.youtube.com/embed/c-JWBGA1mcY",
    watchUrl: "https://www.youtube.com/watch?v=c-JWBGA1mcY",
    steps: [
      {
        title: "1. Open the Stock Screen",
        detail: 'Tap the "Stock" tab in the top navigation bar.',
      },
      {
        title: "2. Verify Current System Stock",
        detail:
          'Filter between Products (FIN-*, ASM-*) and Materials (FAB-*, FRM-*, PWD-*, RM-*). Review "In stock" (physical shelf qty) vs. "Committed" (allocated to open MOs/SOs) and "Available".',
      },
      {
        title: "3. Initiate a Stock Adjustment",
        detail:
          'Tap the global "+" icon in the top-right corner of Katana and select "Stock adjustment".',
      },
      {
        title: "4. Log the Adjustment & Standardized Reason Code",
        detail:
          "Search for the exact SKU (e.g., FAB-SUN-5404 Sunbrella Canvas Natural) and enter the Actual In-Stock Quantity so Katana matches the physical shelf count.",
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
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (INVENTORY SHRINKAGE & VALUATION)",
      body: "Stock Adjustments directly modify our perpetual inventory sub-ledger quantities and valuation in QuickBooks Online. Any single stock adjustment exceeding $250.00 in material value requires dual sign-off from the Factory Plant Manager in the Reason field.",
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
    subtitle: "Master Build Queue, Work Center Filtering, Bulk Operator Dispatch & MO Completion",
    videoTitle: "How Katana Smart Manufacturing Works (Production & Scheduling)",
    videoWatchNote: "Watch from 0:45 – 2:20",
    embedUrl: "https://www.youtube.com/embed/OwoSsyzTtZg?start=45&end=140",
    watchUrl: "https://www.youtube.com/watch?v=OwoSsyzTtZg",
    steps: [
      {
        title: "1. Priority Ranking on the Master Build Queue (Make -> Schedule)",
        detail:
          'Tap the "Make" tab. Manufacturing Orders (MOs) at the top of the list (Rank 1, 2, 3...) are the highest priority. Verify that custom Path A orders (PA-*) have their signed 3D Digital Cut Card link attached.',
      },
      {
        title: "2. Never Release Red Material Orders to the Floor",
        detail: 'Check the "Ingredients" column before releasing any MO to operators:',
        subBullets: [
          "🟢 In stock (Green): All extrusions, fabrics, powder, and sub-assemblies are on hand. Safe to start.",
          "🟡 Expected (Yellow): Waiting on an open Purchase Order delivery. Hold until Receiving marks the PO Received.",
          "🔴 Not available (Red): Material shortage detected. Do NOT start.",
        ],
      },
      {
        title: "3. Task Scheduling & Work Center Filtering (Make -> Tasks View)",
        detail:
          'Tap the "Tasks" sub-tab inside Make. Filter the "Resource" column by your physical Work Center (e.g., Metal Cutting, FAB POD A/B/C, Powder Coating Booth, Fabric Sewing) and bulk-select tasks using the left checkboxes to assign them to specific operators for the shift.',
        subBullets: [
          "Load-Level Welding Pods: Standard tracks default to FAB POD A. Re-route overflow MOs to FAB POD B or FAB POD C to balance shift capacity.",
          "Make-to-Stock (MTS) Sub-Assemblies: During off-peak hours, create MTS Manufacturing Orders on the Make screen for approved ASM-*-FRAME and ASM-*-CUSH SKUs so pre-built frames/cushions sit in stock.",
        ],
      },
      {
        title: '4. Final Quality Control & Closing Manufacturing Orders ("Done")',
        detail:
          'When all operations on a Manufacturing Order are finished and the piece passes Final Quality Control and Assembly & Packaging, change the MO Status dropdown to "Done".',
      },
    ],
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
      title: "ACCOUNTING AUTOMATION NOTICE (MO COMPLETION & WIP CAPITALIZATION)",
      body: 'The exact moment a Manufacturing Order is marked "Done", our middleware fires the katana/manufacturing_order.done webhook and automatically posts a balanced Journal Entry in QuickBooks Online moving Raw Materials, Packaging, and Absorbed Direct Labor into the Finished Goods Asset account.',
      bullets: [
        ' shipping / Fulfillment Note: Once shipped from the Sell screen ("Delivered"), QuickBooks automatically recognizes Revenue & COGS and updates the GoHighLevel Opportunity.',
      ],
    },
    checklist: [
      "6:45 AM: Review Make -> Schedule, verify Ingredients are Green (In stock), and confirm 3D Cut Cards are attached.",
      "6:50 AM: Open Make -> Tasks, filter by physical Resource, and bulk-assign shifts to operators.",
      "Mid-Shift & End-of-Shift: Audit the Tasks view to ensure no operator left an active timer running over lunch or overnight.",
      'Continuous: Inspect completed builds and mark verified Manufacturing Orders "Done".',
    ],
  },
  {
    id: "line_operator",
    label: "Line Operator",
    katanaTab: "Katana SHOP FLOOR APP (Tablet)",
    subtitle: "PIN/QR Login, Digital 3D Cut Cards, Start/Pause/Finish Timers & Scrap Reporting",
    videoTitle: "How Katana Smart Manufacturing Works (Shop Floor App UI)",
    videoWatchNote: "Watch from 2:20 – End for Shop Floor UI",
    embedUrl: "https://www.youtube.com/embed/OwoSsyzTtZg?start=140",
    watchUrl: "https://www.youtube.com/watch?v=OwoSsyzTtZg&t=140s",
    steps: [
      {
        title: "1. Tablet Login (6-Digit PIN or QR Badge)",
        detail:
          "Wake your workstation tablet and enter your personal 6-digit PIN code or scan your laminated Employee QR Badge. Always tap Log out before leaving for lunch or end of shift.",
      },
      {
        title: "2. Work Your Queue Top-to-Bottom",
        detail:
          'Your tablet opens directly to "My Tasks" sorted by Foreman priority. Always work strictly from the top task downward—never cherry-pick down the list.',
      },
      {
        title: "3. Open Task Instructions & 3D Digital Cut Card",
        detail:
          "Tap the top task to view the SKU, Target Quantity, and Notes. For Metal Cutting & Welding (FAB POD A/B/C), tap the attached Digital Cut Card link (/factory/cut-cards/[token]) to view the 3D render, exact tube lengths, and mitre angles.",
      },
      {
        title: "4. Mandatory Time Tracking (START / PAUSE / FINISH)",
        detail:
          "Every operation is engineered with a Standard Minute Value (SMV), and our accounting engine requires your exact start and stop timestamps:",
        subBullets: [
          "🟢 START (Green): Tap the exact moment you begin physical setup or work on the piece.",
          "🟡 PAUSE (Yellow): Tap immediately for breaks, lunch, machine maintenance, blade/gas changes, or waiting for materials (any stop > 3 minutes).",
          "🔵 FINISH (Blue): Tap the exact moment the physical operation is 100% complete, self-inspected, and placed in the outbound rack.",
        ],
      },
      {
        title: "5. Reporting Actual Material Usage & Scrap",
        detail:
          'When tapping Finish, confirm the "Actual Consumed" materials. If you had to re-cut an aluminum tube or pull extra Sunbrella yardage due to a flaw, you MUST update the Actual Consumed quantity on the tablet so inventory and QBO costing stay 100% accurate.',
      },
    ],
    accountingNotice: {
      title: "ACCOUNTING AUTOMATION NOTICE (SHOP FLOOR TIME TRACKING & LABOR ABSORPTION)",
      body: "Accurate Start, Pause, and Finish times on the Katana Shop Floor App are MANDATORY. Our middleware uses your exact tracked minutes to auto-create Direct Labor Absorption and Factory Overhead Journal Entries in QuickBooks Online.",
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
];

export function TrainingHub() {
  const [selectedRole, setSelectedRole] = useState<TrainingRoleId>("receiving_dock");

  const activeRole = ROLES.find((r) => r.id === selectedRole) ?? ROLES[0];

  return (
    <div className="space-y-8" data-testid="training-hub">
      {/* Persistent Critical System Rules Banner (Top) */}
      <section
        aria-label="Critical System Rules"
        data-testid="golden-rules-banner"
        className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-2 ring-amber-300/80"
      >
        <GoldBeam />
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-4">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-200">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <div>
            <div className={eyebrow}>Mandatory Factory Protocol — Read Before Touching Katana</div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              🚨 CRITICAL SYSTEM RULES (THE 3 GOLDEN RULES)
            </h2>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl bg-rose-50/70 p-4 ring-1 ring-rose-200">
            <div className="text-xs font-bold uppercase tracking-wider text-rose-800">
              RULE #1: NO MANUAL ORDERS
            </div>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">
              NEVER MANUALLY CREATE SALES ORDERS IN KATANA.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Sales Orders (<code className="font-mono text-xs font-semibold text-slate-800">PA-*</code>,{" "}
              <code className="font-mono text-xs font-semibold text-slate-800">GHL-*</code>,{" "}
              <code className="font-mono text-xs font-semibold text-slate-800">WOO-*</code>) are
              automatically pushed by our MDM Hub the exact second a customer pays their{" "}
              <span className="font-semibold text-slate-900">50% deposit</span>.
            </p>
          </div>

          <div className="rounded-xl bg-amber-50/70 p-4 ring-1 ring-amber-200">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
              RULE #2: NO MANUAL RECIPES (BOMs)
            </div>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">
              NEVER MANUALLY CREATE OR EDIT PRODUCT RECIPES (BOMs).
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Our 3D Quoting Engine automatically extracts exact aluminum lengths, mitre angles,
              Sunbrella yardage, and SMV labor times, pushing the Master Recipe directly to Katana.
            </p>
          </div>

          <div className="rounded-xl bg-emerald-50/70 p-4 ring-1 ring-emerald-200">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              RULE #3: REAL-TIME QBO LEDGER
            </div>
            <p className="mt-1.5 text-sm font-semibold text-slate-900">
              EVERY BUTTON CLICK FIRES REAL MONEY INTO QUICKBOOKS ONLINE.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Changing a status to{" "}
              <span className="font-semibold text-slate-900">Received</span>,{" "}
              <span className="font-semibold text-slate-900">Finish</span>,{" "}
              <span className="font-semibold text-slate-900">Done</span>, or{" "}
              <span className="font-semibold text-slate-900">Delivered</span> immediately posts
              live Bills, Journal Entries, and COGS in QBO.
            </p>
          </div>
        </div>
      </section>

      {/* Tablet-First Role Selector Grid */}
      <section aria-label="Select Factory Role" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className={eyebrow}>Step 1 — Touch Your Workstation Role</div>
            <h3 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
              Select Your Factory Role
            </h3>
          </div>
          <span className={`${badge} bg-slate-100 text-slate-700 ring-slate-200`}>
            SOP-OPS-KATANA-002 v2.1
          </span>
        </div>

        <div
          className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
          role="tablist"
          aria-label="Factory roles"
        >
          {ROLES.map((role) => {
            const isSelected = role.id === selectedRole;
            const Icon =
              role.id === "receiving_dock"
                ? Truck
                : role.id === "warehouse_manager"
                  ? Boxes
                  : role.id === "floor_foreman"
                    ? Wrench
                    : Smartphone;

            return (
              <button
                key={role.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`role-btn-${role.id}`}
                onClick={() => setSelectedRole(role.id)}
                className={`group flex min-h-[96px] flex-col justify-between rounded-2xl p-5 text-left transition-all ${
                  isSelected
                    ? "bg-slate-900 text-white shadow-lg ring-2 ring-[#C5A059]"
                    : "bg-slate-50/90 text-slate-900 ring-1 ring-slate-200 hover:bg-white hover:shadow-md"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${
                      isSelected
                        ? "bg-white/15 text-[#C5A059]"
                        : "bg-white text-slate-700 ring-1 ring-slate-200"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                      isSelected
                        ? "bg-[#C5A059]/20 text-[#E5C687]"
                        : "bg-slate-200/70 text-slate-600"
                    }`}
                  >
                    {role.katanaTab}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="text-lg font-bold tracking-tight">{role.label}</div>
                  <p
                    className={`mt-0.5 line-clamp-1 text-xs ${
                      isSelected ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {role.subtitle}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Active Role Content Area */}
      <section
        aria-label={`${activeRole.label} SOP Training`}
        data-testid={`role-panel-${activeRole.id}`}
        className="space-y-6"
      >
        {/* Embedded Video Training Card */}
        <div className={card}>
          <GoldBeam />
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-[#C5A059] ring-1 ring-amber-200">
                <PlayCircle className="h-6 w-6" />
              </span>
              <div>
                <div className={eyebrow}>📺 Required Video Training — {activeRole.label}</div>
                <h3 className="text-xl font-bold tracking-tight text-slate-900">
                  {activeRole.videoTitle}
                </h3>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
                <Clock className="h-4 w-4 text-amber-700" />
                {activeRole.videoWatchNote}
              </span>
              <a
                href={activeRole.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 hover:text-slate-900"
              >
                Open on YouTube ↗
              </a>
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
            <div className="aspect-video w-full">
              <iframe
                key={activeRole.embedUrl}
                src={activeRole.embedUrl}
                title={`${activeRole.label} — ${activeRole.videoTitle}`}
                className="h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>

        {/* Step-by-Step Instructions Card */}
        <div className={card}>
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
                className="rounded-2xl bg-slate-50/90 p-5 ring-1 ring-slate-200/80"
              >
                <h4 className="text-lg font-bold text-slate-900">{step.title}</h4>
                <p className="mt-2 text-base leading-relaxed text-slate-700">{step.detail}</p>
                {step.subBullets && step.subBullets.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
                    {step.subBullets.map((bullet) => (
                      <li
                        key={bullet}
                        className="flex items-start gap-2.5 text-base text-slate-700"
                      >
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#C5A059]" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* Foreman Work Center Reference Table */}
          {activeRole.workCenters && (
            <div className="mt-6 overflow-hidden rounded-2xl ring-1 ring-slate-200">
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
                          <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-900 ring-1 ring-slate-200">
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
          {activeRole.accountingNotice && (
            <div
              data-testid="accounting-automation-notice"
              className="mt-6 rounded-2xl bg-amber-50/90 p-6 ring-2 ring-[#C5A059]"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-800 shadow-sm ring-1 ring-amber-200">
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
          )}
        </div>

        {/* Daily Shift Checklist Card */}
        <div className={card}>
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div>
              <div className={eyebrow}>Shift Verification</div>
              <h3 className="text-lg font-bold tracking-tight text-slate-900">
                {activeRole.label} — Daily Shift Checklist
              </h3>
            </div>
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {activeRole.checklist.map((item) => (
              <li key={item} className={`${innerCard} flex items-start gap-3 text-base text-slate-800`}>
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
