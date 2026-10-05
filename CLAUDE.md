@AGENTS.md

# ReviewFlow — working context

Document review platform: users submit written work, an admin assigns a
reviewer, the reviewer returns structured feedback and an annotated file, and
the admin approves it before the user sees it. **Reviewers are anonymous to
users.** See `README.md` for setup and `docs/PLAN.md` for the full 10-phase
plan and the verification checklist.

## Status

Phases 0–6 are complete and verified. Next is Phase 7 (admin approval and
delivery).

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
- Author pages are under `/dashboard/submissions`.

Phase 5 (assignment), in `lib/assignments`:

- `assignReviewer` / `reassignReviewer` call `transition()` and write the
  `Assignment` rows in its `apply` hook. Reassigning retires the old row
  (`isActive: null`, `CANCELLED`) and needs a reason; history is never
  overwritten.
- `/admin` lists submitted work, filterable by status, type and deadline;
  `/admin/submissions/[id]` is the detail page with the reviewer picker
  (live workload per reviewer), the author-visibility switch, and the audit
  trail. `lib/dto/assignment.ts` holds the admin-only DTOs — they carry
  reviewer identity and must never reach an author page.
  Phase 6 (reviewer workspace), in `lib/reviews`:

- `/reviewer` is the queue (to answer / in progress / overdue / submitted);
  `/reviewer/reviews/[id]` is the invitation, then the split-pane workspace,
  then a read-only summary. Every query is scoped to submissions the reviewer
  currently holds (`isActive` assignment).
- The first autosave starts the review (`ACCEPTED` → `IN_REVIEW`) and pins it
  to the template that was active then. Autosave sends only changed criteria.
- **`lib/files/scrub.ts` removes the reviewer's identity from file bytes**:
  Word document properties, every `w:author` on tracked changes and
  comments, `people.xml`; PDF Info entries, the XMP stream and every
  annotation's `/T`. It fails closed. `scrub.test.ts` is the guardrail —
  extend it whenever a new place a name can hide is found.
- Reviewers may only return PDF, DOCX or TXT, because only those can be
  scrubbed. `confirmAnnotatedUpload` stores **only** the scrubbed copy, named
  from the reference, with `scrubbedAt` set; the raw upload is always deleted.
  Any author-facing download of an `ANNOTATED` file (Phase 7) must refuse a
  row without `scrubbedAt`.
- `toReviewerSubmissionDTO()` in `lib/dto/review.ts` is the only place
  `authorVisibleToReviewer` is resolved. When the author is hidden, the
  document's filename is replaced by the reference too.
- Preview: PDF via PDF.js in the browser; DOCX converted by Mammoth on the
  server and shown in an `<iframe sandbox="">` (never inserted into our DOM);
  TXT as text. DOC and RTF have no preview.
- `Review.overallFeedback` is unused: overall feedback is the last criterion
  of every template.

Known limits, deliberately left:

- Hiding the author hides their name and filename, **not** what is inside
  their document or its metadata. A CV names its author regardless.
- Scrubbing removes metadata, not a name a reviewer types into a comment.
- The admin cannot yet read a submitted review; that is Phase 7.
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
