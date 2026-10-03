import { FreightRatingError } from "@/server/freight/priority1";

/** Customer price rounded to cents. */
export function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type FleetTariff = {
  fleetBaseFee: number;
  fleetPerMile: number;
  fleetPerPound: number;
};

/**
 * Company-truck price. Null tariff numbers are a refusal, not a free truck.
 * Zero is a legal rate.
 */
export function fleetCustomerTotal(
  tariff: FleetTariff,
  distanceMiles: number,
  weightLb: number,
): number {
  for (const [label, value] of [
    ["fleet_base_fee", tariff.fleetBaseFee],
    ["fleet_per_mile", tariff.fleetPerMile],
    ["fleet_per_pound", tariff.fleetPerPound],
    ["distance miles", distanceMiles],
    ["shipment weight", weightLb],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new FreightRatingError(`${label} must be zero or greater`);
    }
  }
  return roundCents(
    tariff.fleetBaseFee +
      tariff.fleetPerMile * distanceMiles +
      tariff.fleetPerPound * weightLb,
  );
}

export function requireFleetTariff(input: {
  fleetBaseFee: number | null;
  fleetPerMile: number | null;
  fleetPerPound: number | null;
}): FleetTariff {
  if (
    input.fleetBaseFee == null ||
    input.fleetPerMile == null ||
    input.fleetPerPound == null
  ) {
    throw new FreightRatingError(
      "Internal fleet tariff is not set. fleet_base_fee, fleet_per_mile, and fleet_per_pound are required.",
    );
  }
  return {
    fleetBaseFee: input.fleetBaseFee,
    fleetPerMile: input.fleetPerMile,
    fleetPerPound: input.fleetPerPound,
  };
}
