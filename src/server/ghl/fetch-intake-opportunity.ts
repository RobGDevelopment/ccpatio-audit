import { asGhlRecord, ghlGet, readGhlConfig } from "./private-api";
import { text, personName } from "./parse";
import { UpstreamBusyError } from "./search-opportunities";
import { IntakeDomainError } from "@/server/factory-bom/intake/errors";

export type IntakeOpportunityDetails = {
  id: string;
  name: string;
  contactName: string;
  valueCents: number | null;
  status: "open" | "won";
};

export async function fetchIntakeOpportunity(
  id: string,
  options?: {
    getGhl?: typeof ghlGet;
    locationId?: string;
  }
): Promise<IntakeOpportunityDetails> {
  const cleanId = id.trim();
  if (!cleanId) {
    throw new IntakeDomainError("PROJECT_REQUIRED");
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

  let res: Awaited<ReturnType<typeof getter>>;
  try {
    res = await getter(`/opportunities/${encodeURIComponent(cleanId)}`);
  } catch (err: unknown) {
    console.error("GHL fetch opportunity threw:", err instanceof Error ? err.name : "Unknown");
    throw new UpstreamBusyError();
  }

  if (!res.ok) {
    if (res.error && res.error.includes("404")) {
      throw new IntakeDomainError("PROJECT_NOT_FOUND");
    }
    throw new UpstreamBusyError();
  }

  const root = asGhlRecord(res.body);
  const opp = asGhlRecord(root?.opportunity) || root;
  if (!opp) {
    throw new IntakeDomainError("PROJECT_NOT_FOUND");
  }

  const returnedId = text(opp.id);
  if (returnedId !== cleanId) {
    throw new IntakeDomainError("PROJECT_NOT_FOUND");
  }

  const returnedLoc = text(opp.locationId) || text(opp.location_id);
  if (returnedLoc && locationId && returnedLoc !== locationId) {
    throw new IntakeDomainError("PROJECT_NOT_FOUND");
  }

  const status = text(opp.status).toLowerCase();
  if (status !== "open" && status !== "won") {
    throw new IntakeDomainError("PROJECT_CLOSED");
  }

  const name = text(opp.name);
  if (!name) {
    throw new IntakeDomainError("PROJECT_NOT_FOUND");
  }

  const contact = asGhlRecord(opp.contact);
  const contactName =
    text(opp.contactName) ||
    text(opp.contact_name) ||
    personName(contact) ||
    "Contact";

  const rawVal = opp.monetaryValue ?? opp.monetary_value;
  let valueCents: number | null = null;
  if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
    valueCents = Math.round(rawVal * 100);
  } else if (typeof rawVal === "string" && rawVal.trim().length > 0) {
    const parsed = parseFloat(rawVal);
    if (Number.isFinite(parsed)) {
      valueCents = Math.round(parsed * 100);
    }
  }

  return {
    id: cleanId,
    name,
    contactName,
    valueCents,
    status,
  };
}
