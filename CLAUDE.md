@AGENTS.md

# ReviewFlow — working context

Document review platform: users submit written work, an admin assigns a
reviewer, the reviewer returns structured feedback and an annotated file, and
the admin approves it before the user sees it. **Reviewers are anonymous to
users.** See `README.md` for setup and `docs/PLAN.md` for the full 10-phase
plan and the verification checklist.

## Status

Phases 0 and 1 are complete and verified. Phase 2 (auth) is partly done:
`lib/auth/password.ts`, `tokens.ts`, and `session.ts` exist and are tested.

Phase 2 remaining: role guards (`requireRole`, `requireOwnership`), route-group
middleware, login / register / forgot / reset pages, invite redemption, and
login rate limiting.

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

## Dev accounts

All seeded accounts use `Password123!`:
`admin@reviewflow.local`, `reviewer1@` / `reviewer2@`, `user1@` / `user2@` / `user3@`
(all `@reviewflow.local`).
