/**
 * Clover Inventory item mapper — pure TypeScript, no HTTP.
 * Prices are integer cents. Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 3.
 */
import type { HubFinishedGoodCommerce } from "@/mappers/types";
import { parseMoney } from "@/mappers/types";

/** Clover item name practical limit. */
export const CLOVER_NAME_MAX_LEN = 127;

export type CloverItemPayload = {
  name: string;
  sku: string;
  price: number;
  priceType: "FIXED";
  hidden: boolean;
  available: boolean;
  autoManage: boolean;
};

export type CloverMapperResult =
  | { skip: true; reason: "sync_to_clover_false" | "invalid_price" }
  | {
      skip: false;
      payload: CloverItemPayload;
      idempotencyKey: string;
    };

function truncateName(name: string): string {
  const trimmed = name.trim() || "Item";
  if (trimmed.length <= CLOVER_NAME_MAX_LEN) return trimmed;
  return trimmed.slice(0, CLOVER_NAME_MAX_LEN);
}

/**
 * Format a Clover inventory item create/update body.
 * Returns skip when retail/Clover flag is false.
 */
export function mapFinishedGoodToClover(
  commerce: HubFinishedGoodCommerce,
): CloverMapperResult {
  if (!commerce.syncToClover) {
    return { skip: true, reason: "sync_to_clover_false" };
  }

  const dollars = parseMoney(commerce.msrp ?? null);
  if (dollars == null || dollars < 0) {
    return { skip: true, reason: "invalid_price" };
  }

  const cents = Math.round(dollars * 100);

  return {
    skip: false,
    payload: {
      name: truncateName(commerce.name || commerce.globalSku),
      sku: commerce.globalSku.slice(0, 64),
      price: cents,
      priceType: "FIXED",
      hidden: false,
      available: true,
      autoManage: false,
    },
    idempotencyKey: `clover-item-${commerce.globalSku}`,
  };
}
