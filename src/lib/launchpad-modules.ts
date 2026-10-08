export type ModuleStatus = "Live" | "Sandbox" | "Walk Phase" | "POC";

export type LaunchpadModule = {
  id: string;
  title: string;
  description: string;
  href: string;
  status: ModuleStatus;
  requiresAuth: boolean;
};

export const LAUNCHPAD_MODULES: LaunchpadModule[] = [
  {
    id: "dictionary",
    title: "Global SKU Dictionary",
    description:
      "Live spreadsheet of finished goods, nested BOMs, and catalog fields. Publish to Katana/Woo/Clover is Approve-only (MDM hub).",
    href: "/admin/dictionary",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "order-triage",
    title: "Factory Order Triage",
    description:
      "Map a GHL Produce Factory Order to FIN-* and FAB-* SKUs, then Approve & Push to Katana.",
    href: "/admin/order-triage",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "quarantine",
    title: "Product Quarantine",
    description:
      "Human review of SketchUp intakes — MSRP, SEO, BOM check, then Approve to enqueue catalog fan-out.",
    href: "/admin/quarantine",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "factory-bom",
    title: "Factory BOM Builder",
    description:
      "Review heuristic FRAME/CUSH drafts for Phase 1 and 2, tweak quantities, and approve into live product_bom.",
    href: "/admin/factory-bom",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "logistics",
    title: "Logistics & Freight",
    description:
      "Packaged dimensions, NMFC freight class, and PrimeView 3D assets for Katana variants.",
    href: "/admin/logistics",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "raw-materials",
    title: "Raw Materials Catalog",
    description:
      "Category attributes for metal, fabric, powder, and components that roll into multi-level BOMs.",
    href: "/admin/raw-materials",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "audit",
    title: "PIM Audit Trail",
    description:
      "Immutable change log of every dictionary edit, stamped with operator email and timestamp.",
    href: "/admin/audit",
    status: "Live",
    requiresAuth: true,
  },
  {
    id: "health",
    title: "System Health",
    description:
      "Middleware heartbeat — database connectivity, environment flags, and deployment diagnostics.",
    href: "/api/health",
    status: "Live",
    requiresAuth: false,
  },
];

export const STATUS_STYLES: Record<ModuleStatus, string> = {
  Live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  Sandbox: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  "Walk Phase": "border-sky-500/40 bg-sky-500/10 text-sky-200",
  POC: "border-violet-500/40 bg-violet-500/10 text-violet-200",
};
