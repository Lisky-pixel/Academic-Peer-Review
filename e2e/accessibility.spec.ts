import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Automated accessibility checks, and a check that the Content Security
 * Policy is not being violated by the application's own pages.
 *
 * axe finds the mechanical failures — missing names, poor contrast, broken
 * landmark and heading structure. It cannot judge whether the wording makes
 * sense or the tab order is sensible; those still need a person.
 *
 * Needs the docker-compose stack up and `pnpm db:seed` run.
 */

const PASSWORD = "Password123!";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `a11y-${randomUUID()}` });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Fails on any violation of WCAG 2.1 A or AA that axe can detect. */
async function expectNoViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // The framework's own development overlay is not part of the product.
    .exclude("nextjs-portal")
    .analyze();

  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    where: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
  }));
  expect(summary, `${label} has accessibility violations`).toEqual([]);
}

const PUBLIC_PAGES = ["/", "/login", "/register", "/forgot-password", "/invite/not-a-real-token"];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const path of PUBLIC_PAGES) {
      test(`${path} has no detectable accessibility violations`, async ({ page }) => {
        await page.goto(path);
        await expectNoViolations(page, path);
      });
    }

    test("the author's pages have no detectable accessibility violations", async ({ page }) => {
      await login(page, "user1@reviewflow.local");
      for (const path of ["/dashboard", "/dashboard/submissions/new", "/profile"]) {
        await page.goto(path);
        await expectNoViolations(page, path);
      }
      // A submission page, whichever state the first one is in.
      await page.goto("/dashboard");
      const first = page.locator('a[href^="/dashboard/submissions/"]:not([href$="/new"])').first();
      if ((await first.count()) > 0) {
        await first.click();
        await page.waitForURL(/\/dashboard\/submissions\/[0-9a-f-]{36}$/);
        await expectNoViolations(page, "a submission");
      }
    });

    test("the reviewer's pages have no detectable accessibility violations", async ({ page }) => {
      await login(page, "reviewer2@reviewflow.local");
      for (const path of ["/reviewer", "/reviewer?tab=active", "/reviewer?tab=completed"]) {
        await page.goto(path);
        await expectNoViolations(page, path);
      }
      const first = page.locator('a[href^="/reviewer/reviews/"]').first();
      if ((await first.count()) > 0) {
        await first.click();
        await page.waitForURL(/\/reviewer\/reviews\/[0-9a-f-]{36}$/);
        await expectNoViolations(page, "a review");
      }
    });

    test("the administrator's pages have no detectable accessibility violations", async ({
      page,
    }) => {
      await login(page, "admin@reviewflow.local");
      for (const path of [
        "/admin",
        "/admin?view=all",
        "/admin/users",
        "/admin/invites",
        "/admin/document-types",
        "/admin/activity",
        "/admin/reports",
      ]) {
        await page.goto(path);
        await expectNoViolations(page, path);
      }
      await page.goto("/admin/document-types");
      await page.locator('a[href^="/admin/document-types/"]').first().click();
      await page.waitForURL(/\/admin\/document-types\/[0-9a-f-]{36}$/);
      await expectNoViolations(page, "a document type");

      await page.goto("/admin?view=all");
      const submission = page.locator('a[href^="/admin/submissions/"]').first();
      if ((await submission.count()) > 0) {
        await submission.click();
        await page.waitForURL(/\/admin\/submissions\/[0-9a-f-]{36}$/);
        await expectNoViolations(page, "an admin submission");
      }
    });
  });
}

test("the menus are operable from the keyboard alone", async ({ page }) => {
  await login(page, "user1@reviewflow.local");

  // Tab to the account menu, open it with the keyboard, and reach Sign out.
  const menu = page.getByRole("button", { name: "Account menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Your profile" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();

  // The theme switch is a real button with a name.
  const toggle = page.getByRole("button", { name: "Switch between light and dark theme" });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.className))
    .toMatch(/\b(dark|light)\b/);
});

test("the application's own pages do not violate its Content Security Policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(text)) {
      violations.push(text.slice(0, 300));
    }
  });

  await page.goto("/");
  await page.goto("/login");
  await login(page, "admin@reviewflow.local");
  for (const path of ["/admin", "/admin/reports", "/admin/document-types", "/profile"]) {
    await page.goto(path);
  }
  // Opening menus exercises the client-side code that renders into portals.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.keyboard.press("Escape");
  // A document preview in a sandboxed frame, and one drawn by the PDF worker.
  await page.goto("/dev/emails?t=review-ready");
  await expect(page.frameLocator("iframe").getByText("Your review is ready")).toBeVisible();
  await page.goto("/admin?view=all");
  const submission = page.locator('a[href^="/admin/submissions/"]').first();
  if ((await submission.count()) > 0) {
    await submission.click();
    await page.waitForURL(/\/admin\/submissions\/[0-9a-f-]{36}$/);
    await page.waitForTimeout(1500);
  }

  expect(violations).toEqual([]);

  // And the policy really is being sent, with a nonce.
  const response = await page.request.get("/login");
  const policy = response.headers()["content-security-policy"] ?? "";
  expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});
