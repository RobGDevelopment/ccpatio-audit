/**
 * SSR auth gate for `/embed/admin/master-catalog`.
 * Mints embed tokens for valid GHL `?key=` / `?access_key=` / `?embedKey=`
 * and enforces the executive email allowlist when a real email is present.
 */

import {
  canAccessEcommercePortal,
  canAccessFullMasterCatalog,
} from "@/server/ecommerce/ecommerce-32-finish-roster";
import { headers } from "next/headers";
import {
  EMBED_TOKEN_HEADER,
  embedAuthCookieValue,
  embedKeyFromSearchRecord,
  embedKeyIsValid,
  extractEmbedTokenFromHeaders,
  getGhlEmbedSecret,
  mintEmbedSessionToken,
  sanitizeEmbedEmailParam,
  verifyEmbedSessionToken,
} from "@/lib/embed-auth";
import { readActorFromSearchRecord } from "@/lib/embed-actor-params";
import { getPimSession, isEmbedPrincipal } from "@/lib/pim-audit";

export type MasterCatalogAuthOk = {
  ok: true;
  embedToken: string | null;
  email: string | null;
  canAccess: boolean;
  canFullCatalog: boolean;
  embedAuthCookie: string | null;
};

export type MasterCatalogAuthDenied = {
  ok: false;
  reason: "missing_key" | "email_denied";
  message: string;
  setupUrl: string;
};

export type MasterCatalogAuthResult = MasterCatalogAuthOk | MasterCatalogAuthDenied;

const SETUP_HINT =
  "/embed/admin/master-catalog?key=<GHL_EMBED_SECRET>&email={{user.email}}";

export async function resolveMasterCatalogEmbedAuth(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<MasterCatalogAuthResult> {
  const secret = getGhlEmbedSecret();
  const presentedKey = embedKeyFromSearchRecord(searchParams);
  const keyOk = embedKeyIsValid(presentedKey, secret);

  const actor = readActorFromSearchRecord(searchParams);
  const emailRaw =
    sanitizeEmbedEmailParam(actor.ghlUserEmail) ??
    sanitizeEmbedEmailParam(
      typeof searchParams.email === "string"
        ? searchParams.email
        : Array.isArray(searchParams.email)
          ? searchParams.email[0]
          : null,
    );

  const session = await getPimSession();
  const embedSession = isEmbedPrincipal(session) || keyOk;

  let role: string | null = null;
  // Session cookie path — role resolved by callers that need DB; email/role
  // from session is enough for the gate when no query email is present.
  const sessionEmail = session?.email ?? null;

  if (!keyOk && !session) {
    return {
      ok: false,
      reason: "missing_key",
      message: "Missing or invalid GHL embed key (?key=...)",
      setupUrl: SETUP_HINT,
    };
  }

  // When a real interpolated email is present, enforce the executive allowlist.
  if (emailRaw) {
    const allowed = canAccessEcommercePortal({
      email: emailRaw,
      role: null,
      embedSession: false,
    });
    if (!allowed) {
      return {
        ok: false,
        reason: "email_denied",
        message:
          "Limited to Mia, Kian, Rob (rjg.cal@gmail.com), SuperAdmin, and authorized executive GHL embed sessions.",
        setupUrl: SETUP_HINT,
      };
    }
  }

  const effectiveEmail = emailRaw ?? sessionEmail;
  const canAccess = canAccessEcommercePortal({
    email: effectiveEmail,
    role,
    embedSession,
  });
  if (!canAccess) {
    return {
      ok: false,
      reason: "email_denied",
      message:
        "Limited to Mia, Kian, Rob (rjg.cal@gmail.com), SuperAdmin, and authorized executive GHL embed sessions.",
      setupUrl: SETUP_HINT,
    };
  }

  const hdrs = await headers();
  const existingToken =
    extractEmbedTokenFromHeaders((n) => hdrs.get(n)) ??
    hdrs.get(EMBED_TOKEN_HEADER);
  let embedToken: string | null = null;
  if (existingToken && (await verifyEmbedSessionToken(existingToken, secret))) {
    embedToken = existingToken;
  } else if (secret) {
    embedToken = await mintEmbedSessionToken(secret);
  }

  if (!embedToken && !session) {
    return {
      ok: false,
      reason: "missing_key",
      message: "Missing or invalid GHL embed key (?key=...)",
      setupUrl: SETUP_HINT,
    };
  }

  const embedAuthCookie = secret ? await embedAuthCookieValue(secret) : null;

  return {
    ok: true,
    embedToken,
    email: effectiveEmail,
    canAccess: true,
    canFullCatalog: canAccessFullMasterCatalog({
      email: effectiveEmail,
      role,
    }),
    embedAuthCookie,
  };
}
