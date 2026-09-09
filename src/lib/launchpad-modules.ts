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
    id: "cpq-configurator",
    title: "3D CPQ Configurator",
    description:
      "Interactive WebGL environment for real-time product visualization, Draco compression, and material swapping.",
    href: "http://localhost:3001",
    status: "POC",
    requiresAuth: false,
  },
  {
    id: "topology",
    title: "Topology Blueprint (Demo)",
    description:
      "Historical E2E lifecycle visualization. Not ingress. Not operating procedure. Binding SoT: docs/MDM_MASTER_BLUEPRINT.md.",
    href: "/topology",
    status: "Sandbox",
    requiresAuth: true,
  },
  {
    id: "presentation",
    title: "Operations Command Center (Demo)",
    description:
      "Executive briefing deck. Demo only — not the MDM control plane and not a DLQ.",
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
  POC: "border-violet-500/40 bg-violet-500/10 text-violet-200",
};
