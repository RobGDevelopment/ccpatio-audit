import { createHash } from "node:crypto";
import {
  FEDEX_FREIGHT_CARRIER_CODE,
  FEDEX_FREIGHT_CARRIER_NAME,
  fedexFreightConfigGaps,
  getFedExFreightQuote,
  type FedExDeps,
} from "@/lib/freight/fedex-freight";
import { logStructured } from "@/lib/log/structured";
import { CC_PATIO_PICKUP_ZIP, collapseMixedSkid } from "@/server/freight/priority1";
import type { FreightSkid, FulfillmentCarrierQuote } from "@/types/freight";

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * FedEx has no broker quote id. The picker needs an id that is unique inside one list and
 * stable across re-renders and cache hits (`Date.now()` was neither). Priority1 ids are
 * positive, so FedEx ids are negative and derived from what was quoted.
 */
export function fedexCarrierQuoteId(serviceType: string, totalUsd: number): number {
  const digest = createHash("sha256").update(`${serviceType}:${totalUsd.toFixed(2)}`).digest();
  return -(digest.readUInt32BE(0) % 1_000_000_000) - 1;
}

/**
 * Live FedEx Freight price for one collapsed skid, marked up like the Priority1 carriers.
 *
 * Returns `null` ONLY when FedEx is not configured (logged as a warning, naming the missing
 * settings). Any real failure throws a typed `FedExFreightError` so the caller can log it.
 * Nothing here ever invents a price.
 *
 * Open item: the request does not carry delivery accessorials (residential, liftgate,
 * appointment), so the label says so. The FedEx special-service payload must be confirmed
 * in the sandbox before this lane is switched on for customer-facing totals.
 */
export async function rateFedExCarrier(
  skid: FreightSkid,
  destZip: string,
  markupPct: number,
  deps: FedExDeps = {},
): Promise<FulfillmentCarrierQuote | null> {
  const gaps = fedexFreightConfigGaps(deps.env ?? process.env);
  if (gaps.length > 0) {
    logStructured("warn", "fedex-freight-skipped", { reason: "not_configured", missing: gaps });
    return null;
  }

  const line = collapseMixedSkid(skid);
  const quote = await getFedExFreightQuote(
    {
      originZip: CC_PATIO_PICKUP_ZIP,
      destZip,
      items: [
        {
          weightLb: line.totalWeight,
          lengthIn: line.length,
          widthIn: line.width,
          heightIn: line.height,
          freightClass: String(line.freightClass),
        },
      ],
    },
    deps,
  );

  return {
    id: fedexCarrierQuoteId(quote.serviceType, quote.rate),
    carrierName: FEDEX_FREIGHT_CARRIER_NAME,
    carrierCode: FEDEX_FREIGHT_CARRIER_CODE,
    transitDays: quote.days,
    serviceLevel: `${quote.serviceType} (excludes delivery accessorials)`,
    brokerTotalUsd: money(quote.rate),
    customerTotalUsd: money(quote.rate * (1 + markupPct / 100)),
  };
}
