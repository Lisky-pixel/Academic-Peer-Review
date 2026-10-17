@AGENTS.md

# Academic Peer Review — working context

Peer review for academic conferences (formerly "ReviewFlow", a general
document-review tool; the repository folder still has the old name). The
owner's market is the academic conference sector in emerging markets, part of
the wider conference and events (MICE) industry. Competitors named by the
owner: EventsAir, Four Waves. Peer review comes first; registration, tickets
and programmes are not in scope.

The flow: an administrator creates a conference and attaches its organisers.
Submitters send papers to open calls. When the call closes (or an organiser
clicks "Match reviewers now"), each paper is matched automatically to
reviewers in its discipline. Reviewers score it 1–5, recommend it or not,
comment, and may upload a marked-up copy. If reviews disagree, a tie-breaker
reviewer is added. Organisers accept or reject; the submitter is emailed and
reads every review, with reviewers anonymous.

## Status

The rebuild for conferences is done and verified locally (October 2026): all
pages for the four roles, the demo seed, unit and database tests (including
`lib/workflow/flow.db.test.ts`, the whole journey), and the accessibility
suite. Nothing is deployed yet; `docs/DEPLOY.md` has the steps. No email has
ever been sent through Resend.

Not built yet, agreed for after the first demo: online payment for organiser
packages (payments are recorded by an administrator, which emails a receipt),
a browser test of the full flow, and admin management of the disciplines list
(it is seeded).

## How it fits together

- **Roles** (`Role`): `USER` is a submitter; `REVIEWER` reviews and can also
  submit; `ORGANISER` runs the conferences they are attached to
  (`ConferenceOrganiser`); `ADMIN` runs the platform and acts as organiser of
  any conference. Homes: `/dashboard`, `/reviewer`, `/organiser`, `/admin`
  (`HOME_PATH`). A new area must also go in `proxy.ts`'s protected list.
- **Signup** (`lib/auth/registration.ts`) chooses submitter or reviewer. A
  reviewer gives rank, years, expertise and disciplines (`ReviewerProfile`).
  Organisers and administrators exist only by invitation. A submitter becomes
  a reviewer from their profile. `/register` must still answer the same way
  whether or not the address is taken.
- **Conferences** (`lib/conferences`): created by administrators at
  `/admin/conferences`. Settings: dates (call opens/closes, reviews due),
  reviewers per paper (1–3), papers per reviewer (2–5), double-blind or not,
  full paper or abstract only, topics, package name and paper limit.
  Organiser pages are `/organiser/conferences/[id]` (papers, reviewers,
  reports, Excel export) and `.../papers/[paperId]` (reviews, add/remove
  reviewer, decision). `requireOrganiserOf()` guards them.
- **Papers** (`lib/submissions`): fields are title, authors, contact email,
  institution, topic (conference list or Other), discipline (platform list or
  Other), type, abstract, file. Editable while `DRAFT` or `SUBMITTED`; locked
  once reviewers have it. Uploaded files (PDF/DOCX only) are scrubbed of names
  in their metadata, labelled "Author", before being stored.
- **Matching** (`lib/matching`): rules are pure functions in `select.ts`
  (never the submitter, never anyone already asked, never the same
  institution, never over the conference workload limit, only the paper's
  discipline unless it is Other, least busy first, random ties). Every
  assigning transaction holds a per-conference advisory lock.
  `settleReviews()` decides what happens when reviews change: wait, add a
  tie-breaker (recommendations split or scores ≥2 apart, once), or mark the
  reviews complete.
- **Reviews** (`lib/reviews`): accept or decline (a conflict of interest is a
  decline with a flag); declining finds a replacement at once. A sent review
  cannot be changed. Marked-up copies are scrubbed, labelled "Reviewer".
- **Decisions**: organisers decide from `UNDER_REVIEW` or `REVIEWS_COMPLETE`;
  open assignments are cancelled. Submitters see every review only after a
  decision (`findOwnReviews`), as "Reviewer 1, 2, 3".
- **Daily job** (`lib/maintenance`, `/api/cron/maintenance`): matches
  conferences whose call has closed, sends reminders 7, 3 and 1 days before a
  review is due (`Assignment.remindersSent`), tells organisers about overdue
  reviews, retries email, cleans up.
- **Email**: workflow notices go through the outbox (`queueNotices`); wording
  is all in `lib/notifications/messages.ts`. Addresses ending `.invalid` are
  never sent through Resend: the demo accounts use them.
- **Help** (`/help`): questions and a contact form that emails every
  administrator.
- **Seed**: `pnpm db:seed` (dev: disciplines, accounts, two demo conferences
  driven through the real workflow), `pnpm db:seed:reference` (disciplines
  only), `pnpm db:seed:demo` (demo data on a live site; needs `DEMO_PASSWORD`;
  accounts are `<role>@demo.invalid`).

## Still true from the original build

- `proxy.ts` checks only that a session cookie exists and sets a per-request
  CSP nonce; the guards in `lib/auth/guards.ts` are the enforcement. Every
  mutation is a server action; do not add state-changing GET handlers.
- Document bytes never pass through the app: the browser PUTs to a signed
  URL, then the server checks size and magic bytes (`lib/files/validate.ts`)
  and scrubs (`lib/files/scrub.ts`, fails closed). Downloads redirect to a
  signed, attachment-only URL.
- **Production needs a CORS rule on the R2 bucket** allowing `GET`, `PUT`
  and `HEAD` from the app origin with the `Content-Type` header.
- Known limits: scrubbing removes names from metadata, not names typed into
  the text; the schedule is daily (Vercel free plan); the bell does not update
  live; prepared-but-unconfirmed uploads leave orphan objects.
- `e2e/accessibility.spec.ts` runs axe over every page in both themes and
  fails on any CSP violation. Run it after any colour or markup change.

## Two rules that must not be broken

1. **Never assign `Submission.status` directly.** Every transition goes through
   `lib/workflow/state-machine.ts`, which validates legality, checks the actor's
   role, writes the activity log, and queues notifications in one transaction.

2. **Never return a Prisma entity to a page or route.** Map it through
   `lib/dto/` first. `toUserPaperDTO()` and `toUserReviewDTOs()` have no reviewer field in their return
   _type_, which is what makes an anonymity leak a compile error rather than a
   production incident. Reviewer identity must also stay out of user-facing
   emails and out of downloaded file bytes (`lib/files/scrub.ts`).

## Decisions already made — do not relitigate

| Area              | Decision                                                                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture      | Next.js full-stack, App Router; route handlers + server actions are the backend                                                                                                         |
| Database          | Neon (prod) / Docker Postgres (dev), via Prisma + `@prisma/adapter-pg`                                                                                                                  |
| Storage           | Cloudflare R2 (prod) / MinIO (dev), behind `lib/storage`                                                                                                                                |
| Email             | Resend on a verified domain (prod) / Mailpit (dev), behind `lib/email`                                                                                                                  |
| Auth              | Hand-rolled DB sessions: argon2id, httpOnly cookies, own guards. No Auth.js, no Clerk                                                                                                   |
| Reviewer accounts | Reviewers sign up themselves (owner's decision, Oct 2026) or are invited; organisers and admins only by invitation                                                                      |
| Anonymity         | Reviewers are always anonymous to submitters. Authors are hidden from reviewers when the conference is double-blind (`Conference.doubleBlind`), resolved only in `toReviewerPaperDTO()` |
| Document viewing  | In-browser preview (PDF.js for PDF, Mammoth for .docx) plus download                                                                                                                    |
| Purpose           | A real tool for real use — reliability over feature count                                                                                                                               |

## Environment facts that cost time to discover

- **Prisma's `latest` dist-tag is a release candidate** (`8.0.0-rc.x`). Stable 7
  is on the `prev` tag. Both CLI and client are pinned to `7.10.0` — keep them
  pinned and matched.
- **Prisma 7 uses `prisma7.config.ts`**, not `prisma.config.ts`. It loads
  `.env.local` then `.env` so the CLI and Next cannot diverge. `prisma init`
  also installs agent skill docs and symlinks them between `.agents/`,
  `.claude/` and `.windsurf/` — `.agents/` is the real store, so deleting it
  breaks the others.
- **MinIO is no longer publicly pullable**: `docker.io/minio/minio` 404s and
  quay.io needs auth. Dev uses the pinned, archived `bitnamilegacy/minio`, which
  auto-creates the bucket via `MINIO_DEFAULT_BUCKETS`. Swapping to
  `localstack/localstack` is this compose file plus two env vars.
- **`@node-rs/argon2` exports `Algorithm` as an ambient const enum**, which
  `isolatedModules` forbids. The algorithm is left at the library default and
  pinned by assertion in `password.test.ts` instead.
- **pnpm is installed at user level** (`npm i -g pnpm`), because `corepack
enable` needs admin to write into `Program Files`.
- **If Docker fails with `vpnkit-bridge handshake failed` or "Docker Desktop is
  unable to start"**, the fix is `wsl --shutdown` then relaunch Docker Desktop.
  Note it terminates every WSL distro, including Ubuntu.
- **Middleware is `proxy.ts` in Next 16**, with a default export named `proxy`.
- **Tests that import `lib/env` or `lib/db` need `// @vitest-environment node`**
  as their first line: `lib/env.ts` refuses to load when `window` exists, and
  the default test environment is jsdom. `*.db.test.ts` files run against the
  real Postgres and skip (with a warning) when it is unreachable.
- **`pnpm test:e2e` needs the stack up and seeded.** Each test sends its own
  `x-forwarded-for` so the per-address rate limits stay on without one run
  starving the next. If a limit ever does stick, `DELETE FROM "RateLimit"`.
- **Restart `pnpm dev` after any migration.** The Prisma client is cached on
  `globalThis` across hot reloads, so a running server keeps the old schema
  and fails with "Unknown field" on the new columns.
- **A test run that fails in clean-up leaves accounts behind**, including
  active administrators, and every submission then emails all of them. If the
  dev database feels slow or mail lags, look for `@reviewflow-test.invalid`
  users. They are removed automatically once an hour old.
- **Test files run one at a time** (`fileParallelism: false`), about 45s in
  all. In parallel, one file's cleanup deleted an admin while another file's
  submission was notifying every admin. `cleanUpTestUsers()` still removes
  only the accounts its own file created (plus debris over an hour old).
  Always make test accounts with `testEmail()`, and delete them with
  `purgeUsers()`, which removes their submissions in dependency order.
- **A `<fieldset>` will not shrink below its content** unless it has
  `min-w-0`; this caused sideways scrolling on phones. Same for grids: use
  `grid-cols-[minmax(0,1fr)]` as the base.
- **Never put an apostrophe or a regex backslash in a Bash heredoc or
  `node -e` string** in this environment: apostrophes break the shell quoting
  and `/` loses its backslash. Use the Write/Edit tools for such text.
- The network on this machine drops mid-pull; retry loops around
  `docker compose pull` are worth it.

## Conventions

- UUIDv7 primary keys; Prisma default naming (PascalCase tables, camelCase columns).
- Records are kept, not deleted: `onDelete: Restrict` for facts, `Cascade` only
  for derived rows. `Assignment` is a history table, not a column.
- "At most one active row" is enforced by the database using a nullable marker:
  `isActive` is `true` or `NULL`, never `false`, because Postgres unique indexes
  ignore NULLs. See `Assignment.isActive` and `ReviewTemplate.isActive`.
- Emails are normalised to lowercase in application code, not via `citext`.

## Design

Minimal and modern: generous whitespace, few borders, no decoration that does
not carry meaning. Every page is "glass": frosted cards over a soft blue backdrop. The theme is "Ink and Cobalt", defined as tokens in
`app/globals.css`.

- Navy ink (`primary`) for buttons and the header; a brighter blue (`mark`)
  for links, highlights, icons and the brand underline — not a button colour.
  The owner tried a red accent and rejected it as clashing; keep accents blue.
- shadcn's `accent` is a neutral hover background, not the brand accent.
- Headings use the serif via `font-heading` (Newsreader); everything else is
  Geist. `success` and `warning` are the status colours.
- `bg-panel` / `text-panel-foreground` is the solid ink surface used for the
  app header and the brand side of the auth pages; `panel-mark` is the blue
  that reads on it.
- Every colour token is `light-dark(light, dark)`. With no choice made the
  theme follows the operating system; `ThemeToggle` sets `.light` / `.dark`
  on `<html>` and a cookie, which the root layout reads so the first response
  is already correct. There is deliberately no inline theme script (React 19
  warns on script tags in the tree). Check both themes when changing colours.
- `glass` (a utility in `globals.css`) is the surface for large cards on
  every page. `<Backdrop />` (`components/backdrop.tsx`) is the fixed backdrop behind them (deliberately still: anything moving under frosted glass is re-blurred every frame, and drifting pools made pages sluggish); its parent needs `relative isolate`. It is rendered by
  `RoleArea`, the landing page, the auth layout and `not-found`. Add
  `glass-strong` where text scrolls underneath (the landing header). Small
  inner cards and reading surfaces (document previews)
  stay solid `bg-card`. Both fall back to solid when the visitor prefers
  reduced transparency. The light-theme `mark` blue and `muted-foreground` grey were darkened so tinted pills and grey text keep 4.5:1 over the blue backdrop. The light-theme `success` green was darkened to keep
  4.5:1 on a tinted pill; re-run the accessibility tests if it changes.
- **Write `backdrop-filter` only, never `-webkit-backdrop-filter` beside it.**
  With both written by hand the build kept only the prefixed line, which
  Chrome ignores, so the glass silently did not blur. The compiler adds the
  prefix itself.
- Motion, all in `globals.css` and all switched off under
  `prefers-reduced-motion`: `page-enter` (content eases in), `reveal`
  (sections fade up as they scroll in; scroll-driven CSS, so browsers without
  it just show the content), `float-slow`, and `data-glow` (a light that
  follows the pointer across a card, driven by the single listener in
  `components/pointer-glow.tsx`, mounted in the root layout). Buttons lift on
  hover and press in on click.
- Changing theme is animated: `ThemeToggle` uses the View Transitions API to
  spread the new theme as a circle from the switch. Without the API, or with
  reduced motion, it changes instantly.
- Signed-in pages render inside `RoleArea` (`components/role-area.tsx`); its
  links come from `components/nav.ts`.
- Landing-page pictures are drawn in markup (`components/home-visuals.tsx`),
  not image files.
- Icons are `lucide-react`.

## Profiles

`/profile` (all roles): name, bio, picture, change password. Code in
`lib/profile/`.

- Pictures are stored on the `User` row, not in object storage: the browser
  resizes them to 256px, and they must be served through an access check.
  `app/avatar/[userId]/route.ts` serves a picture **only to its owner or an
  admin**. This is an anonymity control — never render another person's
  avatar on an author-facing page, and never loosen that route.
- `bio` is for administrators only.
- Email cannot be changed yet (it would need re-verification).

## Dev accounts

All seeded accounts use `Password123!`, at `@apr.local`: `admin`,
`organiser`, `reviewer1`…`reviewer8` (disciplines and institutions differ),
`user1`…`user3`. Re-seed from scratch with `pnpm db:reset` then
`pnpm db:seed`; Prisma asks for explicit consent before resetting.
