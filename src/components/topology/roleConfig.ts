/**
 * Human Layer — role assignments for every topology node / stage.
 * Single source of truth for UI badges and SOP matrix export.
 */

export type RoleCategory = "system" | "sales" | "factory" | "logistics";

export type RoleAssignment = {
  label: string;
  category: RoleCategory;
};

export const ROLE_CATEGORY_STYLES: Record<
  RoleCategory,
  { pill: string; text: string; border: string }
> = {
  system: {
    pill: "bg-slate-800/90",
    text: "text-cyan-300",
    border: "border-cyan-500/40",
  },
  sales: {
    pill: "bg-indigo-950/80",
    text: "text-indigo-300",
    border: "border-indigo-500/40",
  },
  factory: {
    pill: "bg-amber-950/80",
    text: "text-amber-300",
    border: "border-amber-500/40",
  },
  logistics: {
    pill: "bg-emerald-950/80",
    text: "text-emerald-300",
    border: "border-emerald-500/40",
  },
};

function k(nodeId: string, stageId?: string | null) {
  return stageId ? `${nodeId}::${stageId}` : nodeId;
}

/** Authoritative role map — nodeId or nodeId::stageId */
const ROLE_MAP: Record<string, RoleAssignment> = {
  /* Omnichannel */
  "traffic-meta": { label: "Marketing Ops", category: "sales" },
  "traffic-google": { label: "Marketing Ops", category: "sales" },
  "traffic-organic": { label: "Marketing Ops", category: "sales" },
  "chan-phone": { label: "Sales / Trade Desk", category: "sales" },
  "chan-sms": { label: "Front Desk", category: "sales" },
  "chan-whatsapp": { label: "Service Rep", category: "sales" },
  "chan-webchat": { label: "Showroom Rep", category: "sales" },
  "chan-email": { label: "Marketing Ops", category: "sales" },
  "chan-social": { label: "Social Inbox", category: "sales" },
  "showroom-walkin": { label: "Showroom Rep / Front Desk", category: "sales" },
  "ghl-hub": { label: "GHL Router", category: "system" },

  /* Pipelines */
  "leads-pipe::lead-new": { label: "Showroom Rep", category: "sales" },
  "leads-pipe::lead-website": { label: "Web Lead Queue", category: "sales" },
  "trade-pipe::trade-app": { label: "Trade Desk", category: "sales" },
  "trade-pipe::trade-approved": { label: "Trade Desk", category: "sales" },
  "warranty-pipe::warranty-discovery": { label: "Service Rep", category: "sales" },
  "warranty-pipe::warranty-approved": { label: "Service Rep", category: "sales" },
  "warranty-pipe::warranty-produce": { label: "Service / Ops", category: "sales" },
  "warranty-pipe::warranty-closed": { label: "Service Rep", category: "sales" },

  /* Sales AZ */
  "sales-az::az-onsite": { label: "Showroom Rep", category: "sales" },
  "sales-az::az-sketchup-needed": { label: "Design / Engineering", category: "sales" },
  "sales-az::az-sketchup-done": { label: "Sales Rep", category: "sales" },
  "sales-az::az-proposal": { label: "Sales Rep", category: "sales" },
  "sales-az::az-finalize": { label: "Sales Rep", category: "sales" },
  "sales-az::az-produce": { label: "Sales / Ops", category: "sales" },
  "sales-az::az-approval": { label: "Customer + Sales", category: "sales" },
  "sales-az::az-delivered": { label: "Sales / Finance", category: "sales" },

  /* Sales CA */
  "sales-ca::ca-onsite": { label: "Sales CA / Field", category: "sales" },
  "sales-ca::ca-sketchup-needed": { label: "Design / Engineering", category: "sales" },
  "sales-ca::ca-sketchup-done": { label: "Sales CA", category: "sales" },
  "sales-ca::ca-proposal": { label: "Sales CA", category: "sales" },
  "sales-ca::ca-finalize": { label: "Sales CA", category: "sales" },
  "sales-ca::ca-produce": { label: "Sales CA / Ops", category: "sales" },
  "sales-ca::ca-approval": { label: "Customer + Sales", category: "sales" },
  "sales-ca::ca-delivered": { label: "Sales / Finance", category: "sales" },

  /* Design */
  "field-survey": { label: "Field Survey Tech", category: "sales" },
  sketchup: { label: "SketchUp Designer", category: "sales" },
  "cut-lists": { label: "Engineering", category: "sales" },
  "bom-packet": { label: "Engineering / Sales", category: "sales" },

  /* Payment */
  "qbo-deposit-link": { label: "Finance / Sales", category: "logistics" },
  "clover-showroom": { label: "Showroom Rep", category: "sales" },
  "payment-gateway": { label: "Finance / Ops", category: "system" },

  /* Middleware */
  "produce-az": { label: "Next.js Ingress", category: "system" },
  "produce-ca": { label: "Next.js Ingress", category: "system" },
  "produce-warranty": { label: "Next.js Ingress", category: "system" },
  ingress: { label: "Next.js Middleware", category: "system" },
  redis: { label: "Redis Idempotency", category: "system" },
  postgres: { label: "Postgres Outbox", category: "system" },
  inngest: { label: "System / API", category: "system" },
  katana: { label: "Katana ERP Sync", category: "system" },

  /* Materials */
  "inventory-alloc": { label: "Factory / Purchasing", category: "factory" },
  "procurement-wait": { label: "Purchasing", category: "factory" },
  "outsourced-accessories": { label: "Vendor / Ops", category: "factory" },

  /* Factory work centers */
  "work-centers::wc-tube-stock": { label: "Materials Staging", category: "factory" },
  "work-centers::wc-chop-saw": { label: "Chop Saw Operator", category: "factory" },
  "work-centers::wc-cart-parts": { label: "Fab Pod 1", category: "factory" },
  "work-centers::wc-tack": { label: "Fab Pod 1 · Tack", category: "factory" },
  "work-centers::wc-weld-out": { label: "Fab Pod 1 · Weld Out", category: "factory" },
  "work-centers::wc-grinder": { label: "Fab Pod 2 · Grinder", category: "factory" },
  "work-centers::wc-marriage": { label: "Fab Pod 3 · Assembly", category: "factory" },
  "work-centers::wc-cart-blast": { label: "Finishing Lead", category: "factory" },
  "work-centers::wc-sandblast": { label: "Sandblast Operator", category: "factory" },
  "work-centers::wc-powder": { label: "Powder Coat Tech", category: "factory" },
  "work-centers::wc-upholstery": { label: "Upholstery / Sewing", category: "factory" },
  "work-centers::wc-final": { label: "Final Assembly Lead", category: "factory" },

  /* QC */
  "qc-gates::qc-a": { label: "QC Inspector · Gate A", category: "factory" },
  "qc-gates::qc-b": { label: "QC Inspector · Gate B", category: "factory" },
  "qc-gates::qc-c": { label: "QC Inspector · Gate C", category: "factory" },

  /* GHL Manufacturing mirror */
  "mfg-pipe::mfg-new": { label: "GHL Mirror Sync", category: "system" },
  "mfg-pipe::mfg-purchasing": { label: "GHL Mirror · Purchasing", category: "system" },
  "mfg-pipe::mfg-production": { label: "GHL Mirror · Production", category: "system" },
  "mfg-pipe::mfg-ready": { label: "GHL Mirror · Ready", category: "system" },
  "mfg-pipe::mfg-delivered": { label: "GHL Mirror · Delivered", category: "system" },

  /* Logistics & treasury */
  "dispatch-routes::dispatch-box": { label: "Dispatch Coordinator", category: "logistics" },
  "dispatch-routes::dispatch-3pl": { label: "Freight Coordinator", category: "logistics" },
  "dispatch-routes::dispatch-willcall": { label: "Showroom / Ops", category: "logistics" },
  delivery: { label: "White-Glove Driver", category: "logistics" },
  qbo: { label: "Finance / QBO", category: "logistics" },
  clover: { label: "QBO Matcher", category: "logistics" },
  reconciled: { label: "Finance Controller", category: "logistics" },
  postcare: { label: "Customer Success", category: "sales" },
};

export function lookupRole(
  nodeId: string,
  stageId?: string | null
): RoleAssignment | null {
  const staged = stageId ? ROLE_MAP[k(nodeId, stageId)] : null;
  if (staged) return staged;
  return ROLE_MAP[nodeId] ?? null;
}

/** Fallback by zone name when no explicit mapping */
export function inferRoleFromZone(zone?: string): RoleAssignment | null {
  if (!zone) return null;
  const z = zone.toLowerCase();
  if (z.includes("middleware") || z.includes("trigger") || z.includes("gate 0"))
    return { label: "Next.js Middleware", category: "system" };
  if (z.includes("factory") || z.includes("qc") || z.includes("materials"))
    return { label: "Factory Ops", category: "factory" };
  if (z.includes("logistics") || z.includes("treasury") || z.includes("deposit"))
    return { label: "Logistics / Finance", category: "logistics" };
  if (z.includes("sales") || z.includes("design") || z.includes("channel"))
    return { label: "Sales / Design", category: "sales" };
  return null;
}

export function resolveRole(
  nodeId: string,
  stageId?: string | null,
  zone?: string
): RoleAssignment | null {
  return lookupRole(nodeId, stageId) ?? inferRoleFromZone(zone);
}
