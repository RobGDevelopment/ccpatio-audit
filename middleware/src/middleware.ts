import { NextResponse, type NextRequest } from "next/server";
import {
  PIM_SESSION_COOKIE,
  verifyPimSessionToken,
} from "@/lib/pim-session";

const PUBLIC_PATHS = new Set(["/", "/api/health"]);

function isPublicAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname) || PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(PIM_SESSION_COOKIE)?.value;
  const session = await verifyPimSessionToken(token);

  if (session) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
