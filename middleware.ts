import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const config = {
  // Protect everything except Next.js internals and favicon
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Den Coach"',
    },
  });
}

export function middleware(req: NextRequest) {
  // Make rep images public so Looker Studio can load them
  if (req.nextUrl.pathname.startsWith("/reps/")) {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) {
    return unauthorized();
  }

  const base64 = auth.slice("Basic ".length);
  const decoded = atob(base64);
  const [user, pass] = decoded.split(":");

  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;

  // If env vars are missing, deny by default
  if (!expectedUser || !expectedPass) {
    return unauthorized();
  }

  if (user !== expectedUser || pass !== expectedPass) {
    return unauthorized();
  }

  return NextResponse.next();
}
