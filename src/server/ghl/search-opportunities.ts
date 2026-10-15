import { asGhlRecord, ghlGet, readGhlConfig } from "./private-api";
import { text, records, personName } from "./parse";

export class UpstreamBusyError extends Error {
  public readonly code = "UPSTREAM_BUSY";
  constructor(message: string = "GoHighLevel is busy. Try again in a moment.") {
    super(message);
    this.name = "UpstreamBusyError";
  }
}

export type OpportunityHit = {
  id: string;
  name: string;
  contactName: string;
  valueCents: number | null;
};

export async function searchOpportunities(
  query: string,
  options?: {
    getGhl?: typeof ghlGet;
    locationId?: string;
  }
): Promise<OpportunityHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    return [];
  }

  const getter = options?.getGhl ?? ghlGet;
  let locationId = options?.locationId;
  if (!locationId) {
    const config = readGhlConfig();
    if ("error" in config) {
      throw new UpstreamBusyError();
    }
    locationId = config.locationId;
  }

  const encoded = encodeURIComponent(trimmed);
  const openPath = `/opportunities/search?location_id=${locationId}&q=${encoded}&status=open&limit=20`;
  const wonPath = `/opportunities/search?location_id=${locationId}&q=${encoded}&status=won&limit=20`;

  let openRes: Awaited<ReturnType<typeof getter>>;
  let wonRes: Awaited<ReturnType<typeof getter>>;

  try {
    [openRes, wonRes] = await Promise.all([
      getter(openPath),
      getter(wonPath),
    ]);
  } catch (err: unknown) {
    console.error("GHL opportunity search request threw:", err instanceof Error ? err.name : "Unknown");
    throw new UpstreamBusyError();
  }

  if (!openRes.ok || !wonRes.ok) {
    console.error("GHL opportunity search returned non-ok status");
    throw new UpstreamBusyError();
  }

  const openRows = records(openRes.body, "opportunities");
  const wonRows = records(wonRes.body, "opportunities");
  const combined = [...openRows, ...wonRows];

  const hitsMap = new Map<string, OpportunityHit>();

  for (const row of combined) {
    const id = text(row.id);
    const name = text(row.name);
    if (!id || !name) continue;

    const contact = asGhlRecord(row.contact);
    const contactName =
      text(row.contactName) ||
      text(row.contact_name) ||
      personName(contact) ||
      "Contact";

    const rawVal = row.monetaryValue ?? row.monetary_value;
    let valueCents: number | null = null;
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      valueCents = Math.round(rawVal * 100);
    } else if (typeof rawVal === "string" && rawVal.trim().length > 0) {
      const parsed = parseFloat(rawVal);
      if (Number.isFinite(parsed)) {
        valueCents = Math.round(parsed * 100);
      }
    }

    if (!hitsMap.has(id)) {
      hitsMap.set(id, {
        id,
        name,
        contactName,
        valueCents,
      });
    }
  }

  const results = Array.from(hitsMap.values());
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results.slice(0, 20);
}
