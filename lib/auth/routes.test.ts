import { describe, expect, it } from "vitest";
import { HOME_PATH, safeRedirectPath } from "@/lib/auth/routes";

describe("HOME_PATH", () => {
  it("gives every role its own area", () => {
    const paths = Object.values(HOME_PATH);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("safeRedirectPath", () => {
  it("keeps a same-origin path, including its query string", () => {
    expect(safeRedirectPath("/dashboard/submissions?status=DRAFT", "/x")).toBe(
      "/dashboard/submissions?status=DRAFT",
    );
  });

  it.each([
    ["an absolute URL", "https://evil.example/login"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash host", "/\\evil.example"],
    ["a scheme without slashes", "javascript:alert(1)"],
    ["a relative path", "dashboard"],
    ["a path hiding a tab", "/\t/evil.example"],
    ["a path hiding a newline", "/\n/evil.example"],
    ["an empty string", ""],
    ["a missing value", undefined],
    ["a repeated parameter", ["/a", "/b"]],
  ])("falls back for %s", (_label, next) => {
    expect(safeRedirectPath(next, "/fallback")).toBe("/fallback");
  });

  it("falls back for an absurdly long path", () => {
    expect(safeRedirectPath("/" + "a".repeat(3000), "/fallback")).toBe("/fallback");
  });
});
