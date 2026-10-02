import { asGhlRecord, ghlGet, readGhlConfig } from "./private-api";

export type HoldSearchHit = {
  id: string;
  name: string;
  contactId: string;
  contactName: string;
  status: "open" | "won";
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
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

function personName(record: Record<string, unknown> | null): string {
  if (!record) return "";
  const direct =
    text(record.name) ||
    text(record.contactName) ||
    text(record.contact_name) ||
    `${text(record.firstName) || text(record.first_name)} ${text(record.lastName) || text(record.last_name)}`.trim();
  return direct;
}

function asHit(record: Record<string, unknown>): HoldSearchHit | null {
  const status = text(record.status).toLowerCase();
  if (status !== "open" && status !== "won") return null;
  const id = text(record.id);
  const name = text(record.name);
  const contact = asGhlRecord(record.contact);
  const contactId = text(record.contactId) || text(record.contact_id) || text(contact?.id);
  if (!id || !name || !contactId) return null;
  return {
    id,
    name,
    contactId,
    contactName: personName(contact) || text(record.contactName) || "Contact",
    status,
  };
}

async function opportunityHits(path: string): Promise<HoldSearchHit[]> {
  const loaded = await ghlGet(path);
  if (!loaded.ok) throw new Error(loaded.error);
  const rows = records(loaded.body, "opportunities");
  return rows.flatMap((row) => {
    const hit = asHit(row);
    return hit ? [hit] : [];
  });
}

/**
 * Open and won opportunities in this location. A contact with no
 * opportunity is not returned.
 */
export async function searchHoldTargets(
  query: string,
): Promise<{ ok: true; results: HoldSearchHit[] } | { ok: false; error: string }> {
  const q = query.trim();
  if (q.length < 2) return { ok: true, results: [] };

  const config = readGhlConfig();
  if ("error" in config) return { ok: false, error: config.error };

  const location = encodeURIComponent(config.locationId);
  const encoded = encodeURIComponent(q);

  try {
    const [open, won, contactsLoaded] = await Promise.all([
      opportunityHits(
        `/opportunities/search?location_id=${location}&q=${encoded}&status=open&limit=20`,
      ),
      opportunityHits(
        `/opportunities/search?location_id=${location}&q=${encoded}&status=won&limit=20`,
      ),
      ghlGet(`/contacts/?locationId=${location}&query=${encoded}&limit=5`),
    ]);

    const merged = new Map<string, HoldSearchHit>();
    for (const hit of [...open, ...won]) merged.set(hit.id, hit);

    if (contactsLoaded.ok) {
      const contacts = records(contactsLoaded.body, "contacts");
      const extra = await Promise.all(
        contacts.slice(0, 5).map((contact) => {
          const contactId = text(contact.id);
          if (!contactId) return Promise.resolve([] as HoldSearchHit[]);
          return opportunityHits(
            `/opportunities/search?location_id=${location}&contact_id=${encodeURIComponent(contactId)}&limit=20`,
          );
        }),
      );
      for (const hits of extra) {
        for (const hit of hits) {
          if (!merged.has(hit.id)) merged.set(hit.id, hit);
        }
      }
    }

    return { ok: true, results: [...merged.values()].slice(0, 20) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Opportunity search failed.";
    return { ok: false, error: message };
  }
}
