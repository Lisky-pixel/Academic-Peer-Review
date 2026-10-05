import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_PATH, SESSION_COOKIE_NAME } from "@/lib/auth/routes";

/**
 * Route-group protection — the first, cheapest check.
 *
 * Sends anyone with no session cookie to the login page before a protected
 * route renders, remembering where they were going. It only looks at whether
 * the cookie is present: it cannot tell if the session is still valid or which
 * role it carries, and deliberately does not ask the database on every
 * request and prefetch. That is the job of the guards in lib/auth/guards.ts,
 * which every protected page and server action calls. Nothing is secure
 * because of this file alone.
 */
export default function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();

  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

// Must be literals — Next reads this statically at build time. Keep in step
// with HOME_PATH in lib/auth/routes.ts when a role area is added. /profile is
// shared by every role.
export const config = {
  matcher: ["/dashboard/:path*", "/reviewer/:path*", "/admin/:path*", "/profile/:path*"],
};
