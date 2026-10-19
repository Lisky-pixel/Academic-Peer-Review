/**
 * What a conference costs, by how many papers the organiser expects.
 *
 * The one place prices live. They are demonstration prices for now; change
 * the numbers here and every new invoice uses them. Invoices already issued
 * keep the amount they were issued with.
 */

export type Package = {
  id: "starter" | "standard" | "professional" | "enterprise";
  name: string;
  /** The most papers the package allows; null for no limit. */
  maxPapers: number | null;
  /** In US cents. */
  priceMinor: number;
};

export const CURRENCY = "USD";

export const PACKAGES: Package[] = [
  { id: "starter", name: "Starter", maxPapers: 50, priceMinor: 10_00 },
  { id: "standard", name: "Standard", maxPapers: 200, priceMinor: 25_00 },
  { id: "professional", name: "Professional", maxPapers: 500, priceMinor: 50_00 },
  { id: "enterprise", name: "Enterprise", maxPapers: null, priceMinor: 100_00 },
];

/** The smallest package that fits the papers expected. */
export function packageFor(expectedPapers: number): Package {
  return (
    PACKAGES.find((pkg) => pkg.maxPapers === null || expectedPapers <= pkg.maxPapers) ??
    PACKAGES[PACKAGES.length - 1]!
  );
}

export function packageById(id: string): Package | undefined {
  return PACKAGES.find((pkg) => pkg.id === id);
}

/** "Up to 50 papers", "More than 500 papers". */
export function packageLimitLabel(pkg: Package): string {
  if (pkg.maxPapers !== null) return `Up to ${pkg.maxPapers.toLocaleString("en")} papers`;
  const previous = PACKAGES[PACKAGES.indexOf(pkg) - 1];
  return previous?.maxPapers
    ? `More than ${previous.maxPapers.toLocaleString("en")} papers`
    : "Any number of papers";
}

/** Invoices are due this many days after they are issued. */
export const INVOICE_DUE_DAYS = 14;
