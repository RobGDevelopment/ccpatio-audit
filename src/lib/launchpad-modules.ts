export type ModuleStatus = "Live" | "Sandbox" | "Walk Phase";

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
      "Live spreadsheet of finished goods and integration fields before data flows to Katana, WooCommerce, GHL, and QuickBooks.",
    href: "/admin/dictionary",
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
    id: "topology",
    title: "Topology Blueprint",
    description:
      "Interactive E2E lifecycle map — zones, pipelines, manufacturing sequences, and integration rails.",
    href: "/topology",
    status: "Sandbox",
    requiresAuth: true,
  },
  {
    id: "presentation",
    title: "Operations Command Center",
    description:
      "Executive briefing deck — current-state chaos, dual-pipeline architecture, training gates, and margin ledger.",
    href: "/presentation",
    status: "Walk Phase",
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
};
