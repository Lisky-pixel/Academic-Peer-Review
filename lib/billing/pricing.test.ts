import { describe, expect, it } from "vitest";
import { PACKAGES, packageFor, packageLimitLabel } from "./pricing";

describe("packages", () => {
  it("picks the smallest package that fits", () => {
    expect(packageFor(1).id).toBe("starter");
    expect(packageFor(50).id).toBe("starter");
    expect(packageFor(51).id).toBe("standard");
    expect(packageFor(500).id).toBe("professional");
    expect(packageFor(5000).id).toBe("enterprise");
  });

  it("starts at ten dollars and only goes up", () => {
    expect(PACKAGES[0]!.priceMinor).toBe(1000);
    for (let i = 1; i < PACKAGES.length; i++) {
      expect(PACKAGES[i]!.priceMinor).toBeGreaterThan(PACKAGES[i - 1]!.priceMinor);
    }
  });

  it("describes each package's limit", () => {
    expect(packageLimitLabel(PACKAGES[0]!)).toBe("Up to 50 papers");
    expect(packageLimitLabel(PACKAGES[3]!)).toBe("More than 500 papers");
  });
});
