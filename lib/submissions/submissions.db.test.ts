// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toAdminSubmissionDTO, toUserSubmissionDTO } from "@/lib/dto/submission";
import type { Role } from "@/lib/generated/prisma/client";
import { storage } from "@/lib/storage";
import {
  allocateReference,
  confirmUpload,
  createDraft,
  findOwnSubmission,
  findOwnSubmissions,
  findSubmissionsForAdmin,
  ownDocumentDownloadUrl,
  prepareUpload,
  submitDraft,
  updateDraft,
  withdrawSubmission,
} from "@/lib/submissions";
import type { SubmissionDetails } from "@/lib/submissions/schema";
import { dbAvailable, purgeUsers, testEmail } from "@/lib/test/db";
import { SYSTEM_ACTOR, transition } from "@/lib/workflow/state-machine";

/**
 * Submissions end to end against the real database and the real object
 * store: the atomic status change, the reference counter and the signed
 * upload are all things a mock would only pretend to do.
 */

const storageAvailable: boolean = dbAvailable
  ? await storage()
      .head("connectivity-check")
      .then(
        () => true,
        () => {
          console.warn("\n⚠ Object storage is not reachable — upload tests are being SKIPPED.\n");
          return false;
        },
      )
  : false;

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const REVIEWER_NAME = "Zebediah Quillfeather";

const createdUserIds: string[] = [];
const uploadedKeys: string[] = [];

async function createUser(role: Role = "USER", name = "Test Author"): Promise<SessionUser> {
  const user = await db.user.create({
    data: { email: testEmail(role.toLowerCase()), name, role },
    select: { id: true, email: true, name: true, role: true, status: true },
  });
  createdUserIds.push(user.id);
  return user;
}

const documentTypeId = dbAvailable
  ? (await db.documentType.findFirstOrThrow({ where: { slug: "personal-statement" } })).id
  : "";

function details(overrides: Partial<SubmissionDetails> = {}): SubmissionDetails {
  return {
    title: "Personal statement for MSc Transport Planning",
    documentTypeId,
    purpose: "UCL application",
    description: null,
    instructions: "4,000 characters maximum.",
    focusAreas: "The opening paragraph.",
    deadline: new Date(Date.now() + 7 * 86_400_000),
    ...overrides,
  };
}

async function draftFor(author: SessionUser): Promise<string> {
  const result = await createDraft(author, details());
  if (!result.ok) throw new Error("draft failed");
  return result.id;
}

/** Runs the real two-step upload: signed URL, PUT from "the browser", confirm. */
async function upload(
  author: SessionUser,
  submissionId: string,
  content: Uint8Array = PDF,
  file = { filename: "My Statement.pdf", mimeType: "application/pdf" },
) {
  const prepared = await prepareUpload(author.id, submissionId, {
    ...file,
    sizeBytes: content.length,
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.reason}`);
  uploadedKeys.push(prepared.key);

  const put = await fetch(prepared.url, {
    method: "PUT",
    headers: { "Content-Type": prepared.mimeType },
    body: new Blob([new Uint8Array(content)]),
  });
  if (!put.ok) throw new Error(`PUT failed: ${put.status} ${await put.text()}`);

  return {
    key: prepared.key,
    result: await confirmUpload(author, submissionId, prepared.key, file.filename),
  };
}

afterAll(async () => {
  if (!dbAvailable) return;
  await purgeUsers(createdUserIds);
  if (storageAvailable) await Promise.allSettled(uploadedKeys.map((key) => storage().delete(key)));
});

describe.skipIf(!dbAvailable)("reference numbers", () => {
  it("are formatted RF-<year>-<4 digits> and never repeat under concurrency", async () => {
    const references = await Promise.all(
      Array.from({ length: 15 }, () => db.$transaction((tx) => allocateReference(tx))),
    );

    expect(new Set(references).size).toBe(15);
    for (const reference of references) {
      expect(reference).toMatch(new RegExp(`^RF-${new Date().getUTCFullYear()}-\\d{4,}$`));
    }
  });

  it("count separately for each year", async () => {
    // A year nothing else uses, so the count is known.
    const year = 2990 + Math.floor(Math.random() * 9);
    await db.referenceCounter.deleteMany({ where: { year } });
    const now = new Date(Date.UTC(year, 5, 1));

    const first = await db.$transaction((tx) => allocateReference(tx, now));
    const second = await db.$transaction((tx) => allocateReference(tx, now));

    expect([first, second]).toEqual([`RF-${year}-0001`, `RF-${year}-0002`]);
    await db.referenceCounter.deleteMany({ where: { year } });
  });
});

describe.skipIf(!dbAvailable)("drafts", () => {
  it("creates a private draft with a reference and the default author visibility", async () => {
    const author = await createUser();

    const id = await draftFor(author);

    const stored = await db.submission.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ status: "DRAFT", authorId: author.id, submittedAt: null });
    expect(stored.reference).toMatch(/^RF-\d{4}-\d{4,}$/);
    expect(typeof stored.authorVisibleToReviewer).toBe("boolean");
    // Drafts are nobody's business but the author's.
    expect((await findSubmissionsForAdmin()).some((s) => s.id === id)).toBe(false);
  });

  it("refuses a document type that does not exist", async () => {
    const author = await createUser();

    const result = await createDraft(
      author,
      details({ documentTypeId: "00000000-0000-7000-8000-000000000000" }),
    );

    expect(result).toEqual({ ok: false, reason: "unknown_document_type" });
  });

  it("lets the author edit a draft, and nobody else", async () => {
    const author = await createUser();
    const stranger = await createUser();
    const id = await draftFor(author);

    expect(await updateDraft(stranger.id, id, details({ title: "Hijacked" }))).toEqual({
      ok: false,
      reason: "not_editable",
    });
    expect(await updateDraft(author.id, id, details({ title: "A better title" }))).toEqual({
      ok: true,
    });

    expect((await findOwnSubmission(author.id, id))?.title).toBe("A better title");
  });

  it("keeps each author's submissions invisible to every other author", async () => {
    const author = await createUser();
    const stranger = await createUser();
    const id = await draftFor(author);

    expect(await findOwnSubmission(stranger.id, id)).toBeNull();
    expect(await findOwnSubmissions(stranger.id)).toEqual([]);
    expect((await findOwnSubmissions(author.id)).map((s) => s.id)).toEqual([id]);
  });
});

describe.skipIf(!storageAvailable)("uploading the document", () => {
  it("uploads through a signed URL and records size, type and checksum", async () => {
    const author = await createUser();
    const id = await draftFor(author);

    const { key, result } = await upload(author, id);

    expect(result).toEqual({ ok: true });
    const file = await db.storedFile.findFirstOrThrow({ where: { submissionId: id } });
    expect(file).toMatchObject({
      kind: "ORIGINAL",
      storageKey: key,
      originalFilename: "My Statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF.length,
      uploadedById: author.id,
    });
    expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
    // The object key is ours; the author's filename never reaches storage.
    expect(key).not.toContain("Statement");
  });

  it("downloads back byte for byte, as an attachment under the original name", async () => {
    const author = await createUser();
    const id = await draftFor(author);
    await upload(author, id);

    const url = await ownDocumentDownloadUrl(author.id, id);
    const response = await fetch(url!);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="My Statement\.pdf"/,
    );
  });

  it("gives no download link to anyone but the author", async () => {
    const author = await createUser();
    const stranger = await createUser();
    const id = await draftFor(author);
    await upload(author, id);

    expect(await ownDocumentDownloadUrl(stranger.id, id)).toBeNull();
  });

  it("refuses to issue an upload URL for an unsupported or oversized file", async () => {
    const author = await createUser();
    const id = await draftFor(author);

    expect(
      await prepareUpload(author.id, id, {
        filename: "virus.exe",
        mimeType: "application/x-msdownload",
        sizeBytes: 10,
      }),
    ).toEqual({ ok: false, reason: "unsupported_type" });
    expect(
      await prepareUpload(author.id, id, {
        filename: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: 500 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("will not let the signed URL be used for a bigger file than was declared", async () => {
    const author = await createUser();
    const id = await draftFor(author);
    const prepared = await prepareUpload(author.id, id, {
      filename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: PDF.length,
    });
    if (!prepared.ok) throw new Error("prepare failed");
    uploadedKeys.push(prepared.key);

    const bigger = new Uint8Array(PDF.length + 5000);
    bigger.set(PDF);
    const put = await fetch(prepared.url, {
      method: "PUT",
      headers: { "Content-Type": prepared.mimeType },
      body: new Blob([bigger]),
    });

    expect(put.ok).toBe(false);
  });

  it("rejects and deletes a file whose bytes are not what its name claims", async () => {
    const author = await createUser();
    const id = await draftFor(author);
    const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

    const { key, result } = await upload(author, id, html);

    expect(result).toEqual({ ok: false, reason: "content_mismatch" });
    expect(await db.storedFile.count({ where: { submissionId: id } })).toBe(0);
    expect(await storage().head(key)).toBeNull();
  });

  it("will not attach an object that belongs to a different submission", async () => {
    const author = await createUser();
    const thief = await createUser();
    const victimDraft = await draftFor(author);
    const thiefDraft = await draftFor(thief);
    const { key } = await upload(author, victimDraft);

    expect(await confirmUpload(thief, thiefDraft, key, "stolen.pdf")).toEqual({
      ok: false,
      reason: "not_uploaded",
    });
    expect(await confirmUpload(thief, victimDraft, key, "stolen.pdf")).toEqual({
      ok: false,
      reason: "not_editable",
    });
  });

  it("replaces the document on a second upload and removes the old object", async () => {
    const author = await createUser();
    const id = await draftFor(author);
    const first = await upload(author, id);

    const second = await upload(author, id, PDF, {
      filename: "Second draft.pdf",
      mimeType: "application/pdf",
    });

    const files = await db.storedFile.findMany({ where: { submissionId: id } });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      storageKey: second.key,
      originalFilename: "Second draft.pdf",
    });
    expect(await storage().head(first.key)).toBeNull();
  });
});

describe.skipIf(!storageAvailable)("submitting", () => {
  it("will not submit a draft with no document", async () => {
    const author = await createUser();
    const id = await draftFor(author);

    expect(await submitDraft(author, id)).toEqual({ ok: false, reason: "no_document" });
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });

  it("moves to Pending Assignment, stamps the time, logs it and notifies author and admins", async () => {
    const author = await createUser();
    const admin = await createUser("ADMIN", "Test Admin");
    const id = await draftFor(author);
    await upload(author, id);

    expect(await submitDraft(author, id, "203.0.113.7")).toEqual({ ok: true });

    const stored = await db.submission.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe("PENDING_ASSIGNMENT");
    expect(stored.submittedAt).toBeInstanceOf(Date);

    const log = await db.activityLog.findFirstOrThrow({
      where: { entityId: id, action: "submission.submit" },
    });
    expect(log).toMatchObject({ actorId: author.id, actorRole: "USER", ip: "203.0.113.7" });
    expect(log.metadata).toMatchObject({ from: "DRAFT", to: "PENDING_ASSIGNMENT" });

    const notifications = await db.notification.findMany({ where: { submissionId: id } });
    expect(notifications.find((n) => n.userId === author.id)?.type).toBe("SUBMISSION_RECEIVED");
    expect(notifications.find((n) => n.userId === admin.id)?.type).toBe("SUBMISSION_CREATED");

    // This is the Phase 4 exit criterion: the admin now sees it.
    const pending = await findSubmissionsForAdmin(["PENDING_ASSIGNMENT"]);
    expect(pending.map((s) => s.id)).toContain(id);
  });

  it("lets only one of two simultaneous submits succeed", async () => {
    const author = await createUser();
    const id = await draftFor(author);
    await upload(author, id);

    const results = await Promise.all([submitDraft(author, id), submitDraft(author, id)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await db.activityLog.count({ where: { entityId: id, action: "submission.submit" } }),
    ).toBe(1);
  });

  it("freezes the details and the document once submitted", async () => {
    const author = await createUser();
    const id = await draftFor(author);
    await upload(author, id);
    await submitDraft(author, id);

    expect(await updateDraft(author.id, id, details({ title: "Changed my mind" }))).toEqual({
      ok: false,
      reason: "not_editable",
    });
    expect(
      await prepareUpload(author.id, id, {
        filename: "new.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    ).toEqual({ ok: false, reason: "not_editable" });
  });

  it("will not let someone else submit or withdraw it", async () => {
    const author = await createUser();
    const stranger = await createUser();
    const id = await draftFor(author);
    await upload(author, id);

    expect(await submitDraft(stranger, id)).toMatchObject({ ok: false });
    expect(await withdrawSubmission(stranger, id)).toEqual({ ok: false, reason: "not_yours" });
    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
  });
});

describe.skipIf(!dbAvailable)("withdrawing", () => {
  it("cancels a draft and keeps the record", async () => {
    const author = await createUser();
    const id = await draftFor(author);

    expect(await withdrawSubmission(author, id)).toEqual({ ok: true });

    const stored = await db.submission.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe("CANCELLED");
    expect(stored.cancelledAt).toBeInstanceOf(Date);
  });

  it("cannot be done twice, and nothing leaves a cancelled submission", async () => {
    const author = await createUser();
    const admin = await createUser("ADMIN");
    const id = await draftFor(author);
    await withdrawSubmission(author, id);

    expect(await withdrawSubmission(author, id)).toEqual({
      ok: false,
      reason: "illegal_from_this_status",
    });
    expect(await transition({ submissionId: id, event: "assign", actor: admin })).toMatchObject({
      ok: false,
    });
  });
});

describe.skipIf(!dbAvailable)("the state machine", () => {
  it("refuses a move the actor's role may not make, changing nothing", async () => {
    const author = await createUser();
    const admin = await createUser("ADMIN");
    const id = await draftFor(author);

    expect(await transition({ submissionId: id, event: "submit", actor: admin })).toEqual({
      ok: false,
      reason: "role_not_allowed",
    });
    expect(await transition({ submissionId: id, event: "deliver", actor: SYSTEM_ACTOR })).toEqual({
      ok: false,
      reason: "illegal_from_this_status",
    });
    expect(
      await db.activityLog.count({
        where: { entityId: id, action: { startsWith: "submission.s" } },
      }),
    ).toBe(0);
  });

  it("only lets the reviewer who holds the assignment act on it", async () => {
    const author = await createUser();
    const admin = await createUser("ADMIN");
    const assigned = await createUser("REVIEWER", REVIEWER_NAME);
    const other = await createUser("REVIEWER", "Other Reviewer");
    const id = await draftFor(author);
    await db.storedFile.create({
      data: {
        submissionId: id,
        kind: "ORIGINAL",
        storageKey: `test/${id}`,
        originalFilename: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        checksum: "0".repeat(64),
        uploadedById: author.id,
      },
    });
    await submitDraft(author, id);
    await transition({
      submissionId: id,
      event: "assign",
      actor: admin,
      apply: async (tx) => {
        await tx.assignment.create({
          data: {
            submissionId: id,
            reviewerId: assigned.id,
            assignedById: admin.id,
            isActive: true,
          },
        });
      },
    });

    expect(await transition({ submissionId: id, event: "accept", actor: other })).toEqual({
      ok: false,
      reason: "not_yours",
    });
    expect(await transition({ submissionId: id, event: "accept", actor: assigned })).toMatchObject({
      ok: true,
      to: "ACCEPTED",
    });
  });

  it("rolls the status back if the accompanying write fails", async () => {
    const author = await createUser();
    const id = await draftFor(author);

    await expect(
      transition({
        submissionId: id,
        event: "cancel",
        actor: author,
        apply: async () => {
          throw new Error("accompanying write failed");
        },
      }),
    ).rejects.toThrow("accompanying write failed");

    expect((await db.submission.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    expect(
      await db.activityLog.count({ where: { entityId: id, action: "submission.cancel" } }),
    ).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("anonymity: what the author is given", () => {
  /** A submission with a reviewer assigned, fetched the way the author's pages do. */
  async function assignedSubmission() {
    const author = await createUser();
    const admin = await createUser("ADMIN", "Test Admin");
    const reviewer = await createUser("REVIEWER", REVIEWER_NAME);
    const id = await draftFor(author);
    await db.storedFile.create({
      data: {
        submissionId: id,
        kind: "ORIGINAL",
        storageKey: `test/${id}`,
        originalFilename: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        checksum: "0".repeat(64),
        uploadedById: author.id,
      },
    });
    await submitDraft(author, id);
    await transition({
      submissionId: id,
      event: "assign",
      actor: admin,
      apply: async (tx) => {
        await tx.assignment.create({
          data: {
            submissionId: id,
            reviewerId: reviewer.id,
            assignedById: admin.id,
            isActive: true,
          },
        });
      },
    });
    return { author, reviewer, id };
  }

  it("contains the reviewer's name, email and id nowhere in the author's DTO", async () => {
    const { author, reviewer, id } = await assignedSubmission();

    const dto = toUserSubmissionDTO((await findOwnSubmission(author.id, id))!);
    const serialised = JSON.stringify(dto);

    expect(serialised).not.toContain(REVIEWER_NAME);
    expect(serialised).not.toContain(reviewer.email);
    expect(serialised).not.toContain(reviewer.id);
    expect(dto.stage).toBe("with_reviewer");
  });

  it("has exactly the fields it is meant to — a new one must be a deliberate decision", async () => {
    const { author, id } = await assignedSubmission();

    const dto = toUserSubmissionDTO((await findOwnSubmission(author.id, id))!);

    expect(Object.keys(dto).sort()).toEqual(
      [
        "canEdit",
        "canSubmit",
        "canWithdraw",
        "createdAt",
        "deadline",
        "description",
        "document",
        "documentType",
        "focusAreas",
        "id",
        "instructions",
        "purpose",
        "reference",
        "stage",
        "submittedAt",
        "title",
        "updatedAt",
      ].sort(),
    );
  });

  it("says nothing identifying in the notifications the author receives", async () => {
    const { author, reviewer, id } = await assignedSubmission();

    const notifications = await db.notification.findMany({
      where: { submissionId: id, userId: author.id },
    });

    expect(notifications.length).toBeGreaterThan(0);
    const text = JSON.stringify(notifications);
    expect(text).not.toContain(REVIEWER_NAME);
    expect(text).not.toContain(reviewer.email);
    expect(text).not.toContain(reviewer.id);
  });

  it("shows the admin the author, with the real status", async () => {
    const { author, id } = await assignedSubmission();

    const record = (await findSubmissionsForAdmin(["ASSIGNED"])).find((s) => s.id === id)!;
    const dto = toAdminSubmissionDTO(record);

    expect(dto).toMatchObject({
      status: "ASSIGNED",
      author: { id: author.id, name: "Test Author" },
    });
  });
});
