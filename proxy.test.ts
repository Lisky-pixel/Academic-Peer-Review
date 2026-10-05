// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { HOME_PATH } from "@/lib/auth/routes";
import proxy, { contentSecurityPolicy } from "./proxy";

const visit = (path: string, cookie?: string) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined),
  );

describe("route protection", () => {
  it("redirects a visitor with no session cookie to login, remembering the destination", () => {
    const response = visit("/admin/users?page=2");

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/admin/users?page=2");
  });

  it.each([...Object.values(HOME_PATH), "/profile", "/admin/submissions/abc"])(
    "protects %s",
    (path) => {
      expect(visit(path).headers.get("location")).toContain("/login");
    },
  );

  it("lets a request carrying the session cookie through to the guards", () => {
    expect(visit("/admin", "reviewflow_session=anything").headers.get("location")).toBeNull();
  });

  it.each(["/", "/login", "/register", "/invite/abc", "/administrators", "/dashboards"])(
    "leaves the public page %s alone",
    (path) => {
      expect(visit(path).headers.get("location")).toBeNull();
    },
  );
});

describe("Content Security Policy", () => {
  const header = (path = "/") => visit(path).headers.get("content-security-policy") ?? "";

  it("is set on every page, public or protected", () => {
    expect(header("/")).toContain("default-src 'self'");
    expect(
      visit("/admin", "reviewflow_session=x").headers.get("content-security-policy"),
    ).toContain("default-src 'self'");
  });

  it("uses a different nonce for every response", () => {
    const nonce = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1];

    const first = nonce(header());
    const second = nonce(header());

    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("never allows inline or eval scripts in production", () => {
    const policy = contentSecurityPolicy("abc", false);
    const scripts = policy.split("; ").find((part) => part.startsWith("script-src"))!;

    expect(scripts).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(scripts).not.toContain("unsafe-inline");
    expect(scripts).not.toContain("unsafe-eval");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("forbids framing, plugins, foreign form targets and base-tag hijacking", () => {
    const policy = contentSecurityPolicy("abc", false);

    for (const directive of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ]) {
      expect(policy).toContain(directive);
    }
  });

  it("allows connections to document storage, and to nothing else foreign", () => {
    const connect = contentSecurityPolicy("abc", false)
      .split("; ")
      .find((part) => part.startsWith("connect-src"))!;
    const storage = new URL(process.env.STORAGE_ENDPOINT!);

    expect(connect).toContain(`${storage.protocol}//${storage.host}`);
    expect(connect).not.toContain("*.com");
    expect(connect.split(" ").filter((source) => source === "*")).toEqual([]);
  });

  it("only loosens the policy in development", () => {
    expect(contentSecurityPolicy("abc", true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("abc", true)).not.toContain("upgrade-insecure-requests");
  });
});
