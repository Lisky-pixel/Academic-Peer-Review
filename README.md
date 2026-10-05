# ReviewFlow

A web platform for managing document review: users submit written work, an admin
assigns it to a reviewer, the reviewer returns structured feedback and an
annotated file, and the admin approves it before the user ever sees it.

**Reviewers are anonymous to users** — by design, everywhere, including inside
downloaded files.

## The pipeline

```
User submits ──▶ [GATE 1: admin assigns reviewer] ──▶ Reviewer reviews & uploads
                                                              │
User views/downloads ◀── [GATE 2: admin approves] ◀───────────┘
                                      │
                                      └──▶ Revision Requested ──▶ back to reviewer
```

## Stack

| Layer    | Development                                | Production    |
| -------- | ------------------------------------------ | ------------- |
| App      | Next.js 16 (App Router), TypeScript        | same, Vercel  |
| UI       | Tailwind 4 + shadcn/ui                     | same          |
| Database | Postgres 17 (Docker)                       | Neon          |
| Storage  | MinIO (S3 API)                             | Cloudflare R2 |
| Email    | Mailpit (catches everything)               | Resend        |
| Auth     | Own sessions (argon2id + httpOnly cookies) | same          |

Storage and email sit behind interfaces (`lib/storage`, `lib/email`), so the only
difference between the two columns is environment variables.

## Getting started

Requires Node 20+, pnpm, and Docker Desktop.

```bash
pnpm install
cp .env.example .env.local     # defaults already target the Docker stack
pnpm docker:up                 # Postgres + MinIO + Mailpit
pnpm db:reset                  # migrate + seed
pnpm dev
```

| Service       | URL                                                        |
| ------------- | ---------------------------------------------------------- |
| App           | http://localhost:3000                                      |
| Mailpit inbox | http://localhost:8025                                      |
| MinIO console | http://localhost:9001 (`reviewflow` / `reviewflow-secret`) |
| Prisma Studio | `pnpm db:studio`                                           |

No email leaves your machine in development — Mailpit catches all of it.

## Commands

```bash
pnpm dev              # dev server
pnpm build            # production build
pnpm test             # unit tests (Vitest)
pnpm test:e2e         # end-to-end tests (Playwright)
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm typecheck        # tsc --noEmit
pnpm db:migrate       # create/apply a migration
pnpm db:reset         # drop, migrate, reseed
pnpm db:studio        # browse the database
pnpm docker:up|down   # local services
```

## Project layout

```
app/                 routes, grouped by role: (auth) (user) (reviewer) (admin)
components/          shared UI; components/ui is shadcn
lib/
  auth/              hashing, sessions, invites, password reset, role guards
  workflow/          the submission state machine — all status changes route here
  dto/               serialization boundary; where reviewer anonymity is enforced
  storage/           S3-compatible client (MinIO + R2)
  files/             upload validation and document metadata scrubbing
  email/             provider interface, templates, send log
prisma/              schema, migrations, seed
e2e/                 Playwright specs
```

## Two things to know before changing code

1. **Never mutate `Submission.status` directly.** Every transition goes through
   `lib/workflow/state-machine.ts`, which validates legality, checks the actor's
   role, writes the activity log, and queues notifications in one transaction.

2. **Never return a Prisma entity to a page or route.** Map it through `lib/dto/`
   first. `toUserSubmissionDTO()` has no reviewer field in its return type, which
   is what makes an anonymity leak a compile error instead of a production
   incident.

## Documentation map

| File                   | What it holds                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `CLAUDE.md`            | Current status, settled decisions, and environment gotchas. Loaded automatically by Claude Code |
| `docs/PLAN.md`         | The full 10-phase implementation plan and the end-to-end verification checklist                 |
| `prisma/schema.prisma` | The data model, with the reasoning for each invariant in comments                               |

Git history is intentionally verbose: each commit message explains _why_, not
just what. `git log` is the third place to look.
