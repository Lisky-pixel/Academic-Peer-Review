import { type NextRequest, NextResponse } from "next/server";
import { LOGIN_PATH, SESSION_COOKIE_NAME } from "@/lib/auth/routes";

/**
 * Runs in front of every page. It does two jobs.
 *
 * 1. Route protection — the first, cheapest check. Anyone with no session
 *    cookie is sent to the login page before a protected route renders,
 *    remembering where they were going. It only looks at whether the cookie
 *    is present: it cannot tell if the session is still valid or which role
 *    it carries, and deliberately does not ask the database on every request.
 *    That is the job of the guards in lib/auth/guards.ts, which every
 *    protected page and server action calls. Nothing is secure because of
 *    this check alone.
 *
 * 2. Content Security Policy. Each response gets a policy with a fresh
 *    nonce, so the only scripts that can run are the ones this application
 *    served for this request. If a hole elsewhere ever let markup through —
 *    in a document preview, a name, a comment — the browser would still
 *    refuse to execute it.
 */

/** Areas that need a signed-in user. Keep in step with HOME_PATH. */
const PROTECTED = ["/dashboard", "/reviewer", "/organiser", "/admin", "/profile"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Where document bytes live. The browser uploads to and reads previews from
 * storage directly, so that origin must be allowed for connections. Both the
 * endpoint itself and bucket subdomains of it are covered, since R2 and
 * MinIO address buckets differently.
 */
function storageSources(): string {
  try {
    const { protocol, host } = new URL(process.env.STORAGE_ENDPOINT ?? "");
    return `${protocol}//${host} ${protocol}//*.${host}`;
  } catch {
    return "";
  }
}

export function contentSecurityPolicy(nonce: string, isDevelopment: boolean): string {
  const storage = storageSources();
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced scripts load the chunks they need.
    // React needs eval in development only, for readable error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    // Inline styles are allowed: style attributes cannot carry a nonce, and
    // they set things like a progress bar's width. Styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${storage}${isDevelopment ? " ws: wss:" : ""}`.trim(),
    // The PDF preview parses documents in a worker.
    "worker-src 'self' blob:",
    // Document previews are shown in a sandboxed frame of our own making.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Nobody may put this application inside a frame of theirs.
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isProtected(pathname) && !request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  // On the request too: Next reads the nonce from here and puts it on the
  // scripts it generates.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

// Must be literals — Next reads this statically at build time. Everything
// except static files, which need neither a session nor a policy.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
