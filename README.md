# ReviewFlow

A web platform for managing document review. An author submits written work, an
administrator assigns it to a reviewer, the reviewer returns structured feedback
and an annotated file, and the administrator approves it before the author sees
anything.

**Reviewers are anonymous to authors**, everywhere: in the interface, in emails,
and inside the files authors download.

```
Author submits ──▶ [GATE 1: admin assigns reviewer] ──▶ Reviewer reviews & uploads
                                                               │
Author reads/downloads ◀── [GATE 2: admin approves] ◀──────────┘
                                       │
                                       └──▶ Revision requested ──▶ back to reviewer
```

To put it on the internet, follow [docs/DEPLOY.md](docs/DEPLOY.md). The original
plan and its phases are in [docs/PLAN.md](docs/PLAN.md).

## Stack

| Layer    | Development                                | Production    |
| -------- | ------------------------------------------ | ------------- |
| App      | Next.js 16 (App Router), TypeScript        | same, Vercel  |
| UI       | Tailwind 4, shadcn/ui, lucide icons        | same          |
| Database | Postgres 17 (Docker), Prisma 7             | Neon          |
| Storage  | MinIO (S3 API)                             | Cloudflare R2 |
| Email    | Mailpit (catches everything)               | Resend        |
| Auth     | Own sessions (argon2id + httpOnly cookies) | same          |

Storage and email sit behind interfaces (`lib/storage`, `lib/email`), so the only
difference between the two columns is environment variables.

## Getting started

Requires Node 20+, pnpm, and Docker Desktop.

```bash
pnpm install
cp .env.example .env.local     # the defaults already target the Docker stack
pnpm docker:up                 # Postgres + MinIO + Mailpit
pnpm db:reset                  # migrate + seed
pnpm dev
```

| Service        | URL                                                        |
| -------------- | ---------------------------------------------------------- |
| App            | http://localhost:3000                                      |
| Mailpit inbox  | http://localhost:8025                                      |
| MinIO console  | http://localhost:9001 (`reviewflow` / `reviewflow-secret`) |
| Email previews | http://localhost:3000/dev/emails                           |
| Prisma Studio  | `pnpm db:studio`                                           |

No email leaves your machine in development; Mailpit catches all of it.

Seeded accounts, all with the password `Password123!`:

| Role          | Email                                                      |
| ------------- | ---------------------------------------------------------- |
| Administrator | `admin@reviewflow.local`                                   |
| Reviewer      | `reviewer1@reviewflow.local`, `reviewer2@reviewflow.local` |
| Author        | `user1@`, `user2@`, `user3@` (all `@reviewflow.local`)     |

**Restart `pnpm dev` after any database migration.** The running server caches
the database client and will fail on new columns until restarted.

## Commands

```bash
pnpm dev                 # development server
pnpm build               # production build
pnpm typecheck           # TypeScript
pnpm lint                # ESLint
pnpm format              # Prettier

pnpm test                # unit and database tests (Vitest), about a minute
pnpm test:e2e            # browser tests (Playwright); needs the stack up and seeded

pnpm db:migrate          # create and apply a migration in development
pnpm db:deploy           # apply migrations (production)
pnpm db:seed             # reference data + development accounts
pnpm db:seed:reference   # reference data only; safe for production
pnpm db:reset            # drop, migrate, seed
pnpm admin:create --email you@example.com --name "Your Name"
                         # the first administrator of a fresh deployment
```

The first run of the browser tests needs `pnpm exec playwright install chromium`.

## How it is put together

```
app/                 pages, route handlers and server actions, by role
  (auth)/            sign in, register, reset, invite, verify
  (user)/            the author's dashboard and submissions
  (reviewer)/        the reviewer's queue and workspace
  (admin)/           submissions, people, document types, activity, reports
  (account)/         profile and notifications, shared by every role
  api/cron/          the scheduled maintenance endpoint
lib/
  auth/              sessions, passwords, guards, invites, registration
  workflow/          the state machine
  submissions/ assignments/ reviews/ approvals/    one folder per stage
  dto/               what each audience is allowed to see
  files/             upload validation and metadata scrubbing
  storage/ email/    providers, behind interfaces
  notifications/     in-app and email notices, and all their wording
  maintenance/       reminders, escalation, clean-up
  admin/             people, document types, templates, activity, reports
proxy.ts             route protection and the Content Security Policy
prisma/              schema, migrations, seed
e2e/                 browser tests
```

### The state machine

A submission's status is changed in exactly one place: `transition()` in
[lib/workflow/state-machine.ts](lib/workflow/state-machine.ts). In one database
transaction it checks the move is legal for that person, updates the status,
writes the activity log, and queues notifications. The table of legal moves is
[lib/workflow/transitions.ts](lib/workflow/transitions.ts).

| From                              | Event            | To                   | Who                                |
| --------------------------------- | ---------------- | -------------------- | ---------------------------------- |
| `DRAFT`                           | submit           | `PENDING_ASSIGNMENT` | author                             |
| `PENDING_ASSIGNMENT`              | assign           | `ASSIGNED`           | admin                              |
| `ASSIGNED`                        | accept           | `ACCEPTED`           | reviewer                           |
| `ASSIGNED`                        | decline          | `PENDING_ASSIGNMENT` | reviewer                           |
| `ASSIGNED`/`ACCEPTED`/`IN_REVIEW` | reassign         | `ASSIGNED`           | admin                              |
| `ACCEPTED`                        | start review     | `IN_REVIEW`          | reviewer (on first save)           |
| `IN_REVIEW`                       | submit review    | `UNDER_ADMIN_REVIEW` | reviewer                           |
| `UNDER_ADMIN_REVIEW`              | request revision | `REVISION_REQUESTED` | admin                              |
| `REVISION_REQUESTED`              | resubmit         | `UNDER_ADMIN_REVIEW` | reviewer                           |
| `UNDER_ADMIN_REVIEW`              | approve          | `APPROVED`           | admin                              |
| `APPROVED`                        | deliver          | `DELIVERED`          | system, on the author's first view |
| any unfinished state              | cancel           | `CANCELLED`          | admin; author before assignment    |

Authors never see these statuses. They see a simpler stage
([lib/submissions/stage.ts](lib/submissions/stage.ts)), so internal back-and-forth
never looks like their submission going backwards.

### Anonymity

Three independent layers, so that one failing does not leak an identity.

1. **What each audience can be given** is fixed by types in `lib/dto/`. The
   author-facing shapes have no field that could hold a reviewer's name; adding
   one is a compile error, and tests lock the field lists.
2. **File bytes.** [lib/files/scrub.ts](lib/files/scrub.ts) removes the reviewer
   from Word and PDF files: document properties, the author of every tracked
   change, comment and annotation, and embedded metadata. Only the scrubbed copy
   is stored, renamed from the submission's reference.
3. **Messages.** All notification wording is in
   [lib/notifications/messages.ts](lib/notifications/messages.ts). The functions
   that write to authors take only a reference and a title, and email is always
   sent from the platform's own address.

The opposite direction, whether a reviewer may see who the author is, is a
per-submission switch resolved only in `toReviewerSubmissionDTO()`.

### Security

- Sessions are random tokens in an httpOnly, SameSite=Lax cookie; only their
  SHA-256 is stored. Passwords are argon2id.
- Every protected page and action starts with a guard from
  [lib/auth/guards.ts](lib/auth/guards.ts) that checks the database.
- [proxy.ts](proxy.ts) sets a Content Security Policy with a per-request nonce;
  other security headers are in [next.config.ts](next.config.ts).
- Cross-site request forgery: mutations are server actions, which Next.js only
  accepts when the request's origin matches the site, and the session cookie is
  not sent on cross-site POSTs.
- Uploads go straight to storage through short-lived signed URLs, and are
  checked by their real bytes before being recorded.
- Sign-in, registration and reset are rate limited, and answer the same way
  whether or not an email is registered.

## Testing

`pnpm test` runs the unit tests and the database tests (`*.db.test.ts`), which
use the real Postgres and MinIO from Docker and skip, with a warning, if those
are not running. They clean up the accounts they create.

`pnpm test:e2e` drives a real browser through every flow, including the full
three-role journey with a revision bounce, and checks accessibility and the
Content Security Policy.

Working notes for whoever, or whatever, picks the code up next are in
[CLAUDE.md](CLAUDE.md).
