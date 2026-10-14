/**
 * Phase B1: extract the manufacturing spec of every line item (base SKU, quantity, finishes).
 *
 * Pure: no I/O. The result is the input to `resolveWooOrder` (DB authority) and to the Katana
 * leg. Anything ambiguous is an issue, never a guess.
 */
import {
  classifyFinishKey,
  FINISH_SLOTS,
  normalizeSku,
  type FinishSlot,
} from "./finish-keys";
import type { SkuIngressIssue, WooOrderWebhook } from "./ingress.schema";

export type WooLineSpec = {
  /** Position in `line_items`. */
  index: number;
  /** Woo line-item id when present, else `null` (the Katana mapper falls back to the index). */
  wooLineItemId: number | null;
  /** Upper-cased, trimmed base (finished good) SKU. */
  sku: string;
  quantity: number;
  /** Upper-cased finish SKUs by slot. Absent slot = customer did not choose it. */
  finishes: Partial<Record<FinishSlot, string>>;
};

export type ExtractedLineSpecs = {
  specs: WooLineSpec[];
  issues: SkuIngressIssue[];
};

function scalarValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Stable key used on the Katana SO row attributes to map a row back to its Woo line. */
export function wooLineKey(spec: Pick<WooLineSpec, "index" | "wooLineItemId">): string {
  return spec.wooLineItemId !== null ? String(spec.wooLineItemId) : `idx${spec.index}`;
}

export function extractWooLineSpecs(order: WooOrderWebhook): ExtractedLineSpecs {
  const issues: SkuIngressIssue[] = [];
  const specs: WooLineSpec[] = [];

  // Finish keys belong on line items. At order level they are ambiguous (which line?).
  order.meta_data.forEach((entry, metaIndex) => {
    const keyClass = classifyFinishKey(entry.key);
    if (keyClass.kind === "ignored") return;
    issues.push({
      path: `meta_data.${metaIndex}.key`,
      message: `Finish key "${entry.key}" is not allowed at order level. Send finishes on the line item.`,
    });
  });

  order.line_items.forEach((item, index) => {
    const finishes: Partial<Record<FinishSlot, string>> = {};

    item.meta_data.forEach((entry, metaIndex) => {
      const keyClass = classifyFinishKey(entry.key);
      const keyPath = `line_items.${index}.meta_data.${metaIndex}`;

      if (keyClass.kind === "ignored") return;

      if (keyClass.kind === "rejected") {
        issues.push({
          path: `${keyPath}.key`,
          message: `Finish key "${entry.key}" is not accepted. The only accepted finish keys are ${FINISH_SLOTS.join(", ")}. Use: ${keyClass.use}.`,
        });
        return;
      }

      const raw = scalarValue(entry.value);
      if (!raw) {
        issues.push({
          path: `${keyPath}.value`,
          message: `Finish "${keyClass.slot}" is empty. A finish value must be a hub SKU.`,
        });
        return;
      }

      const sku = normalizeSku(raw);
      const existing = finishes[keyClass.slot];
      if (existing !== undefined && existing !== sku) {
        issues.push({
          path: `${keyPath}.value`,
          message: `Finish "${keyClass.slot}" is given twice with different values (${existing} and ${sku}).`,
        });
        return;
      }
      finishes[keyClass.slot] = sku;
    });

    specs.push({
      index,
      wooLineItemId: typeof item.id === "number" ? item.id : null,
      sku: normalizeSku(item.sku),
      quantity: item.quantity,
      finishes,
    });
  });

  return { specs, issues };
}
