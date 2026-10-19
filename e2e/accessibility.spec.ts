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
  // Pages fade in. Measured mid-fade, the text is still partly transparent and
  // fails contrast for a moment that no reader experiences. The backdrop
  // drifts forever and the landing page's sections are tied to scrolling, so
  // only the timed animations that end are waited for.
  await page.evaluate(() =>
    Promise.race([
      new Promise((resolve) => setTimeout(resolve, 2000)),
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.timeline instanceof DocumentTimeline &&
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    ]),
  );

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

const PUBLIC_PAGES = [
  "/",
  "/login",
  "/register",
  "/register?as=reviewer",
  "/forgot-password",
  "/help",
  "/invite/not-a-real-token",
];

/** Visits each path, then the first link matching `detail` found on the last one. */
async function checkPages(page: Page, paths: string[], detail?: { from: string; link: string }) {
  for (const path of paths) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }
  if (!detail) return;
  await page.goto(detail.from);
  const first = page.locator(`a[href^="${detail.link}"]`).first();
  if ((await first.count()) > 0) {
    const href = (await first.getAttribute("href"))!;
    await page.goto(href);
    await expectNoViolations(page, href);
  }
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const path of PUBLIC_PAGES) {
      test(`${path} has no detectable accessibility violations`, async ({ page }) => {
        await page.goto(path);
        await expectNoViolations(page, path);
      });
    }

    test("the submitter's pages have no detectable accessibility violations", async ({ page }) => {
      await login(page, "user1@apr.local");
      await checkPages(page, ["/dashboard", "/profile", "/help"], {
        from: "/dashboard",
        link: "/dashboard/papers/new",
      });
      await checkPages(page, [], { from: "/dashboard", link: "/dashboard/papers/01" });
    });

    test("the reviewer's pages have no detectable accessibility violations", async ({ page }) => {
      await login(page, "reviewer4@apr.local");
      await checkPages(
        page,
        ["/reviewer", "/reviewer?tab=active", "/reviewer?tab=completed", "/profile"],
        { from: "/reviewer?tab=completed", link: "/reviewer/reviews/" },
      );
    });

    test("the organiser's pages have no detectable accessibility violations", async ({ page }) => {
      await login(page, "organiser@apr.local");
      await checkPages(page, ["/organiser", "/organiser/reviewers", "/organiser/conferences/new"], {
        from: "/organiser",
        link: "/organiser/conferences/",
      });
      const conference = page.url();
      await checkPages(page, [`${conference}?tab=reviewers`, `${conference}?tab=reports`], {
        from: conference,
        link: `${new URL(conference).pathname}/papers/`,
      });
    });

    test("the administrator's pages have no detectable accessibility violations", async ({
      page,
    }) => {
      await login(page, "admin@apr.local");
      await checkPages(
        page,
        [
          "/admin",
          "/admin/conferences/new",
          "/admin/billing",
          "/admin/email",
          "/admin/users",
          "/admin/invites",
          "/admin/activity",
        ],
        { from: "/admin", link: "/organiser/conferences/" },
      );
      const href = new URL(page.url()).pathname.replace(
        "/organiser/conferences/",
        "/admin/conferences/",
      );
      await checkPages(page, [href]);
    });
  });
}

test("the menus are operable from the keyboard alone", async ({ page }) => {
  await login(page, "user1@apr.local");

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
  await login(page, "admin@apr.local");
  for (const path of ["/admin", "/organiser/reviewers", "/help", "/profile"]) {
    await page.goto(path);
  }
  // Opening menus exercises the client-side code that renders into portals.
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.keyboard.press("Escape");
  // A document preview in a sandboxed frame, and one drawn by the PDF worker.
  await page.goto("/dev/emails?t=accepted");
  await expect(page.frameLocator("iframe").getByText("Your paper has been accepted")).toBeVisible();
  await page.goto("/admin");
  const conference = page.locator('a[href^="/organiser/conferences/"]').first();
  await conference.click();
  await page.waitForURL(/\/organiser\/conferences\/[0-9a-f-]{36}$/);
  const paper = page.locator('a[href*="/papers/"]').first();
  if ((await paper.count()) > 0) {
    await paper.click();
    await page.waitForURL(/\/papers\/[0-9a-f-]{36}$/);
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
