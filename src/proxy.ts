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

const PUBLIC_PATHS = new Set(["/", "/api/health"]);
const PROTECTED_PREFIXES = ["/admin", "/topology", "/presentation", "/mission-control"];
const SUPER_ADMIN_PREFIXES = ["/mission-control", "/admin/keys"];
const BYPASS_PREFIXES = ["/api/inngest", "/api/webhooks"];

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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname) || PUBLIC_PATHS.has(pathname) || isBypassedPath(pathname)) {
    return NextResponse.next();
  }

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const e2eToken =
    request.cookies.get(E2E_GODMODE_COOKIE)?.value ??
    request.headers.get("x-ccpatio-e2e-godmode");
  const e2e = await verifyE2eGodModeCookie(e2eToken, getE2eGodModeSecret());
  if (e2e) {
    return NextResponse.next({ request });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabasePublishableKey = getSupabasePublishableKey();
  if (!supabaseUrl || !supabasePublishableKey) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      global: {
        fetch: createSupabaseFetch(supabasePublishableKey),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
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
      return NextResponse.redirect(unauthorizedUrl);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
