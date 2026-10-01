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

const PUBLIC_PATHS = new Set(["/", "/api/health"]);
const STOCK_CHECKER_PATH = "/tools/stock-checker";
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

function isUnframeablePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/admin" || pathname.startsWith("/admin/");
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

function applyFramePolicy(response: NextResponse, pathname: string): NextResponse {
  if (isEmbedPath(pathname) || pathname === STOCK_CHECKER_PATH) {
    response.headers.set("Content-Security-Policy", GHL_FRAME_ANCESTORS);
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

  if (pathname === STOCK_CHECKER_PATH) {
    return applyFramePolicy(
      continueWithRequest(requestHeadersFor(request, pathname, null)),
      pathname,
    );
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return applyFramePolicy(
      continueWithRequest(requestHeadersFor(request, pathname, null)),
      pathname,
    );
  }

  if (!isProtectedPath(pathname)) {
    return continueWithRequest(requestHeadersFor(request, pathname, null));
  }

  const embedKey = isEmbedPath(pathname) ? embedKeyFromRequest(request) : null;
  const requestHeaders = requestHeadersFor(request, pathname, embedKey);
  if (isEmbedPath(pathname)) {
    const response = continueWithRequest(requestHeaders);
    if (embedKey) {
      response.cookies.set(EMBED_AUTH_COOKIE, embedKey, embedAuthCookieOptions());
    }
    return applyFramePolicy(response, pathname);
  }

  const e2eToken =
    request.cookies.get(E2E_GODMODE_COOKIE)?.value ??
    request.headers.get("x-ccpatio-e2e-godmode");
  const e2e = await verifyE2eGodModeCookie(e2eToken, getE2eGodModeSecret());
  if (e2e) {
    return applyFramePolicy(continueWithRequest(requestHeaders), pathname);
  }

  const supabaseUrl = getSupabaseUrl();
  const supabasePublishableKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabasePublishableKey) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.searchParams.set("next", pathname);
    return applyFramePolicy(NextResponse.redirect(loginUrl), pathname);
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
    return applyFramePolicy(NextResponse.redirect(loginUrl), pathname);
  }

  if (requiresSuperAdmin(pathname)) {
    const { data: roleData, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (error || !roleData || (roleData.role !== "SuperAdmin" && roleData.role !== "IT_Admin")) {
      const unauthorizedUrl = request.nextUrl.clone();
      unauthorizedUrl.pathname = "/admin";
      return applyFramePolicy(NextResponse.redirect(unauthorizedUrl), pathname);
    }
  }

  return applyFramePolicy(supabaseResponse, pathname);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
