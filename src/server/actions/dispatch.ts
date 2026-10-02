"use server";

import { getPimSession } from "@/lib/pim-audit";

/** Weight and NMFC class for one product on a shared skid. */
export type ReadyToShipSkidItem = {
  weightLb: number;
  freightClass: string;
};

/** Sales order waiting on a freight decision. Katana will replace this mock. */
export type ReadyToShipOrder = {
  salesOrderNumber: string;
  customerName: string;
  destZip: string;
  distanceMiles: number;
  skidItems: ReadyToShipSkidItem[];
};

const READY_TO_SHIP_QUEUE: ReadyToShipOrder[] = [
  {
    salesOrderNumber: "SO-1001",
    customerName: "John Doe",
    destZip: "90210",
    distanceMiles: 400,
    skidItems: [{ weightLb: 150, freightClass: "175" }],
  },
  {
    salesOrderNumber: "SO-1002",
    customerName: "Jane Smith",
    destZip: "60606",
    distanceMiles: 1400,
    skidItems: [{ weightLb: 200, freightClass: "175" }],
  },
  {
    salesOrderNumber: "SO-1003",
    customerName: "Bob Vance",
    destZip: "85255",
    distanceMiles: 15,
    skidItems: [{ weightLb: 100, freightClass: "175" }],
  },
];

/**
 * Mock ready-to-ship queue. Requires the same signed-in operator as the
 * showroom embed (GoHighLevel embed key or a standard session).
 */
export async function getReadyToShipQueue(): Promise<ReadyToShipOrder[]> {
  const session = await getPimSession();
  if (!session) {
    throw new Error("Sign in required");
  }
  return READY_TO_SHIP_QUEUE;
}

/** Opportunity row the dispatch quote form can copy a destination from. */
export type GhlDispatchOpportunity = {
  id: string;
  contactName: string;
  destZip: string;
  totalValue: number;
};

const MOCK_OPPORTUNITIES: GhlDispatchOpportunity[] = [
  {
    id: "opp-85255",
    contactName: "John Doe",
    destZip: "85255",
    totalValue: 4200,
  },
  {
    id: "opp-90210",
    contactName: "Jane Smith",
    destZip: "90210",
    totalValue: 8600,
  },
  {
    id: "opp-10001",
    contactName: "Bob Vance",
    destZip: "10001",
    totalValue: 3100,
  },
];

async function requireDispatchSession(): Promise<void> {
  const session = await getPimSession();
  if (!session) {
    throw new Error("Sign in required");
  }
}

/**
 * Mock road miles from the Scottsdale dock.
 * 85xxx is local, 90xxx is inside the fleet radius, everything else is LTL.
 */
export async function getEstimatedDistance(destZip: string): Promise<number> {
  await requireDispatchSession();
  const zip = destZip.trim();
  if (zip.startsWith("85")) return 45;
  if (zip.startsWith("90")) return 400;
  return 1200;
}

/** Mock opportunity search. The live GoHighLevel client replaces this later. */
export async function searchGhlOpportunities(
  query: string,
): Promise<GhlDispatchOpportunity[]> {
  await requireDispatchSession();
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return MOCK_OPPORTUNITIES.filter((opportunity) => {
    return (
      opportunity.contactName.toLowerCase().includes(needle) ||
      opportunity.destZip.includes(needle) ||
      opportunity.id.toLowerCase().includes(needle)
    );
  });
}
