/**
 * GoHighLevel custom-menu links substitute merge fields into the iframe URL.
 * The showroom reads `ghlUserId` and `ghlUserEmail`. Older links used `userId`.
 */

const USER_ID_KEYS = ["ghluserid", "userid", "user_id"] as const;
const EMAIL_KEYS = ["ghluseremail", "useremail", "user_email"] as const;
const OPPORTUNITY_KEYS = ["opportunityid", "opportunity_id"] as const;

export type EmbedActorParams = {
  ghlUserId?: string;
  ghlUserEmail?: string;
};

function pick(pairs: Iterable<[string, string]>, keys: readonly string[]): string | undefined {
  const found = new Map<string, string>();
  for (const [key, value] of pairs) {
    const trimmed = value.trim();
    if (!trimmed) continue;
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
  input: Record<string, string | string[] | undefined>,
): [string, string][] {
  const pairs: [string, string][] = [];
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
