import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/**
 * `cn` underpins every component's `className` override. If conflict
 * resolution stops working, overrides silently lose to base styles — so the
 * behaviour is worth pinning rather than assuming.
 */
describe("cn", () => {
  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("keeps non-conflicting classes", () => {
    expect(cn("rounded-md", "border")).toBe("rounded-md border");
  });

  it("drops falsy values so conditional classes are safe", () => {
    expect(cn("border", false && "hidden", undefined, null)).toBe("border");
  });
});
