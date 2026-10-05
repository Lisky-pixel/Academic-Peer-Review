import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * Phase 2 exit criteria, in a real browser: each seeded role logs in and is
 * bounced from the other two roles' routes — plus the account flows that only
 * mean anything end to end, because they pass through an inbox.
 *
 * Needs the docker-compose stack up and `pnpm db:seed` run.
 */

const PASSWORD = "Password123!";
const MAILPIT = "http://localhost:8025";

const ROLES = [
  { role: "user", email: "user1@reviewflow.local", home: "/dashboard" },
  { role: "reviewer", email: "reviewer1@reviewflow.local", home: "/reviewer" },
  { role: "admin", email: "admin@reviewflow.local", home: "/admin" },
];

/** Accounts made here use the domain `pnpm test` cleans up after itself. */
function freshEmail(label: string): string {
  return `e2e-${label}-${randomUUID()}@reviewflow-test.invalid`;
}

// The auth forms are rate limited per client address, and without this every
// local request would share one — a handful of runs would exhaust the hourly
// limits and fail for reasons unrelated to the code. Each test presents as its
// own visitor instead, which also keeps the limiter switched on under test.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-${randomUUID()}` });
});

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}

/** The newest link of a given kind emailed to an address, read from Mailpit. */
async function emailedLink(
  request: APIRequestContext,
  to: string,
  kind: "reset-password" | "verify-email" | "invite",
): Promise<string> {
  let link: string | undefined;
  await expect(async () => {
    const search = await request.get(`${MAILPIT}/api/v1/search`, {
      params: { query: `to:${to}` },
    });
    const { messages } = await search.json();
    for (const { ID } of messages) {
      const message = await (await request.get(`${MAILPIT}/api/v1/message/${ID}`)).json();
      link = new RegExp(`https?://\\S+/${kind}/\\S+`).exec(message.Text)?.[0];
      if (link) break;
    }
    expect(link, `no ${kind} email for ${to} yet`).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return link!;
}

async function register(page: Page, email: string, password = PASSWORD) {
  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Person");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

test("a signed-out visitor is sent to login and returned afterwards", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);

  await page.getByLabel("Email").fill("admin@reviewflow.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/);
});

test("a wrong password and an unknown email get the same message", async ({ page }) => {
  await login(page, "admin@reviewflow.local", "not the password");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  await login(page, freshEmail("nobody"));
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("login will not redirect to another site", async ({ page }) => {
  await page.goto("/login?next=https://example.com/");
  await page.getByLabel("Email").fill("user1@reviewflow.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/localhost:3000\/dashboard$/);
});

test("repeated wrong passwords lock that visitor out, even with the right one", async ({
  page,
}) => {
  const email = "user2@reviewflow.local";

  for (let attempt = 0; attempt < 5; attempt++) {
    await login(page, email, "a wrong guess");
    await expect(page.getByText("Invalid email or password.")).toBeVisible();
  }

  await login(page, email);
  await expect(page.getByText(/Too many attempts/)).toBeVisible();
});

for (const { role, email, home } of ROLES) {
  test(`the seeded ${role} logs in and is bounced from the other roles' routes`, async ({
    page,
  }) => {
    await login(page, email);
    await expect(page).toHaveURL(new RegExp(`${home}$`));

    for (const other of ROLES.filter((r) => r.home !== home)) {
      await page.goto(other.home);
      await expect(page).toHaveURL(new RegExp(`${home}$`));
    }

    // Already signed in, so the login page has nothing to offer.
    await page.goto("/login");
    await expect(page).toHaveURL(new RegExp(`${home}$`));

    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);

    // The session is gone server-side, not just hidden.
    await page.goto(home);
    await expect(page).toHaveURL(/\/login/);
  });
}

test("registering needs the emailed link and the password before anything is active", async ({
  page,
  request,
}) => {
  const email = freshEmail("register");

  await register(page, email);
  await expect(page.getByRole("status")).toContainText("We have sent an email");
  await expect(page).toHaveURL(/\/register$/);

  // Not usable yet — and the reason is only given to someone with the password.
  await login(page, email);
  await expect(page.getByText(/confirm your email address/i)).toBeVisible();
  await login(page, email, "a wrong guess");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  const link = await emailedLink(request, email, "verify-email");
  await page.goto(link);
  await page.getByLabel("Password").fill("not what I signed up with");
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page.getByText("That is not the password you signed up with.")).toBeVisible();

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();

  // Public registration always lands in the author area.
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link is no longer valid");
});

test("registering with a taken email looks identical and changes nothing", async ({
  page,
  request,
}) => {
  const taken = "user3@reviewflow.local";

  await register(page, taken, "an attacker chosen password");

  // Same screen a brand-new address gets.
  await expect(page.getByRole("status")).toContainText("We have sent an email");
  await expect(page).toHaveURL(/\/register$/);

  // The real owner is told by email, and their password still works.
  await expect(async () => {
    const search = await request.get(`${MAILPIT}/api/v1/search`, {
      params: { query: `to:${taken} subject:"already have"` },
    });
    expect((await search.json()).messages.length).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  await login(page, taken, "an attacker chosen password");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await login(page, taken);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("forget the password, reset it by email, and sign in again", async ({ page, request }) => {
  const email = freshEmail("reset");
  const newPassword = "a brand new password";

  await register(page, email);
  await page.goto(await emailedLink(request, email, "verify-email"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await signOut(page);

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  const link = await emailedLink(request, email, "reset-password");
  await page.goto(link);
  await page.getByLabel("Password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm password").fill(newPassword);
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1$/);

  // The link is single-use.
  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This link is no longer valid");

  await login(page, email, PASSWORD);
  await expect(page.getByText("Invalid email or password.")).toBeVisible();

  await login(page, email, newPassword);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an admin invites a reviewer, who accepts and lands in the reviewer area", async ({
  page,
  request,
}) => {
  const email = freshEmail("reviewer");

  await login(page, "admin@reviewflow.local");
  await page.getByRole("link", { name: "Invitations" }).click();
  await expect(page).toHaveURL(/\/admin\/invites$/);

  await page.getByLabel("Name").fill("Invited Reviewer");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByRole("status")).toContainText(`Invitation sent to ${email}`);
  const row = page.getByRole("listitem").filter({ hasText: email });
  await expect(row).toContainText("Reviewer");
  const firstLink = await emailedLink(request, email, "invite");

  // Resending replaces the link; the first one stops working.
  await row.getByRole("button", { name: "Resend" }).click();
  let link = firstLink;
  await expect(async () => {
    link = await emailedLink(request, email, "invite");
    expect(link).not.toBe(firstLink);
  }).toPass({ timeout: 15_000 });

  await signOut(page);

  await page.goto(firstLink);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This invitation is no longer valid",
  );

  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome, Invited Reviewer");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Activate account" }).click();

  await expect(page).toHaveURL(/\/reviewer$/);
  await page.goto("/admin/invites");
  await expect(page).toHaveURL(/\/reviewer$/);
});

test("an admin can cancel an invitation, which kills its link", async ({ page, request }) => {
  const email = freshEmail("cancelled");

  await login(page, "admin@reviewflow.local");
  // Wait for the sign-in to land before navigating, or the next request races it.
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/invites");
  await page.getByLabel("Name").fill("Changed My Mind");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const link = await emailedLink(request, email, "invite");

  const row = page.getByRole("listitem").filter({ hasText: email });
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(row).toHaveCount(0);

  await page.goto(link);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This invitation is no longer valid",
  );
});

test("the invite screen refuses an address that already has an account", async ({ page }) => {
  await login(page, "admin@reviewflow.local");
  // Wait for the sign-in to land before navigating, or the next request races it.
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/invites");
  await page.getByLabel("Name").fill("Already Here");
  await page.getByLabel("Email").fill("user1@reviewflow.local");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByText("That email address already belongs to an account.")).toBeVisible();
});

test("a made-up invite link is refused", async ({ page }) => {
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This invitation is no longer valid",
  );
});

// A valid 1x1 PNG, enough for the browser to decode, crop and re-encode.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function registerAndConfirm(page: Page, request: APIRequestContext, email: string) {
  await register(page, email);
  await page.goto(await emailedLink(request, email, "verify-email"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Confirm and sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const LIGHT_PAGE = "rgb(245, 246, 249)";
const DARK_PAGE = "rgb(13, 18, 28)";

function pageBackground(page: Page) {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test("the theme switch flips light and dark and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  expect(await pageBackground(page)).toBe(LIGHT_PAGE);

  await page.getByRole("button", { name: "Switch between light and dark theme" }).click();
  await expect.poll(() => pageBackground(page)).toBe(DARK_PAGE);

  // Remembered on other pages, and already applied when the page arrives.
  await page.goto("/login");
  expect(await pageBackground(page)).toBe(DARK_PAGE);

  await page.getByRole("button", { name: "Switch between light and dark theme" }).click();
  await expect.poll(() => pageBackground(page)).toBe(LIGHT_PAGE);
});

test("with no saved choice the theme follows the operating system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  expect(await pageBackground(page)).toBe(DARK_PAGE);
});

test("an explicit light choice beats a dark operating system", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch between light and dark theme" }).click();
  await expect.poll(() => pageBackground(page)).toBe(LIGHT_PAGE);

  await page.reload();
  expect(await pageBackground(page)).toBe(LIGHT_PAGE);
});

test("a user edits their name and bio from the account menu", async ({ page, request }) => {
  await registerAndConfirm(page, request, freshEmail("profile"));

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Your profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel("Full name").fill("Renamed Person");
  await page.getByLabel("Short bio").fill("Final-year student applying for planning courses.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your profile has been saved.")).toBeVisible();

  // The header picks the new name up, and it survives a reload.
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Renamed Person");
  await expect(page.getByLabel("Short bio")).toHaveValue(
    "Final-year student applying for planning courses.",
  );
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Renamed Person");
});

test("a profile picture can be uploaded, is private to its owner, and can be removed", async ({
  page,
  request,
  browser,
}) => {
  await registerAndConfirm(page, request, freshEmail("avatar"));
  await page.goto("/profile");

  await page
    .getByLabel("Choose a profile picture")
    .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: TINY_PNG });

  await expect(page.getByRole("button", { name: "Change picture" })).toBeVisible();
  const src = await page.locator("main img").first().getAttribute("src");
  expect(src).toMatch(/^\/avatar\/[0-9a-f-]{36}\?v=\d+$/);

  // The owner can load it, and it is a real image.
  const own = await page.request.get(src!);
  expect(own.status()).toBe(200);
  expect(own.headers()["content-type"]).toBe("image/jpeg");

  // A signed-out visitor and a different signed-in user both get a 404.
  expect((await request.get(src!)).status()).toBe(404);
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-${randomUUID()}` });
  await login(otherPage, "user1@reviewflow.local");
  await expect(otherPage).toHaveURL(/\/dashboard$/);
  expect((await otherPage.request.get(src!)).status()).toBe(404);
  await other.close();

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Upload a picture" })).toBeVisible();
  expect((await page.request.get(src!)).status()).toBe(404);
});

test("a user changes their password and the old one stops working", async ({ page, request }) => {
  const email = freshEmail("password");
  const newPassword = "a brand new password";
  await registerAndConfirm(page, request, email);
  await page.goto("/profile");

  await page.getByLabel("Current password").fill("not my password");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("That is not your current password.")).toBeVisible();

  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();

  // Still signed in here; the old password is dead and the new one works.
  await page.reload();
  await expect(page).toHaveURL(/\/profile$/);
  await signOut(page);
  await login(page, email, PASSWORD);
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await login(page, email, newPassword);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("the profile page is open to every role and closed to visitors", async ({ page }) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);

  for (const { email } of ROLES) {
    await login(page, email);
    await expect(page).not.toHaveURL(/\/login/);
    await page.goto("/profile");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your profile");
    await signOut(page);
    await expect(page).toHaveURL(/\/login$/);
  }
});

const SAMPLE_PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

async function startDraft(page: Page, title: string) {
  await page.getByRole("link", { name: "New submission" }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/submissions\/new$/);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Type of document").selectOption({ label: "Personal Statement" });
  await page.getByLabel("Instructions").fill("4,000 characters maximum.");
  await page.getByLabel("Where should they focus?").fill("The opening paragraph.");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/dashboard\/submissions\/[0-9a-f-]{36}$/);
}

test("an author drafts, uploads, submits, and the admin sees it waiting for a reviewer", async ({
  page,
  request,
  browser,
}) => {
  const title = `Statement ${randomUUID().slice(0, 8)}`;
  await registerAndConfirm(page, request, freshEmail("author"));
  await expect(page.getByText("Nothing here yet")).toBeVisible();

  await startDraft(page, title);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  // Nothing to submit until a document is attached.
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();

  await page
    .getByLabel("Choose your document")
    .setInputFiles({ name: "My Statement.pdf", mimeType: "application/pdf", buffer: SAMPLE_PDF });
  await expect(page.getByText("My Statement.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Awaiting a reviewer")).toBeVisible();
  await expect(page.getByRole("region", { name: "Progress" })).toContainText("Submitted");
  // Frozen once submitted.
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByLabel("Choose your document")).toHaveCount(0);

  // The author gets their own file back, byte for byte.
  const submissionUrl = page.url();
  const download = await page.request.get(`${submissionUrl}/document`);
  expect(download.status()).toBe(200);
  expect(await download.body()).toEqual(SAMPLE_PDF);
  expect(download.headers()["content-disposition"]).toContain("attachment");

  // It is listed on the dashboard with its reference.
  await page.goto("/dashboard");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText(/RF-\d{4}-\d{4}/);
  await expect(row).toContainText("Awaiting a reviewer");

  // A different author cannot open the page or the file.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-${randomUUID()}` });
  await login(otherPage, "user1@reviewflow.local");
  await expect(otherPage).toHaveURL(/\/dashboard$/);
  expect((await otherPage.request.get(submissionUrl)).status()).toBe(404);
  expect((await otherPage.request.get(`${submissionUrl}/document`)).status()).toBe(404);
  await other.close();

  // The admin sees it waiting, with the author named.
  await signOut(page);
  await login(page, "admin@reviewflow.local");
  await expect(page).toHaveURL(/\/admin$/);
  const adminRow = page.getByRole("listitem").filter({ hasText: title });
  await expect(adminRow).toContainText("Needs a reviewer");
  await expect(adminRow).toContainText("by E2E Person");
});

test("a file that is not a real document is refused", async ({ page, request }) => {
  await registerAndConfirm(page, request, freshEmail("badfile"));
  await startDraft(page, "Statement with a bad file");

  // Named and typed like a PDF, but it is a web page.
  await page.getByLabel("Choose your document").setInputFiles({
    name: "statement.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
  });
  await expect(page.getByText(/not what its name says it is/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeDisabled();

  await page.getByLabel("Choose your document").setInputFiles({
    name: "holiday.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(page.getByText(/file type is not supported/)).toBeVisible();
});

test("a draft can be edited and then discarded", async ({ page, request }) => {
  await registerAndConfirm(page, request, freshEmail("draft"));
  await startDraft(page, "First title");

  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Second title");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second title");

  await page.getByText("Discard this draft").click();
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("listitem").filter({ hasText: "Second title" })).toContainText(
    "Cancelled",
  );
});

test("an admin assigns and reassigns a reviewer, and the author never learns who", async ({
  page,
  request,
  browser,
}) => {
  const title = `Assignable ${randomUUID().slice(0, 8)}`;
  const authorEmail = freshEmail("assignee");

  // An author submits a document.
  await registerAndConfirm(page, request, authorEmail);
  await startDraft(page, title);
  await page
    .getByLabel("Choose your document")
    .setInputFiles({ name: "essay.pdf", mimeType: "application/pdf", buffer: SAMPLE_PDF });
  await expect(page.getByText("essay.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Awaiting a reviewer")).toBeVisible();
  const authorUrl = page.url();
  await signOut(page);

  // The admin opens it from the list and assigns the first seeded reviewer.
  await login(page, "admin@reviewflow.local");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/admin\/submissions\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Needs a reviewer")).toBeVisible();

  const reviewers = page.getByRole("radio");
  expect(await reviewers.count()).toBeGreaterThanOrEqual(2);
  const firstChoice = page.locator("label").filter({ hasText: "reviewer1@reviewflow.local" });
  const firstName = (await firstChoice.locator("span.font-medium").first().innerText()).trim();
  await firstChoice.click();
  await page.getByRole("button", { name: "Assign reviewer" }).click();

  await expect(page.getByText("Assigned", { exact: true })).toBeVisible();
  await expect(page.getByText("Waiting for the reviewer to accept")).toBeVisible();
  await expect(page.getByText("Reviewer assigned", { exact: true })).toBeVisible();

  // The admin can download the author's document.
  const adminDownload = await page.request.get(`${page.url()}/document`);
  expect(adminDownload.status()).toBe(200);
  expect(await adminDownload.body()).toEqual(SAMPLE_PDF);

  // Reassign to the second reviewer, with a reason.
  await page.getByText("Reassign to someone else").click();
  await expect(page.locator("label").filter({ hasText: "reviewer1@reviewflow.local" })).toHaveCount(
    0,
  );
  await page.locator("label").filter({ hasText: "reviewer2@reviewflow.local" }).click();
  await page.getByRole("button", { name: "Reassign" }).click();
  await expect(page.getByText("Say why this is being reassigned.")).toHaveCount(0);
  // The browser enforces the required reason before anything is sent.
  await page.getByLabel("Reason for reassigning").fill("First reviewer is on leave.");
  await page.getByRole("button", { name: "Reassign" }).click();

  await expect(page.getByText("Reassigned to another reviewer")).toBeVisible();
  await expect(page.getByText("First reviewer is on leave.")).toBeVisible();
  await expect(page.getByText("Previously with")).toBeVisible();
  await expect(page.getByText("reviewer2@reviewflow.local")).toBeVisible();

  // Author visibility can be switched off and is logged.
  await page.getByRole("button", { name: "Hide the author from the reviewer" }).click();
  await expect(page.getByText("The author is hidden from the reviewer.")).toBeVisible();
  await expect(page.getByText("Author visibility changed")).toBeVisible();

  // The list shows who holds it now.
  await page.goto("/admin?view=active");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toContainText("With ");
  await signOut(page);

  // Back as the author: it has moved on, and names nobody.
  const authorContext = await browser.newContext();
  const authorPage = await authorContext.newPage();
  await authorPage.setExtraHTTPHeaders({ "x-forwarded-for": `e2e-${randomUUID()}` });
  await login(authorPage, authorEmail);
  await expect(authorPage).toHaveURL(/\/dashboard$/);
  await authorPage.goto(authorUrl);
  await expect(authorPage.getByText("Reviewer assigned").first()).toBeVisible();

  const html = await authorPage.content();
  expect(html).not.toContain(firstName);
  expect(html).not.toContain("reviewer1@reviewflow.local");
  expect(html).not.toContain("reviewer2@reviewflow.local");
  expect(html).not.toContain("on leave");
  // An author cannot withdraw once a reviewer has been asked to read it.
  await expect(authorPage.getByText("Withdraw this submission")).toHaveCount(0);
  // And the admin's pages are not theirs to open.
  expect(
    (await authorPage.request.get("/admin/submissions/" + authorUrl.split("/").pop())).url(),
  ).toMatch(/\/dashboard$/);
  await authorContext.close();
});

test("the admin list filters by document type and deadline", async ({ page }) => {
  await login(page, "admin@reviewflow.local");
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin?view=all");
  await page.getByLabel("Document type").selectOption({ label: "Journal" });
  await page.getByLabel("Deadline").selectOption({ label: "Past its deadline" });
  await page.getByRole("button", { name: "Filter" }).click();

  await expect(page).toHaveURL(/view=all/);
  await expect(page).toHaveURL(/type=[0-9a-f-]{36}/);
  await expect(page).toHaveURL(/due=overdue/);
  await expect(page.getByText("Nothing matches those filters.")).toBeVisible();

  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).toHaveURL(/\/admin\?view=all$/);
});

const E2E_REVIEWER = "Zebediah Quillfeather";

/** A real one-page PDF, so the in-browser preview has something to draw. */
async function realPdf(): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const page = document.addPage([420, 300]);
  page.drawText("At sixteen I spent a summer counting buses.", { x: 30, y: 240, size: 14 });
  return Buffer.from(await document.save());
}

/** A Word file as an annotating reviewer would return it, name and all. */
async function annotatedDocx(): Promise<Buffer> {
  const { strToU8, zipSync } = await import("fflate");
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
      "docProps/core.xml": strToU8(
        `<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>${E2E_REVIEWER}</dc:creator><cp:lastModifiedBy>${E2E_REVIEWER}</cp:lastModifiedBy></cp:coreProperties>`,
      ),
      "word/document.xml": strToU8(
        `<w:document ${w}><w:body><w:p><w:ins w:id="1" w:author="${E2E_REVIEWER}"><w:r><w:t>drawn to</w:t></w:r></w:ins></w:p></w:body></w:document>`,
      ),
      "word/comments.xml": strToU8(
        `<w:comments ${w}><w:comment w:id="0" w:author="${E2E_REVIEWER}" w:initials="ZQ"><w:p><w:r><w:t>Start here.</w:t></w:r></w:p></w:comment></w:comments>`,
      ),
    }),
  );
}

/** An author submits `title`, and the admin assigns it to a seeded reviewer. */
async function submitAndAssign(
  page: Page,
  request: APIRequestContext,
  title: string,
  reviewerEmail: string,
) {
  await registerAndConfirm(page, request, freshEmail("flow"));
  await startDraft(page, title);
  await page
    .getByLabel("Choose your document")
    .setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: await realPdf() });
  await expect(page.getByText("statement.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Awaiting a reviewer")).toBeVisible();
  const authorUrl = page.url();
  await signOut(page);

  await login(page, "admin@reviewflow.local");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.locator("label").filter({ hasText: reviewerEmail }).click();
  await page.getByRole("button", { name: "Assign reviewer" }).click();
  await expect(page.getByText("Waiting for the reviewer to accept")).toBeVisible();
  await signOut(page);
  return authorUrl;
}

test("a reviewer accepts, previews, reviews, returns a scrubbed file and submits", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const title = `Reviewable ${randomUUID().slice(0, 8)}`;
  await submitAndAssign(page, request, title, "reviewer1@reviewflow.local");

  // The reviewer finds it waiting for an answer.
  await login(page, "reviewer1@reviewflow.local");
  await expect(page).toHaveURL(/\/reviewer$/);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/reviewer\/reviews\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Waiting for your answer")).toBeVisible();
  // No document and no form until they accept.
  await expect(page.locator("canvas")).toHaveCount(0);

  await page.getByRole("button", { name: "Accept assignment" }).click();
  await expect(page.getByRole("heading", { name: "Your review" })).toBeVisible();

  // The PDF is drawn in the page by PDF.js.
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          const context = element.getContext("2d")!;
          const { data } = context.getImageData(0, 0, element.width, element.height);
          // Any dark pixel means text was actually rendered, not a blank page.
          for (let i = 0; i < data.length; i += 4) {
            if (data[i]! < 200 && data[i + 3]! > 0) return true;
          }
          return false;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);

  // Submitting an empty review is refused, and says what is missing.
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText(/still need an answer/)).toBeVisible();
  await expect(page.getByText(/Still needed: Grammar and mechanics/)).toBeVisible();

  // Score every rated criterion 4 and write the overall feedback.
  const groups = page.getByRole("radiogroup");
  const count = await groups.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < count; i++) {
    await groups.nth(i).locator("label").nth(3).click();
  }
  await page
    .getByLabel("Overall feedback comments")
    .fill("A strong, specific story. Merge the second and third paragraphs.");
  await page.getByLabel("Grammar and mechanics comments").fill("Two comma splices on page one.");
  await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 15_000 });

  // Still refused: no annotated copy yet.
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText(/Attach your annotated copy/)).toBeVisible();

  // Autosave really saved: a reload brings the answers back.
  await page.reload();
  await expect(page.getByLabel("Grammar and mechanics comments")).toHaveValue(
    "Two comma splices on page one.",
  );
  await expect(page.getByRole("radiogroup").first().getByRole("radio").nth(3)).toBeChecked();

  // A legacy .doc cannot be scrubbed, so it is refused.
  await page.getByLabel("Choose your annotated copy").setInputFiles({
    name: "notes.doc",
    mimeType: "application/msword",
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  });
  await expect(page.getByText(/annotated copy as a PDF, DOCX or TXT/)).toBeVisible();

  // The annotated Word file goes up under the filename the reviewer gave it,
  await page.getByLabel("Choose your annotated copy").setInputFiles({
    name: `${E2E_REVIEWER} notes FINAL.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: await annotatedDocx(),
  });
  // and comes back named from the reference.
  await expect(page.getByText(/RF-\d{4}-\d+-reviewed\.docx/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(E2E_REVIEWER)).toHaveCount(0);

  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.getByText(/An administrator will read it/)).toBeVisible();
  await expect(page.getByText("4 of 5").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit review" })).toHaveCount(0);

  // What would be downloaded contains that name nowhere.
  const download = await page.request.get(`${page.url()}/annotated`);
  expect(download.status()).toBe(200);
  const { strFromU8, unzipSync } = await import("fflate");
  const parts = unzipSync(new Uint8Array(await download.body()));
  const everything = Object.values(parts)
    .map((part) => strFromU8(part))
    .join("\n");
  expect(everything).not.toContain(E2E_REVIEWER);
  expect(everything).not.toContain("Quillfeather");
  expect(everything).toContain('w:author="Reviewer"');
  expect(everything).toContain("Start here.");

  // It has moved to the Submitted tab of the queue.
  await page.goto("/reviewer?tab=completed");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await signOut(page);

  // And it is in the approval queue.
  await login(page, "admin@reviewflow.local");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin?view=approval");
  await expect(page.getByRole("link", { name: new RegExp(title) })).toContainText("Needs approval");
});

test("a reviewer declines with a reason and the admin sees it back in the queue", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const title = `Declinable ${randomUUID().slice(0, 8)}`;
  await submitAndAssign(page, request, title, "reviewer2@reviewflow.local");

  await login(page, "reviewer2@reviewflow.local");
  await expect(page).toHaveURL(/\/reviewer$/);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByText("Waiting for your answer")).toBeVisible();
  const reviewUrl = page.url();

  await page.getByText("I cannot take this one").click();
  await page.getByLabel("Why are you declining?").fill("Away that week.");
  await page.getByRole("button", { name: "Decline assignment" }).click();
  await expect(page).toHaveURL(/\/reviewer$/);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);

  // It is no longer theirs to open, or to download.
  expect((await page.request.get(reviewUrl)).status()).toBe(404);
  expect((await page.request.get(`${reviewUrl}/document`)).status()).toBe(404);
  await signOut(page);

  await login(page, "admin@reviewflow.local");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(/\/admin\/submissions\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Assign a reviewer" })).toBeVisible();
  await expect(page.getByText("Previously with")).toBeVisible();
  await expect(page.getByText("Away that week.").first()).toBeVisible();
});
