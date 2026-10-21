/**
 * GoHighLevel custom-menu links substitute merge fields into the iframe URL.
 * The showroom reads `ghlUserId` and `ghlUserEmail`. Older links used `userId`.
 */

const USER_ID_KEYS = ["ghluserid", "userid", "user_id"] as const;
const EMAIL_KEYS = ["ghluseremail", "useremail", "user_email"] as const;
const OPPORTUNITY_KEYS = ["opportunityid", "opportunity_id"] as const;
const QUOTE_KEYS = ["quoteid", "quote_id"] as const;
const CONTACT_KEYS = ["contactid", "contact_id"] as const;
const LOCATION_KEYS = ["locationid", "location_id"] as const;

export type EmbedActorParams = {
  ghlUserId?: string;
  ghlUserEmail?: string;
};

function pick(pairs: Iterable<[string, string]>, keys: readonly string[]): string | undefined {
  const found = new Map<string, string>();
  for (const [key, value] of pairs) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    // A menu opened where the CRM has no such record can leave "{{opportunity.id}}" unfilled.
    // That is no id at all, so it must not be sent to the CRM as one.
    if (/\{\{[^}]*\}\}/.test(trimmed)) continue;
    const lower = key.toLowerCase();
    if (!found.has(lower)) found.set(lower, trimmed);
  }
  for (const key of keys) {
    const value = found.get(key);
    if (value) return value;
  }
  return undefined;
}

function pairsFromRecord(
  input: Record<string, string | string[] | undefined> | null | undefined,
): [string, string][] {
  const pairs: [string, string][] = [];
  if (!input) return pairs;
  for (const [key, value] of Object.entries(input)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item === "string") pairs.push([key, item]);
    }
  }
  return pairs;
}

export function readActorFromSearchRecord(
  input: Record<string, string | string[] | undefined>,
): EmbedActorParams {
  const pairs = pairsFromRecord(input);
  return {
    ghlUserId: pick(pairs, USER_ID_KEYS),
    ghlUserEmail: pick(pairs, EMAIL_KEYS),
  };
}

export function readOpportunityIdFromSearchRecord(
  input: Record<string, string | string[] | undefined>,
): string | undefined {
  return pick(pairsFromRecord(input), OPPORTUNITY_KEYS);
}

export function readQuoteIdFromSearchRecord(
  input: Record<string, string | string[] | undefined>,
): string | undefined {
  return pick(pairsFromRecord(input), QUOTE_KEYS);
}

export function readContactIdFromSearchRecord(
  input: Record<string, string | string[] | undefined>,
): string | undefined {
  return pick(pairsFromRecord(input), CONTACT_KEYS);
}

export function readLocationIdFromSearchRecord(
  input: Record<string, string | string[] | undefined>,
): string | undefined {
  return pick(pairsFromRecord(input), LOCATION_KEYS);
}

function pairsFromHref(href: string): [string, string][] {
  const url = new URL(href, "https://ccpatio.local");
  const pairs: [string, string][] = [...url.searchParams.entries()];
  const hash = url.hash.replace(/^#/, "");
  if (hash.includes("=")) {
    const hashQuery = hash.startsWith("?") ? hash.slice(1) : hash;
    pairs.push(...new URLSearchParams(hashQuery).entries());
  }
  return pairs;
}

/** Browser URL, including a query string parked in the hash. */
export function readActorFromHref(href: string): EmbedActorParams {
  const pairs = pairsFromHref(href);
  return {
    ghlUserId: pick(pairs, USER_ID_KEYS),
    ghlUserEmail: pick(pairs, EMAIL_KEYS),
  };
}

export function readOpportunityIdFromHref(href: string): string | undefined {
  return pick(pairsFromHref(href), OPPORTUNITY_KEYS);
}

/** Query params of the current URL, with any query string parked in the hash merged in. */
function paramsFromHref(href: string): URLSearchParams {
  const url = new URL(href, "https://ccpatio.local");
  const params = new URLSearchParams(url.search);
  const hash = url.hash.replace(/^#/, "");
  if (hash.includes("=")) {
    const hashQuery = hash.startsWith("?") ? hash.slice(1) : hash;
    for (const [key, value] of new URLSearchParams(hashQuery)) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  return params;
}

/** Drops every opportunity, quote and contact param, whatever its casing. */
function withoutCustomerSelection(params: URLSearchParams): URLSearchParams {
  const selection = new Set<string>([...OPPORTUNITY_KEYS, ...QUOTE_KEYS, ...CONTACT_KEYS]);
  for (const key of [...params.keys()]) {
    if (selection.has(key.toLowerCase())) params.delete(key);
  }
  return params;
}

function orderDeskPathFromParams(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `/embed/order-desk?${query}` : "/embed/order-desk";
}

/**
 * Order Desk URL for a customer picked in the search hub. Keeps the embed key and actor params,
 * so the iframe stays signed in and the page loads exactly as if it had been opened from the CRM.
 */
export function orderDeskPathForCustomer(
  href: string,
  target: { opportunityId: string; contactId?: string | null },
): string {
  const params = withoutCustomerSelection(paramsFromHref(href));
  params.set("opportunityId", target.opportunityId);
  const contactId = target.contactId?.trim();
  if (contactId) params.set("contactId", contactId);
  return orderDeskPathFromParams(params);
}

/** Order Desk URL with no customer selected, so the search hub shows again. */
export function orderDeskSearchPathFromHref(href: string): string {
  return orderDeskPathFromParams(withoutCustomerSelection(paramsFromHref(href)));
}

/** Order Desk URL that keeps the current embed key and actor params. */
export function orderDeskPathFromHref(
  href: string,
  target: { quoteId: string; opportunityId: string | null },
): string {
  const url = new URL(href, "https://ccpatio.local");
  const params = new URLSearchParams(url.search);
  const hash = url.hash.replace(/^#/, "");
  if (hash.includes("=")) {
    const hashQuery = hash.startsWith("?") ? hash.slice(1) : hash;
    for (const [key, value] of new URLSearchParams(hashQuery)) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  if (target.opportunityId) {
    params.set("opportunityId", target.opportunityId);
    params.delete("quoteId");
  } else {
    params.set("quoteId", target.quoteId);
    params.delete("opportunityId");
  }
  const query = params.toString();
  return query ? `/embed/order-desk?${query}` : "/embed/order-desk";
}
