import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { auth0 } from "./lib/auth0";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Keep sales-rep images public so Looker Studio can load them.
  if (pathname.startsWith("/reps/")) {
    return NextResponse.next();
  }

  // Let Auth0 handle login, callback, and logout routes.
  const authResponse = await auth0.middleware(request);

  if (pathname.startsWith("/auth/")) {
    return authResponse;
  }

  const session = await auth0.getSession(request);

  if (session) {
    return authResponse;
  }

  // API requests receive an authorization error instead of a login webpage.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const loginUrl = new URL("/auth/login", request.url);

  loginUrl.searchParams.set(
    "returnTo",
    `${pathname}${request.nextUrl.search}`
  );

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};