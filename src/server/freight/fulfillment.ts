import { getLogisticsSettings } from "@/server/actions/logistics";
import {
  fleetCustomerTotal,
  requireFleetTariff,
} from "@/server/freight/fleet-tariff";
import {
  CC_PATIO_PICKUP_ZIP,
  FreightRatingError,
  getPriority1Quote,
} from "@/server/freight/priority1";
import type {
  FreightSkid,
  FulfillmentCarrierQuote,
  FulfillmentOption,
  FulfillmentPlan,
  Priority1AccessorialCode,
  Priority1QuoteResult,
} from "@/types/freight";
import type { RateQuote } from "@/types/priority1-ltl.generated";

const RESIDENTIAL_DELIVERY: Priority1AccessorialCode[] = [
  "RESDEL",
  "LGDEL",
  "APPT",
];

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function markedUp(brokerTotal: number, markupPct: number): number {
  return money(brokerTotal * (1 + markupPct / 100));
}

function carrierQuote(
  quote: RateQuote,
  markupPct: number,
): FulfillmentCarrierQuote {
  const brokerTotal = quote.rateQuoteDetail?.total;
  if (brokerTotal == null || !Number.isFinite(brokerTotal) || brokerTotal < 0) {
    throw new FreightRatingError(
      `Priority1 quote ${quote.id} (${quote.carrierCode}) is missing an all-in total`,
    );
  }
  return {
    id: quote.id ?? 0,
    carrierName: quote.carrierName ?? "",
    carrierCode: quote.carrierCode ?? "",
    transitDays: quote.transitDays ?? null,
    serviceLevel: quote.serviceLevel ?? null,
    brokerTotalUsd: money(brokerTotal),
    customerTotalUsd: markedUp(brokerTotal, markupPct),
  };
}

function shipmentWeightLb(skid: FreightSkid): number {
  return skid.items.reduce((sum, item) => sum + item.weight, 0);
}

async function priority1Option(
  destZip: string,
  skid: FreightSkid,
  accessorials: readonly Priority1AccessorialCode[],
  markupPct: number,
): Promise<FulfillmentOption> {
  const quoted: Priority1QuoteResult = await getPriority1Quote(
    skid,
    CC_PATIO_PICKUP_ZIP,
    destZip,
    accessorials,
  );
  const carriers = (quoted.response.rateQuotes ?? [])
    .map((quote) => carrierQuote(quote, markupPct))
    .sort((left, right) => left.customerTotalUsd - right.customerTotalUsd);

  if (carriers.length === 0) {
    const reasons = (quoted.response.invalidRateQuotes ?? [])
      .flatMap((quote) => quote.errorMessages ?? [])
      .map((message) => message.text)
      .filter((text): text is string => Boolean(text));
    const detail = reasons.length > 0 ? ` ${reasons.join(" ")}` : "";
    throw new FreightRatingError(`Priority1 returned no rate quotes.${detail}`);
  }

  const lowest = carriers[0];
  return {
    method: "PRIORITY1_LTL",
    priceUsd: lowest.customerTotalUsd,
    currency: "USD",
    summary: `Priority1 LTL from ${lowest.carrierName} (${lowest.carrierCode}), broker $${lowest.brokerTotalUsd.toFixed(2)} plus ${markupPct}% handling.`,
    carriers,
  };
}

/**
 * Hybrid routing:
 * - inside the local radius: white-glove at the configured fee
 * - inside the fleet radius: company truck and a marked-up Priority1 quote
 * - beyond the fleet: Priority1 only
 */
export async function calculateFulfillmentOptions(
  destZip: string,
  distanceMiles: number,
  skid: FreightSkid,
  accessorials: readonly Priority1AccessorialCode[] = RESIDENTIAL_DELIVERY,
): Promise<FulfillmentPlan> {
  if (!Number.isFinite(distanceMiles) || distanceMiles < 0) {
    throw new FreightRatingError("distanceMiles must be zero or greater");
  }

  const settings = await getLogisticsSettings();
  const destinationZip = destZip.trim();
  const options: FulfillmentOption[] = [];

  if (distanceMiles <= settings.localRadiusMiles) {
    options.push({
      method: "LOCAL_WHITE_GLOVE",
      priceUsd: settings.localWhiteGloveFee,
      currency: "USD",
      summary: `Local white-glove inside ${settings.localRadiusMiles} miles.`,
    });
  } else if (distanceMiles <= settings.fleetMaxRadiusMiles) {
    const priceUsd = fleetCustomerTotal(
      requireFleetTariff(settings),
      distanceMiles,
      shipmentWeightLb(skid),
    );
    options.push({
      method: "INTERNAL_FLEET",
      priceUsd,
      currency: "USD",
      summary: `CC Patio truck inside the ${settings.fleetMaxRadiusMiles}-mile fleet radius at $${priceUsd.toFixed(2)}.`,
    });
    options.push(
      await priority1Option(
        destinationZip,
        skid,
        accessorials,
        settings.ltlHandlingMarkupPct,
      ),
    );
  } else {
    options.push(
      await priority1Option(
        destinationZip,
        skid,
        accessorials,
        settings.ltlHandlingMarkupPct,
      ),
    );
  }

  return {
    originZip: CC_PATIO_PICKUP_ZIP,
    destinationZip,
    distanceMiles,
    options,
  };
}
