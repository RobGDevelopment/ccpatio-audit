/**
 * Option A — Targeted Katana purge classifiers (pure, unit-tested).
 * Binding: Option A plan — preserve BRA/OCE/BRO/DBT recipes; delete only
 * sandbox/QA + Hub RM products that are not BOM children of protected parents.
 */

export type SkuClass =
  | "protected"
  | "hub_rm"
  | "qa"
  | "d_dekton"
  | "sandbox"
  | "other";

const PROTECTED_PREFIXES = ["BRA-", "OCE-", "OCN-", "BRO-", "DBT-"] as const;

export function classifyKatanaSku(sku: string): SkuClass {
  const s = sku.trim().toUpperCase();
  if (!s) return "other";
  if (PROTECTED_PREFIXES.some((p) => s.startsWith(p))) return "protected";
  if (s.startsWith("QA-TEST-") || s.startsWith("QA-")) return "qa";
  if (s.startsWith("SANDBOX-")) return "sandbox";
  if (s.startsWith("RM-")) return "hub_rm";
  if (/^D-/.test(s) || /^D\d/.test(s)) return "d_dekton";
  return "other";
}

export function isProtectedSku(sku: string): boolean {
  return classifyKatanaSku(sku) === "protected";
}

/** Product delete candidates — still subject to BOM-child gate. */
export function isProductPurgeCandidate(sku: string): boolean {
  const c = classifyKatanaSku(sku);
  return c === "hub_rm" || c === "qa" || c === "sandbox" || c === "d_dekton";
}

export type TxnClass = "protected" | "sandbox" | "blocks_target_sku" | "keep";

const SANDBOX_CUSTOMER_NEEDLES = [
  "sandbox mto tester",
  "sandbox tester",
  "qa tester",
];

export function isSandboxCustomerName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return false;
  return SANDBOX_CUSTOMER_NEEDLES.some((needle) => n.includes(needle));
}

export function classifySalesOrder(input: {
  customerName?: string | null;
  orderNo?: string | null;
  lineSkus: string[];
  targetSkus: ReadonlySet<string>;
}): TxnClass {
  const lineSkus = input.lineSkus.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (lineSkus.some(isProtectedSku)) return "protected";

  const sandboxCustomer = isSandboxCustomerName(input.customerName);
  const sandboxOrder =
    /qa-test|sandbox/i.test(input.orderNo ?? "") ||
    lineSkus.some((s) => {
      const c = classifyKatanaSku(s);
      return c === "qa" || c === "sandbox";
    });

  if (sandboxCustomer || sandboxOrder) return "sandbox";

  if (
    input.targetSkus.size > 0 &&
    lineSkus.some((s) => input.targetSkus.has(s))
  ) {
    return "blocks_target_sku";
  }

  return "keep";
}

/**
 * D-* and other candidates may only be deleted when unused by any
 * protected parent's recipe/bom_rows.
 */
export function canDeleteProductSku(input: {
  sku: string;
  referencedByProtectedParent: boolean;
}): boolean {
  if (!isProductPurgeCandidate(input.sku)) return false;
  if (input.referencedByProtectedParent) return false;
  const c = classifyKatanaSku(input.sku);
  // Default keep for D-* unless explicitly unused (caller passes false).
  if (c === "d_dekton" && input.referencedByProtectedParent) return false;
  return true;
}
