/**
 * Phase B1: manufacturing fingerprint of a WooCommerce order.
 *
 * Used to tell a routine `order.updated` (status change, note, stock adjustment) from a real
 * post-payment edit. Only fields that reach Katana are included: line items (id, SKU, quantity,
 * finishes), shipping address, customer name and email. Anything else (totals, notes, status,
 * timestamps, payment fields) is deliberately excluded so routine updates do not alert.
 */
import { createHash } from "node:crypto";
import type { WooOrderWebhook } from "./ingress.schema";
import { extractWooLineSpecs } from "./line-specs";
import { FINISH_SLOTS } from "./finish-keys";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

export function wooManufacturingProjection(order: WooOrderWebhook): unknown {
  const { specs } = extractWooLineSpecs(order);
  const ship = order.shipping ?? {};
  const bill = order.billing ?? {};
  return {
    lines: specs.map((spec) => ({
      id: spec.wooLineItemId,
      sku: spec.sku,
      qty: spec.quantity,
      finishes: FINISH_SLOTS.map((slot) => [slot, spec.finishes[slot] ?? null]),
    })),
    ship: [
      clean(ship.first_name),
      clean(ship.last_name),
      clean(ship.company),
      clean(ship.address_1),
      clean(ship.address_2),
      clean(ship.city),
      clean(ship.state),
      clean(ship.postcode),
      clean(ship.country),
    ],
    customer: [clean(bill.first_name), clean(bill.last_name), clean(bill.email)],
  };
}

export function fingerprintWooOrder(order: WooOrderWebhook): string {
  return createHash("sha256")
    .update(JSON.stringify(wooManufacturingProjection(order)), "utf8")
    .digest("hex");
}
