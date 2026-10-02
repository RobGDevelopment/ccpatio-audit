import { GHL_EMBED_PRINCIPAL_EMAIL, getPimSession } from "@/lib/pim-audit";
import { createClient } from "@/utils/supabase/server";
import { asGhlRecord, ghlGet } from "./private-api";

export type HoldActor = {
  ghlUserId: string;
  ghlUserName: string;
  ghlUserEmail: string | null;
};

export type HoldOpportunity = {
  id: string;
  name: string;
  contactId: string;
  status: "open" | "won";
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrap(body: unknown, key: string): Record<string, unknown> | null {
  const record = asGhlRecord(body);
  if (!record) return null;
  const nested = asGhlRecord(record[key]);
  if (nested) return nested;
  return record;
}

function userInLocation(user: Record<string, unknown>, locationId: string): boolean {
  if (text(user.locationId) === locationId) return true;
  const roles = asGhlRecord(user.roles);
  const roleIds = roles?.locationIds;
  if (Array.isArray(roleIds) && roleIds.some((id) => String(id) === locationId)) {
    return true;
  }
  const permissions = asGhlRecord(user.permissions);
  const locations = permissions?.locations;
  if (Array.isArray(locations) && locations.some((id) => String(id) === locationId)) {
    return true;
  }
  return false;
}

function displayName(user: Record<string, unknown>): string {
  const name = text(user.name);
  if (name) return name;
  return `${text(user.firstName)} ${text(user.lastName)}`.trim();
}

async function directActorId(email: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.id) return user.id;
  } catch {
    // God-mode cookies have no Supabase user. The email stays the stable id.
  }
  return email;
}

/**
 * Salesperson stored on the hold. Embed callers are named by the Users API.
 * A display name in the request is never accepted.
 */
export async function resolveHoldActor(input: {
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<{ ok: true } & HoldActor | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to place a hold." };

  if (session.email !== GHL_EMBED_PRINCIPAL_EMAIL) {
    return {
      ok: true,
      ghlUserId: await directActorId(session.email),
      ghlUserName: session.name.trim() || session.email,
      ghlUserEmail: session.email,
    };
  }

  const userId = input.ghlUserId?.trim() ?? "";
  if (!userId) {
    return { ok: false, error: "This embed link has no GoHighLevel user id." };
  }

  const loaded = await ghlGet(`/users/${encodeURIComponent(userId)}`);
  if (!loaded.ok) {
    return { ok: false, error: "GoHighLevel could not confirm this salesperson." };
  }
  const user = unwrap(loaded.body, "user");
  const returnedId = user ? text(user.id) : "";
  if (!user || (returnedId && returnedId !== userId)) {
    return { ok: false, error: "GoHighLevel could not confirm this salesperson." };
  }
  if (!userInLocation(user, loaded.locationId)) {
    return { ok: false, error: "That salesperson is not in this location." };
  }

  const email = text(user.email);
  const hint = input.ghlUserEmail?.trim().toLowerCase() ?? "";
  if (hint && email.toLowerCase() !== hint) {
    return { ok: false, error: "GoHighLevel user email does not match this embed link." };
  }
  const name = displayName(user);
  if (!name) {
    return { ok: false, error: "GoHighLevel did not return a salesperson name." };
  }

  return {
    ok: true,
    ghlUserId: userId,
    ghlUserName: name,
    ghlUserEmail: email || null,
  };
}

/** Re-fetch the opportunity. Lost and abandoned cannot take a hold. */
export async function fetchHoldOpportunity(
  opportunityId: string,
): Promise<{ ok: true } & HoldOpportunity | { ok: false; error: string }> {
  const id = opportunityId.trim();
  if (!id) return { ok: false, error: "Opportunity id is required." };

  const loaded = await ghlGet(`/opportunities/${encodeURIComponent(id)}`);
  if (!loaded.ok) {
    return { ok: false, error: "GoHighLevel could not load that opportunity." };
  }
  const opportunity = unwrap(loaded.body, "opportunity");
  if (!opportunity) {
    return { ok: false, error: "GoHighLevel could not load that opportunity." };
  }

  const returnedId = text(opportunity.id);
  if (returnedId && returnedId !== id) {
    return { ok: false, error: "GoHighLevel returned a different opportunity." };
  }
  const locationId = text(opportunity.locationId);
  if (locationId && locationId !== loaded.locationId) {
    return { ok: false, error: "That opportunity is in a different location." };
  }

  const status = text(opportunity.status).toLowerCase();
  if (status === "lost" || status === "abandoned") {
    return { ok: false, error: "That opportunity is lost or abandoned." };
  }
  if (status !== "open" && status !== "won") {
    return { ok: false, error: "That opportunity cannot take a hold." };
  }

  const contactId = text(opportunity.contactId);
  const name = text(opportunity.name);
  if (!contactId) return { ok: false, error: "That opportunity has no contact." };
  if (!name) return { ok: false, error: "That opportunity has no name." };

  return {
    ok: true,
    id: returnedId || id,
    name,
    contactId,
    status,
  };
}
