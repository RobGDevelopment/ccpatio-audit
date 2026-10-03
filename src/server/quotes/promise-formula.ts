import type { FulfillmentMethod, FulfillmentPlan } from "@/types/freight";

export const PROMISE_FORMULA = "promise-v1";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/** Add calendar days to a `YYYY-MM-DD` date. */
export function addCalendarDays(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate) || !Number.isInteger(days)) {
    throw new Error("A promise date needs a real calendar date.");
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${nextMonth}-${nextDay}`;
}

export type CapacityDay = {
  serviceDate: string;
  truckCode: string;
  capacityStops: number;
  stopsBooked: number;
  capacityWeightLb: number;
  weightBookedLb: number;
};

/**
 * Earliest truck-day on or after the target with a free stop and enough weight.
 * Same-day ties go to the truck with the most remaining weight.
 * This does not change booked counts.
 */
export function selectPromiseDay(
  days: readonly CapacityDay[],
  target: string,
  shipmentWeightLb: number,
): CapacityDay | null {
  const feasible = days.filter((day) => {
    if (day.serviceDate < target) return false;
    if (day.stopsBooked >= day.capacityStops) return false;
    return day.weightBookedLb + shipmentWeightLb <= day.capacityWeightLb;
  });
  if (feasible.length === 0) return null;
  feasible.sort((left, right) => {
    if (left.serviceDate !== right.serviceDate) {
      return left.serviceDate < right.serviceDate ? -1 : 1;
    }
    const leftRoom = left.capacityWeightLb - left.weightBookedLb;
    const rightRoom = right.capacityWeightLb - right.weightBookedLb;
    if (leftRoom !== rightRoom) return rightRoom - leftRoom;
    return left.truckCode.localeCompare(right.truckCode);
  });
  return feasible[0] ?? null;
}

export function ltlTransitDays(
  snapshot: unknown,
  selectedCarrierCode: string | null,
): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const options = (snapshot as FulfillmentPlan).options;
  if (!Array.isArray(options)) return null;
  const ltl = options.find((option) => option.method === "PRIORITY1_LTL");
  const carriers = ltl?.carriers ?? [];
  const chosen = selectedCarrierCode
    ? carriers.find((carrier) => carrier.carrierCode === selectedCarrierCode) ??
      carriers[0]
    : carriers[0];
  const days = chosen?.transitDays;
  if (days == null || !Number.isInteger(days) || days < 0) return null;
  return days;
}

export function transitDaysForMethod(input: {
  method: FulfillmentMethod | null;
  snapshot: unknown;
  selectedCarrierCode: string | null;
  fleetTransitDays: number;
}): { ok: true; days: number } | { ok: false; error: string } {
  if (input.method === "PRIORITY1_LTL") {
    const days = ltlTransitDays(input.snapshot, input.selectedCarrierCode);
    if (days == null) {
      return { ok: false, error: "The selected carrier has no transit days." };
    }
    return { ok: true, days };
  }
  if (input.method === "LOCAL_WHITE_GLOVE" || input.method === "INTERNAL_FLEET") {
    if (!Number.isInteger(input.fleetTransitDays) || input.fleetTransitDays < 0) {
      return { ok: false, error: "Fleet transit days are not set." };
    }
    return { ok: true, days: input.fleetTransitDays };
  }
  return { ok: false, error: "Rate freight before estimating delivery." };
}
