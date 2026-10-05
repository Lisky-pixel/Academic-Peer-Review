// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { HOME_PATH } from "@/lib/auth/routes";
import proxy, { config } from "./proxy";

describe("proxy", () => {
  it("redirects a visitor with no session cookie to login, remembering the destination", () => {
    const response = proxy(new NextRequest("http://localhost:3000/admin/users?page=2"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/admin/users?page=2");
  });

  it("lets a request carrying the session cookie through to the guards", () => {
    const request = new NextRequest("http://localhost:3000/admin", {
      headers: { cookie: "reviewflow_session=anything" },
    });

    expect(proxy(request).headers.get("location")).toBeNull();
  });

  it("covers every role area", () => {
    for (const home of Object.values(HOME_PATH)) {
      expect(config.matcher).toContain(`${home}/:path*`);
    }
  });
});
