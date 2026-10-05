@AGENTS.md

# ReviewFlow — working context

Document review platform: users submit written work, an admin assigns a
reviewer, the reviewer returns structured feedback and an annotated file, and
the admin approves it before the user sees it. **Reviewers are anonymous to
users.** See `README.md` for setup and `docs/PLAN.md` for the full 10-phase
plan and the verification checklist.

## Status

Phases 0–2 and 4 are complete and verified. Phase 3 is complete **except
`lib/files/scrub.ts`**, which is not written yet. Next is Phase 5 (admin
assignment).

**Scrubbing must be built with Phase 6**, before any reviewer-uploaded
(`ANNOTATED`) file can reach an author — it is the anonymity layer for file
bytes. Nothing uploads `ANNOTATED` files yet, so nothing is exposed today.

Phases 3–4 (storage and submissions):

- `lib/storage` is the `StorageProvider` interface with one S3 implementation
  for R2 and MinIO. Document bytes never pass through the app: the browser
  PUTs to a signed URL (`prepareUpload`), then the server fetches the object
  and checks its real size and magic bytes (`confirmUpload`) before recording
  it. Downloads redirect to a signed, attachment-only URL.
- `lib/files/validate.ts` decides what is accepted (PDF, DOCX, DOC, RTF, TXT;
  extension + declared type + size + magic bytes).
- `lib/workflow/transitions.ts` is the legal-move table (pure, fully tested);
  `lib/workflow/state-machine.ts` `transition()` is the only code that changes
  `Submission.status`. Extra writes for a move go in its `apply` callback so
  they share the transaction.
- `lib/submissions` is the author side. Every query is scoped to the author.
- Authors never see the internal status: `toUserSubmissionDTO()` exposes an
  `AuthorStage` (`lib/submissions/stage.ts`) so internal bounces do not show.
- Author pages are under `/dashboard/submissions`. `/admin` lists submitted
  work by status; it is read-only until Phase 5.
- **Production needs a CORS rule on the R2 bucket** allowing `PUT` from the
  app origin with the `Content-Type` header. MinIO allows all origins by
  default, so this does not show up in development.
- Uploads that are prepared but never confirmed leave orphan objects; a
  cleanup belongs in the Phase 8 maintenance job.

Phase 2 (auth) lives in `lib/auth/`, `lib/rate-limit/`, `app/(auth)/` and
`proxy.ts`:

- Every protected page and server action starts with `requireRole()` /
  `requireUser()` / `requireOwnership()` from `lib/auth/guards.ts`. `proxy.ts`
  only checks that a session cookie is present; it is not the enforcement.
- Role areas are `/dashboard` (USER), `/reviewer`, `/admin` — see `HOME_PATH`
  in `lib/auth/routes.ts`. A new area must also be added to the `proxy.ts`
  matcher. The three pages there are placeholders. `/profile` is shared.
- Registration is two steps (`lib/auth/registration.ts`): `/register` stores
  the account as `UNVERIFIED` and always answers "check your inbox";
  `/verify-email/[token]` activates it and needs the password as well as the
  link. Never make `/register` respond differently for a taken address.
- `/admin/invites` sends, resends and cancels invitations. Full user
  management is still Phase 9.
- `lib/email` is a minimal transport; templates, `EmailLog` and retry are
  Phase 8. Its Resend branch is pinned by `email.test.ts` against a mocked
  `fetch` but has never been run against the live API — do one real send
  when the key and domain exist.
- No scheduled job exists yet (Phase 8). When it does it must call
  `deleteExpiredSessions`, `deleteExpiredRateLimits` and
  `deleteStaleUnverifiedUsers`.

## Two rules that must not be broken

1. **Never assign `Submission.status` directly.** Every transition goes through
   `lib/workflow/state-machine.ts`, which validates legality, checks the actor's
   role, writes the activity log, and queues notifications in one transaction.

2. **Never return a Prisma entity to a page or route.** Map it through
   `lib/dto/` first. `toUserSubmissionDTO()` has no reviewer field in its return
   _type_, which is what makes an anonymity leak a compile error rather than a
   production incident. Reviewer identity must also stay out of user-facing
   emails and out of downloaded file bytes (`lib/files/scrub.ts`).

## Decisions already made — do not relitigate

| Area              | Decision                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture      | Next.js full-stack, App Router; route handlers + server actions are the backend                                                                                                |
| Database          | Neon (prod) / Docker Postgres (dev), via Prisma + `@prisma/adapter-pg`                                                                                                         |
| Storage           | Cloudflare R2 (prod) / MinIO (dev), behind `lib/storage`                                                                                                                       |
| Email             | Resend on a verified domain (prod) / Mailpit (dev), behind `lib/email`                                                                                                         |
| Auth              | Hand-rolled DB sessions: argon2id, httpOnly cookies, own guards. No Auth.js, no Clerk                                                                                          |
| Reviewer accounts | **Admin invite only.** A public reviewer signup route must never exist; `/register` always creates `role: USER`                                                                |
| Anonymity         | Reviewer always hidden from the author. Author visibility to the reviewer is the per-submission `authorVisibleToReviewer` toggle, resolved only in `toReviewerSubmissionDTO()` |
| Document viewing  | In-browser preview (PDF.js for PDF, Mammoth for .docx) plus download                                                                                                           |
| Purpose           | A real tool for real use — reliability over feature count                                                                                                                      |

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
- **`*.db.test.ts` files run in parallel**, so `cleanUpTestUsers()` removes
  only the accounts its own file created (plus debris over an hour old).
  Always make test accounts with `testEmail()`.
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
not carry meaning. The theme is "Ink and Cobalt", defined as tokens in
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

All seeded accounts use `Password123!`:
`admin@reviewflow.local`, `reviewer1@` / `reviewer2@`, `user1@` / `user2@` / `user3@`
(all `@reviewflow.local`).
