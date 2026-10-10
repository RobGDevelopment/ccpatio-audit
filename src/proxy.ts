import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  E2E_GODMODE_COOKIE,
  getE2eGodModeSecret,
  verifyE2eGodModeCookie,
} from "@/lib/e2e-god-mode";
import {
  createSupabaseFetch,
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabase-env";
import {
  supabaseAuthCookieOptions,
  withEmbeddableAuthCookie,
} from "@/utils/supabase/auth-cookie";
import {
  EMBED_AUTH_COOKIE,
  EMBED_AUTH_HEADER,
  EMBED_CONTEXT_HEADER,
  EMBED_KEY_HEADER,
  embedAuthCookieOptions,
} from "@/lib/embed-auth";
import {
  MissionControlUnauthorizedError,
  assertMissionControlGrant,
} from "@/server/mission-control/require-role";

const PUBLIC_PATHS = new Set(["/", "/api/health"]);
const STOCK_CHECKER_PATH = "/tools/stock-checker";
const LOGISTICS_PATH = "/admin/logistics";
const EMBED_PREFIX = "/embed";
const PROTECTED_PREFIXES = [
  "/admin",
  "/showroom",
  "/embed",
  "/topology",
  "/presentation",
  "/mission-control",
];
const SUPER_ADMIN_PREFIXES = ["/mission-control", "/admin/keys"];
const BYPASS_PREFIXES = ["/api/inngest", "/api/webhooks"];
const GHL_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://app.gohighlevel.com https://*.gohighlevel.com https://*.leadconnectorhq.com https://*.highlevel.com https://*.msgsndr.com";

function isPublicAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  );
}

function isBypassedPath(pathname: string): boolean {
  return BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isEmbedPath(pathname: string): boolean {
  return pathname === EMBED_PREFIX || pathname.startsWith(`${EMBED_PREFIX}/`);
}

function isLogisticsPath(pathname: string): boolean {
  return pathname === LOGISTICS_PATH || pathname.startsWith(`${LOGISTICS_PATH}/`);
}

function isCutCardsPath(pathname: string): boolean {
  return pathname.startsWith("/factory/cut-cards");
}

function isMissionControlPath(pathname: string): boolean {
  return pathname === "/mission-control" || pathname.startsWith("/mission-control/");
}

function isGhlFrameablePath(pathname: string): boolean {
  if (isMissionControlPath(pathname)) return false;
  return isEmbedPath(pathname) || pathname === STOCK_CHECKER_PATH || isLogisticsPath(pathname);
}

/** Login redirect target. Only same-origin paths can inherit the embed allowlist. */
function frameableLoginTarget(request: NextRequest): boolean {
  const next = request.nextUrl.searchParams.get("next")?.trim() ?? "";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.includes("//")) {
    return false;
  }
  try {
    return isGhlFrameablePath(new URL(next, request.nextUrl.origin).pathname);
  } catch {
    return false;
  }
}

function isUnframeablePath(pathname: string): boolean {
  if (isLogisticsPath(pathname)) return false;
  return (
    pathname === "/" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    isCutCardsPath(pathname) ||
    isMissionControlPath(pathname)
  );
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function requiresSuperAdmin(pathname: string): boolean {
  return SUPER_ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function applyFramePolicy(
  response: NextResponse,
  pathname: string,
  request: NextRequest,
): NextResponse {
  // GHL follows the unauthenticated redirect onto `/?next=/admin/logistics`.
  // That login document must use the embed allowlist or the iframe refuses to connect.
  if (isGhlFrameablePath(pathname) || (pathname === "/" && frameableLoginTarget(request))) {
    response.headers.set("Content-Security-Policy", GHL_FRAME_ANCESTORS);
    response.headers.delete("X-Frame-Options");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  if (isUnframeablePath(pathname)) {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    response.headers.set("X-Frame-Options", "DENY");
  }
  return response;
}

function embedKeyFromRequest(request: NextRequest): string | null {
  const key = request.nextUrl.searchParams.get("embedKey")?.trim() ?? "";
  if (!key || key.length > 256 || /[\r\n]/.test(key)) return null;
  return key;
}

function requestHeadersFor(
  request: NextRequest,
  pathname: string,
  embedKey: string | null,
): Headers {
  const headers = new Headers(request.headers);
  headers.delete(EMBED_AUTH_HEADER);
  headers.delete(EMBED_KEY_HEADER);
  if (isEmbedPath(pathname)) headers.set(EMBED_CONTEXT_HEADER, "1");
  else headers.delete(EMBED_CONTEXT_HEADER);
  if (embedKey) headers.set(EMBED_KEY_HEADER, embedKey);
  return headers;
}

function continueWithRequest(requestHeaders: Headers): NextResponse {
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname) || isBypassedPath(pathname)) {
    return continueWithRequest(requestHeadersFor(request, pathname, null));
  }

  if (isCutCardsPath(pathname)) {
    return applyFramePolicy(continueWithRequest(requestHeadersFor(request, pathname, null)), pathname, request);
  }

  if (pathname === STOCK_CHECKER_PATH) {
    return applyFramePolicy(
      continueWithRequest(requestHeadersFor(request, pathname, null)),
      pathname,
      request,
    );
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return applyFramePolicy(
      continueWithRequest(requestHeadersFor(request, pathname, null)),
      pathname,
      request,
    );
  }

  if (!isProtectedPath(pathname)) {
    return continueWithRequest(requestHeadersFor(request, pathname, null));
  }

  const embedKey =
    isEmbedPath(pathname) && !isMissionControlPath(pathname)
      ? embedKeyFromRequest(request)
      : null;
  const requestHeaders = requestHeadersFor(request, pathname, embedKey);
  if (isEmbedPath(pathname)) {
    const response = continueWithRequest(requestHeaders);
    if (embedKey) {
      response.cookies.set(EMBED_AUTH_COOKIE, embedKey, embedAuthCookieOptions());
    }
    return applyFramePolicy(response, pathname, request);
  }

  const e2eToken =
    request.cookies.get(E2E_GODMODE_COOKIE)?.value ??
    request.headers.get("x-ccpatio-e2e-godmode");
  const e2e = await verifyE2eGodModeCookie(e2eToken, getE2eGodModeSecret());
  if (e2e && !isMissionControlPath(pathname)) {
    return applyFramePolicy(continueWithRequest(requestHeaders), pathname, request);
  }

  const supabaseUrl = getSupabaseUrl();
  const supabasePublishableKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabasePublishableKey) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.searchParams.set("next", pathname);
    return applyFramePolicy(NextResponse.redirect(loginUrl), pathname, request);
  }

  let supabaseResponse = continueWithRequest(requestHeaders);

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookieOptions: supabaseAuthCookieOptions,
      global: {
        fetch: createSupabaseFetch(supabasePublishableKey),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = continueWithRequest(requestHeaders);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, withEmbeddableAuthCookie(options)),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.searchParams.set("next", pathname);
    return applyFramePolicy(NextResponse.redirect(loginUrl), pathname, request);
  }

  if (requiresSuperAdmin(pathname)) {
    const { data: roleData, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("id", user.id)
      .single();

    try {
      assertMissionControlGrant({
        email: user.email,
        role: error || !roleData ? null : roleData.role,
      });
    } catch (err) {
      if (!(err instanceof MissionControlUnauthorizedError)) throw err;
      const unauthorizedUrl = request.nextUrl.clone();
      unauthorizedUrl.pathname = "/admin";
      return applyFramePolicy(NextResponse.redirect(unauthorizedUrl), pathname, request);
    }
  }

  return applyFramePolicy(supabaseResponse, pathname, request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
