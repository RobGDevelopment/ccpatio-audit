"use server";

import { getPimSession } from "@/lib/pim-audit";
import { lookupDockDistance } from "@/server/freight/distance";
import { asGhlRecord, ghlGet, readGhlConfig } from "@/server/ghl/private-api";

/** One line on a sample sales order. Catalog products are not rated from this list. */
export type ReadyToShipSkidItem = {
  weightLb: number;
  freightClass: string;
  lengthIn: number;
  widthIn: number;
};

/**
 * Sample sales orders for the embed queue. Katana sales orders will replace
 * this list. Each line already carries its own footprint. Catalog quotes use
 * logistics_profiles instead.
 */
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
    skidItems: [{ weightLb: 150, freightClass: "175", lengthIn: 72, widthIn: 34 }],
  },
  {
    salesOrderNumber: "SO-1002",
    customerName: "Jane Smith",
    destZip: "60606",
    distanceMiles: 1400,
    skidItems: [{ weightLb: 200, freightClass: "175", lengthIn: 84, widthIn: 36 }],
  },
  {
    salesOrderNumber: "SO-1003",
    customerName: "Bob Vance",
    destZip: "85255",
    distanceMiles: 15,
    skidItems: [{ weightLb: 100, freightClass: "175", lengthIn: 34, widthIn: 34 }],
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

async function requireDispatchSession(): Promise<void> {
  const session = await getPimSession();
  if (!session) {
    throw new Error("Sign in required");
  }
}

/**
 * Measured miles from the Scottsdale dock. An unknown ZIP has no distance.
 */
export async function lookupDockMiles(destZip: string): Promise<number> {
  await requireDispatchSession();
  const zip = destZip.trim();
  if (!/^\d{5}$/.test(zip)) {
    throw new Error("Destination ZIP must be 5 digits.");
  }
  const measured = await lookupDockDistance(zip);
  if (!measured) {
    throw new Error("No measured miles for that ZIP.");
  }
  return measured.miles;
}

type OpportunityDraft = GhlDispatchOpportunity & { contactId: string };

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function zip5(raw: string): string {
  const match = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match?.[1] ?? "";
}

function postalZip(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const direct = [
    record.postalCode,
    record.postal_code,
    record.zipCode,
    record.zip_code,
    record.zip,
  ];
  for (const value of direct) {
    const zip = zip5(text(value));
    if (zip) return zip;
  }
  const address = asGhlRecord(record.address);
  if (!address) return "";
  return (
    zip5(text(address.postalCode)) ||
    zip5(text(address.postal_code)) ||
    zip5(text(address.zip)) ||
    ""
  );
}

function personName(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const direct = text(record.name) || text(record.contactName) || text(record.contact_name);
  if (direct) return direct;
  return `${text(record.firstName) || text(record.first_name)} ${text(record.lastName) || text(record.last_name)}`.trim();
}

function moneyValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function records(body: unknown, key: string): Record<string, unknown>[] {
  const root = asGhlRecord(body);
  const data = asGhlRecord(root?.data);
  const lists = [root?.[key], data?.[key], root?.data];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    return list
      .map((item) => asGhlRecord(item))
      .filter((item): item is Record<string, unknown> => item !== null);
  }
  return [];
}

function unwrapContact(body: unknown): Record<string, unknown> | null {
  const root = asGhlRecord(body);
  if (!root) return null;
  return asGhlRecord(root.contact) ?? root;
}

function mapOpportunity(record: Record<string, unknown>): OpportunityDraft | null {
  const id = text(record.id);
  if (!id) return null;
  const contact = asGhlRecord(record.contact);
  const contactId = text(record.contactId) || text(record.contact_id) || text(contact?.id);
  const contactName =
    personName(contact) ||
    text(record.contactName) ||
    text(record.contact_name) ||
    text(record.name) ||
    "Contact";
  return {
    id,
    contactId,
    contactName,
    destZip: postalZip(contact) || postalZip(record),
    totalValue: moneyValue(record.monetaryValue ?? record.monetary_value),
  };
}

async function fillMissingZips(hits: OpportunityDraft[]): Promise<void> {
  const pending = hits.filter((hit) => hit.contactId && !hit.destZip);
  await Promise.all(
    pending.map(async (hit) => {
      try {
        const loaded = await ghlGet(`/contacts/${encodeURIComponent(hit.contactId)}`);
        if (!loaded.ok) return;
        const contact = unwrapContact(loaded.body);
        const zip = postalZip(contact);
        if (zip) hit.destZip = zip;
        const name = personName(contact);
        if (name) hit.contactName = name;
      } catch {
        // A single contact lookup must not drop the rest of the search.
      }
    }),
  );
}

/**
 * Live GoHighLevel opportunity search for the shipping quote form.
 * Network and API failures return an empty list so the embed stays up.
 */
export async function searchGhlOpportunities(
  query: string,
): Promise<GhlDispatchOpportunity[]> {
  await requireDispatchSession();
  const needle = query.trim();
  if (needle.length < 2) return [];

  try {
    const config = readGhlConfig();
    if ("error" in config) return [];

    const location = encodeURIComponent(config.locationId);
    const encoded = encodeURIComponent(needle);
    const [open, won] = await Promise.all([
      ghlGet(
        `/opportunities/search?location_id=${location}&q=${encoded}&status=open&limit=20`,
      ),
      ghlGet(
        `/opportunities/search?location_id=${location}&q=${encoded}&status=won&limit=20`,
      ),
    ]);
    if (!open.ok && !won.ok) return [];

    const merged = new Map<string, OpportunityDraft>();
    for (const row of [
      ...(open.ok ? records(open.body, "opportunities") : []),
      ...(won.ok ? records(won.body, "opportunities") : []),
    ]) {
      const hit = mapOpportunity(row);
      if (hit && !merged.has(hit.id)) merged.set(hit.id, hit);
    }

    const hits = [...merged.values()].slice(0, 20);
    await fillMissingZips(hits);
    return hits.map((hit) => ({
      id: hit.id,
      contactName: hit.contactName,
      destZip: hit.destZip,
      totalValue: hit.totalValue,
    }));
  } catch {
    // GoHighLevel timeouts and unexpected payload shapes stay off the sales floor.
    return [];
  }
}
