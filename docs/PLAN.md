> **Status (2026-10-05):** Phases 0–2, 4 and 5 complete and verified. Phase 3
> is complete except file scrubbing, which moves to Phase 6 (it only applies
> to reviewer uploads). Next is Phase 6 (reviewer workspace). Current working
> context lives in `CLAUDE.md`.

# ReviewFlow — Implementation Plan

## Context

**The problem.** Document review currently sprawls across WhatsApp, email, and Google Drive. Nothing is tracked, assignments are verbal, follow-ups are manual, records are scattered, and reviewer anonymity depends entirely on people remembering not to mention names. The SRS calls for collapsing this into one platform.

**What we're building.** A Next.js web application with a three-party pipeline and two admin gates:

```
User submits ──▶ [GATE 1: admin assigns reviewer] ──▶ Reviewer reviews & uploads
                                                              │
User views/downloads ◀── [GATE 2: admin approves] ◀───────────┘
                                      │
                                      └──▶ Revision Requested ──▶ back to reviewer
```

**Intended outcome.** A real, deployed tool the owner actually operates: users submit documents and get reviewed work back; reviewers work a clean queue; the admin sees and controls everything; reviewer identity never reaches the user — not in the UI, not in emails, not inside downloaded files.

**Two properties drive the whole design**, and everything below hangs off them:

1. **The status lifecycle is the spine.** Twelve states govern every permission check, dashboard count, and email trigger. It is modelled as an explicit state machine with a legal-transition table, not a free-form string column.
2. **Anonymity is a system property, not a UI choice.** It is enforced at a serialization boundary in code, and it extends into uploaded file bytes — a `.docx` carries the author's name in its metadata _and_ in every tracked change and comment. Hiding a name in the UI while shipping it inside the file is not anonymity.

---

## Decisions already made

| Area                | Decision                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Architecture        | **Next.js full-stack** (App Router; route handlers + server actions are the backend)                                             |
| Language            | TypeScript, `strict: true`                                                                                                       |
| Database            | **Neon Postgres** (prod) / Docker Postgres (dev), via **Prisma**                                                                 |
| File storage        | **Cloudflare R2** (prod) / MinIO (dev) — zero egress cost, and users download a lot                                              |
| Email               | **Resend** + verified custom domain (prod) / Mailhog (dev)                                                                       |
| Auth                | **Hand-rolled DB sessions** — argon2id, httpOnly cookies, own role guards                                                        |
| Reviewer onboarding | **Admin invite only.** No public reviewer signup route exists                                                                    |
| Anonymity           | Reviewer always hidden from user. **Author visibility to reviewer is a per-submission toggle**, defaulting from a global setting |
| Document viewing    | **In-browser preview** (PDF.js for PDF, Mammoth for `.docx`) **+ download**                                                      |
| Purpose             | A real tool for real use — reliability and the full workflow over feature count                                                  |

### Two setup points to confirm at kickoff

- **Project location.** I recommend `C:\Users\levis\Projects\reviewflow` — a fresh git repo **outside OneDrive**. OneDrive actively syncing `node_modules` and `.next` causes file locks and failed builds on Windows, and this is a personal project rather than ALU coursework. If you'd rather keep it under `ALU_Projects`, say so and I'll add OneDrive exclusions instead.
- **The sending domain** for Resend — needed only at Phase 8, not at kickoff.

---

## Stack detail

| Concern            | Choice                                      | Why this one                                                                                               |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| UI                 | Tailwind + **shadcn/ui** (Radix)            | Accessible primitives (dialog, select, toast) we'd otherwise hand-build; we own the source, no runtime dep |
| Forms / validation | react-hook-form + **Zod**                   | One schema validates client _and_ server; Zod types feed Prisma inputs                                     |
| Password hashing   | **`@node-rs/argon2`**                       | Prebuilt binaries — plain `argon2` needs a native toolchain and breaks on Vercel                           |
| Uploads            | **Presigned PUT direct to R2**              | Vercel's serverless request body cap is ~4.5MB; documents must never pass through the function             |
| PDF preview        | `pdfjs-dist`                                | Renders client-side from a signed URL                                                                      |
| `.docx` preview    | `mammoth`                                   | Lossy on complex layout — acceptable, download is always offered alongside                                 |
| Email templates    | **`react-email`** + Resend                  | Templates are components, previewable locally in a dev route                                               |
| Scheduling         | **Vercel Cron** → protected route handler   | Deadline reminders and overdue sweeps; no extra service                                                    |
| Rate limiting      | Postgres-backed counter behind an interface | Avoids a fourth vendor; swappable for Upstash Redis if traffic warrants                                    |
| Testing            | **Vitest** (unit) + **Playwright** (E2E)    | Unit-test the state machine, guards, and anonymity mappers; E2E the three-role journey                     |
| Hosting            | **Vercel**                                  | Native Next.js fit; Neon, R2, and Resend all reachable from it                                             |

---

## Data model

Core tables (Prisma, `prisma/schema.prisma`):

```
User              id, email(citext unique), passwordHash?, name, role(USER|REVIEWER|ADMIN),
                  status(INVITED|ACTIVE|SUSPENDED), createdAt
Session           id, tokenHash(unique), userId, expiresAt, ip, userAgent
Token             id, tokenHash, userId, purpose(INVITE|PASSWORD_RESET), expiresAt, consumedAt

DocumentType      id, name, slug, description, isActive, sortOrder        ← the 11 SRS types, admin-editable
ReviewTemplate    id, documentTypeId, name, version, isActive
ReviewCriterion   id, templateId, label, helpText, inputType(RATING|TEXT|BOTH),
                  maxRating, required, sortOrder

Submission        id, reference(unique "RF-2026-0147"), userId, title, documentTypeId,
                  purpose, description, instructions, focusAreas, deadline,
                  status(12 states), authorVisibleToReviewer(bool),
                  createdAt, submittedAt, approvedAt, deliveredAt, cancelledAt
StoredFile        id, submissionId, kind(ORIGINAL|ANNOTATED), storageKey, originalFilename,
                  mimeType, sizeBytes, checksum, uploadedById, scrubbedAt, createdAt

Assignment        id, submissionId, reviewerId, assignedById, dueAt,
                  status(PENDING|ACCEPTED|DECLINED|CANCELLED|COMPLETED),
                  assignedAt, acceptedAt, declinedAt, declineReason, cancelledAt
Review            id, submissionId, assignmentId, templateId, overallFeedback,
                  status(DRAFT|SUBMITTED), submittedAt, revisionRound
ReviewResponse    id, reviewId, criterionId, rating, comment
AdminDecision     id, reviewId, adminId, decision(APPROVED|REVISION_REQUESTED), note, createdAt

Notification      id, userId, type, title, body, linkUrl, readAt, createdAt   ← in-app bell
EmailLog          id, toEmail, template, submissionId?, providerId, status, error, sentAt
ActivityLog       id, actorId, actorRole, action, entityType, entityId, metadata(Json), ip, createdAt
AppSetting        key(pk), value(Json)                        ← default author visibility, reminder lead time
```

**Design notes that matter:**

- **Assignment is a history table, not a column.** Reassignment creates a new row and cancels the old one; the SRS requires reassignment _and_ an audit trail. A partial unique index enforces at most one non-terminal assignment per submission.
- **Review templates are versioned.** Editing a template must not silently mutate the criteria of reviews already submitted against it — a new version is created and old reviews keep pointing at the old one.
- **`revisionRound`** on `Review` lets the admin bounce a review back repeatedly while keeping each round's responses.
- **`scrubbedAt`** on `StoredFile` proves metadata stripping ran before any user-facing download is permitted.

---

## The state machine

`lib/workflow/state-machine.ts` — a single exported transition table. Every mutation routes through `transition(submission, event, actor)`, which validates the actor's role and the legality of the move, writes the `ActivityLog` row, and enqueues notifications in **one database transaction**.

| From                                    | Event                      | To                   | Who                                |
| --------------------------------------- | -------------------------- | -------------------- | ---------------------------------- |
| —                                       | create draft               | `DRAFT`              | user                               |
| `DRAFT`                                 | submit                     | `PENDING_ASSIGNMENT` | user                               |
| `PENDING_ASSIGNMENT`                    | assign                     | `ASSIGNED`           | admin                              |
| `ASSIGNED`                              | accept                     | `ACCEPTED`           | reviewer                           |
| `ASSIGNED`                              | decline                    | `PENDING_ASSIGNMENT` | reviewer                           |
| `ASSIGNED` \| `ACCEPTED` \| `IN_REVIEW` | reassign                   | `ASSIGNED`           | admin                              |
| `ACCEPTED`                              | start / save draft         | `IN_REVIEW`          | reviewer                           |
| `IN_REVIEW`                             | submit review              | `UNDER_ADMIN_REVIEW` | reviewer                           |
| `UNDER_ADMIN_REVIEW`                    | request revision           | `REVISION_REQUESTED` | admin                              |
| `REVISION_REQUESTED`                    | resubmit                   | `UNDER_ADMIN_REVIEW` | reviewer                           |
| `UNDER_ADMIN_REVIEW`                    | approve                    | `APPROVED`           | admin                              |
| `APPROVED`                              | user first views/downloads | `DELIVERED`          | system                             |
| any non-terminal                        | cancel                     | `CANCELLED`          | admin / user (own, pre-assignment) |

Two SRS states are deliberately collapsed to avoid dead weight: `SUBMITTED` is transient and resolves immediately to `PENDING_ASSIGNMENT`, and `REVIEW_SUBMITTED` is the same moment as `UNDER_ADMIN_REVIEW`. Both remain in the enum so displayed history stays faithful to the spec.

`DELIVERED` is defined as **the user has actually opened or downloaded the review** — which makes "approved but never collected" a visible, chaseable state on the admin dashboard rather than an invisible one.

---

## Anonymity enforcement

Three independent layers, because any one of them failing alone should not leak identity.

**1. Serialization boundary — `lib/dto/`.** Route handlers and server components never return Prisma entities directly. `toUserSubmissionDTO()` has no reviewer field in its return _type_, so a leak is a TypeScript compile error rather than a runtime bug. `toAdminSubmissionDTO()` includes full reviewer identity.

**2. File-byte scrubbing — `lib/files/scrub.ts`.** Runs server-side on every `ANNOTATED` upload before it is downloadable:

- `.docx` is a zip: rewrite `docProps/core.xml` (`dc:creator`, `cp:lastModifiedBy`), and — the part that's easy to miss — rewrite every `w:author` attribute on tracked changes (`w:ins`, `w:del`, `w:rPrChange`) and on comments in `word/comments.xml` to the literal `"Reviewer"`.
- PDF: strip `/Author`, `/Creator`, `/Producer` and XMP metadata.
- Stored filename is regenerated from the reference (`RF-2026-0147-reviewed.docx`) so a reviewer's own filename never reaches the user.
- `scrubbedAt` is stamped; the user download route refuses any file where it is null.

**3. Email templates.** User-facing templates receive a DTO that structurally cannot carry reviewer fields. The sender identity is always the platform, never the reviewer.

**Guardrail:** a Vitest suite snapshots every user-facing DTO and email render against a fixture whose reviewer has a distinctive name, and asserts that string appears nowhere. This test is the thing that keeps anonymity true six months from now.

The **per-submission `authorVisibleToReviewer` toggle** is resolved in one place, `toReviewerSubmissionDTO()`, which returns the author's name or `null` — so the branch exists once, not scattered through reviewer screens.

---

## Build phases

Each phase ends with something runnable and verifiable. Roughly ordered by dependency, not by screen.

### Phase 0 — Foundations

`create-next-app` (TS, App Router, Tailwind), shadcn/ui init, ESLint + Prettier, `docker-compose.yml` (Postgres + MinIO + Mailhog), `.env.example`, Vitest + Playwright config, git repo with a first commit.
**Done when:** `docker compose up` + `pnpm dev` serves a styled placeholder page.

### Phase 1 — Data model

Full `schema.prisma`, initial migration, and `prisma/seed.ts` creating: an admin, two reviewers, three users, the 11 document types, and a complete review template per type (the personal-statement one carrying the SRS's nine criteria).
**Done when:** `pnpm db:reset` produces a fully populated database; Prisma Studio shows it.

### Phase 2 — Auth & RBAC

`lib/auth/`: argon2id hashing, session create/validate/revoke, password reset, invite redemption. Middleware for route-group protection, plus `requireRole()` / `requireOwnership()` guards used inside every server action. Login, register, forgot/reset password, and invite-acceptance pages. Rate limiting on login and reset. Generic error text so the form can't be used to enumerate registered emails.
**Done when:** each seeded role logs in and is bounced from the other two roles' routes; unit tests cover the guards.

### Phase 3 — Storage layer

`lib/storage/` behind a `StorageProvider` interface, with an S3-compatible implementation serving both R2 and MinIO. Presigned upload and download URLs, magic-byte + MIME + extension + size validation (accepting PDF/DOCX/DOC/TXT/RTF, 20MB cap), and the scrubbing module from above. Downloads are always served with `Content-Disposition: attachment` from the storage origin, never inline from ours.
**Done when:** a file uploads to MinIO via presigned PUT, downloads back intact, and an integration test proves a tracked-changes `.docx` comes out with its author fields neutralised.

### Phase 4 — User submission & tracking

Multi-step submission form (details → instructions & focus areas → deadline → upload → review & submit), draft save, reference-number generation (a Postgres sequence per year, so it's collision-free under concurrency), submission list with status filters, and a detail page with a status timeline.
**Done when:** a user creates a draft, submits it, and the admin sees it in Pending Assignment.

### Phase 5 — Admin assignment

Admin submissions table (filter by status, type, deadline), assignment drawer showing **live reviewer workload** — active review counts and overdue flags — reassign with reason, and the per-submission author-visibility toggle. State machine wired in.
**Done when:** assigning moves the submission to `ASSIGNED`, creates the Assignment row, and writes the activity log.

### Phase 6 — Reviewer workspace

Reviewer queue (pending / active / completed / overdue tabs), accept and decline, and the split-pane workspace: document preview left, template-driven feedback form right, with autosave to a `DRAFT` review. Annotated-file upload, then submit.
**Done when:** a reviewer completes a full review and it lands in the admin's approval queue.

### Phase 7 — Admin approval loop

Approval screen showing the original document, the annotated document, and all criterion responses side by side. Approve, or request revision with a note that reaches the reviewer. Delivery on user's first view.
**Done when:** the full round trip runs end-to-end, including at least one revision bounce.

### Phase 8 — Notifications

`lib/email/` behind an interface (Resend + Mailhog implementations), `react-email` templates for the full SRS matrix across all three roles, an in-app notification bell, `EmailLog` persistence with retry on failure, a `/dev/emails` preview route, and a Vercel Cron endpoint for deadline reminders and overdue escalation. **Domain DNS verification happens here.**
**Done when:** every workflow event produces the right mail in Mailhog, and the reminder job fires correctly against seeded near-deadline data.

### Phase 9 — Dashboards & admin management

The three role dashboards exactly as specified in SRS §11, plus admin CRUD for users, reviewers (with invites), document types, and versioned review templates. Activity log viewer with filters. Reports: submissions over time, average turnaround, reviewer throughput.
**Done when:** every SRS §11 metric renders from real data, and template edits version rather than mutate.

### Phase 10 — Hardening & launch

Security headers and CSP, CSRF protection on mutations, Zod validation on every input boundary, structured error handling, Playwright E2E of the three-role journey, the anonymity guardrail suite, accessibility pass, Neon/R2/Resend provisioning, Vercel deploy with cron, automated Neon backups, and a README covering architecture, the state machine, and local setup.
**Done when:** the deployed app completes the full workflow with real email and real storage.

---

## Verification

**Continuously, per phase:**

- `pnpm test` — Vitest over the state machine (every legal and illegal transition), auth guards, DTO mappers, reference generation, and file scrubbing.
- `pnpm db:reset && pnpm dev` — seeded data, three known logins.

**The end-to-end acceptance walkthrough** (scripted in Playwright at Phase 10, run manually before that):

1. Register a user → submit a personal statement with instructions and a deadline → note the reference number.
2. Admin logs in → the submission is in Pending Assignment → assign a reviewer → **check Mailhog for the assignment email**.
3. Reviewer logs in → accepts → previews the document in-browser → fills every criterion → uploads an annotated `.docx` → submits.
4. Admin → requests a revision with a note → reviewer sees it and resubmits → admin approves.
5. User → receives notification → opens the review → **asserts "Reviewer: Anonymous"** and no reviewer name anywhere on the page → downloads the annotated file.
6. **Unzip the downloaded `.docx` and inspect `docProps/core.xml` and the tracked-change authors** — the reviewer's name must not appear.
7. Submission reads `DELIVERED`; the admin activity log shows the full attributed chain with the real reviewer named.

**Negative checks:** user B cannot fetch user A's submission by id or reference; a reviewer cannot open an unassigned submission; a non-admin cannot reach any `/admin` route or admin server action; an expired session is rejected; a consumed reset token cannot be reused.

---

## Deliberately out of scope (SRS §15)

Auto-assignment, workload balancing, in-browser annotation, internal messaging, payments, subscriptions, organization accounts, AI feedback, Google Docs / Word integration, mobile app, advanced analytics.
