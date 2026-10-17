import { randomUUID } from "node:crypto";
import { cache } from "react";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import type { ReviewerProfileInput } from "@/lib/auth/schemas";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { avatarUrl } from "@/lib/dto/profile";
import { checkAvatar } from "@/lib/profile/avatar";
import { env } from "@/lib/env";
import {
  checkDeclaredFile,
  checkFileContent,
  extensionOf,
  type FileRejection,
} from "@/lib/files/validate";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";

/**
 * A person's own profile: what they are called, what they look like, and
 * their password. Every function takes the id of the signed-in user and acts
 * on that account only — there is no "edit someone else" path here.
 */

/** Guessing the current password from a stolen session is still guessing. */
const PASSWORD_ATTEMPT_RULE = { limit: 5, windowSeconds: 15 * 60 };

export function findProfile(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      bio: true,
      institution: true,
      reviewerProfile: {
        select: {
          academicRank: true,
          yearsExperience: true,
          expertise: true,
          cvFilename: true,
          cvSizeBytes: true,
          cvUploadedAt: true,
          disciplines: { select: { id: true, name: true } },
        },
      },
      avatarUpdatedAt: true,
      createdAt: true,
    },
  });
}

/**
 * The signed-in person's own picture URL, for the header. Cached per request,
 * since the header renders on every signed-in page.
 */
export const getOwnAvatarUrl = cache(async (userId: string): Promise<string | null> => {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { avatarUpdatedAt: true },
  });
  return avatarUrl(userId, row?.avatarUpdatedAt);
});

export type ProfileRecord = NonNullable<Awaited<ReturnType<typeof findProfile>>>;

export async function updateProfile(
  userId: string,
  input: { name: string; bio: string; institution: string },
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: {
      name: input.name.trim(),
      bio: input.bio.trim() || null,
      institution: input.institution.trim() || null,
    },
  });
}

// ── Reviewer profile ───────────────────────────────────────────────────────

/**
 * Saves what a reviewer brings to matching. A submitter saving one becomes a
 * reviewer as well — they keep their own papers, and the matching rules make
 * sure they are never given one of them.
 */
export async function saveReviewerProfile(
  user: SessionUser,
  input: ReviewerProfileInput,
): Promise<{ ok: true; becameReviewer: boolean } | { ok: false; reason: "not_allowed" }> {
  if (user.role !== "USER" && user.role !== "REVIEWER") return { ok: false, reason: "not_allowed" };

  return db.$transaction(async (tx) => {
    const disciplines = await tx.discipline.findMany({
      where: { id: { in: input.disciplineIds }, isActive: true },
      select: { id: true },
    });
    const profile = {
      academicRank: input.academicRank,
      yearsExperience: input.yearsExperience,
      expertise: input.expertise,
    };
    await tx.reviewerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...profile, disciplines: { connect: disciplines } },
      update: { ...profile, disciplines: { set: disciplines } },
    });

    const becameReviewer = user.role === "USER";
    if (becameReviewer) {
      await tx.user.update({ where: { id: user.id }, data: { role: "REVIEWER" } });
      await tx.activityLog.create({
        data: {
          action: "user.became_reviewer",
          entityType: "User",
          entityId: user.id,
          actorId: user.id,
          actorRole: user.role,
        },
      });
    }
    return { ok: true, becameReviewer } as const;
  });
}

const CV_KEY = /^cvs\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(pdf|docx)$/;

export async function prepareCvUpload(
  userId: string,
  file: { filename: string; mimeType: string; sizeBytes: number },
): Promise<
  | { ok: true; url: string; key: string; mimeType: string }
  | { ok: false; reason: FileRejection | "no_profile" }
> {
  const profile = await db.reviewerProfile.count({ where: { userId } });
  if (profile !== 1) return { ok: false, reason: "no_profile" };

  const check = checkDeclaredFile(file, env.MAX_UPLOAD_BYTES);
  if (!check.ok) return check;
  if (check.kind !== "pdf" && check.kind !== "docx")
    return { ok: false, reason: "unsupported_type" };

  const key = `cvs/${userId}/${randomUUID()}.${extensionOf(file.filename)}`;
  const url = await storage().presignUpload({
    key,
    contentType: check.mimeType,
    sizeBytes: file.sizeBytes,
  });
  return { ok: true, url, key, mimeType: check.mimeType };
}

export async function confirmCvUpload(
  userId: string,
  key: string,
  originalFilename: string,
): Promise<{ ok: true } | { ok: false; reason: FileRejection | "no_profile" | "not_uploaded" }> {
  const match = CV_KEY.exec(key);
  if (!match || match[1] !== userId) return { ok: false, reason: "not_uploaded" };
  const kind = match[2] as "pdf" | "docx";

  const previous = await db.reviewerProfile.findUnique({
    where: { userId },
    select: { cvStorageKey: true },
  });
  if (!previous) return { ok: false, reason: "no_profile" };

  const info = await storage().head(key);
  if (!info) return { ok: false, reason: "not_uploaded" };
  const bytes = await storage().read(key);
  const content = checkFileContent(kind, bytes, env.MAX_UPLOAD_BYTES);
  if (!content.ok) {
    await storage().delete(key);
    return content;
  }

  await db.reviewerProfile.update({
    where: { userId },
    data: {
      cvStorageKey: key,
      cvFilename: originalFilename.slice(0, 255),
      cvSizeBytes: bytes.length,
      cvUploadedAt: new Date(),
    },
  });
  if (previous.cvStorageKey && previous.cvStorageKey !== key) {
    await storage()
      .delete(previous.cvStorageKey)
      .catch(() => undefined);
  }
  return { ok: true };
}

/**
 * A download link for a reviewer's CV: for the reviewer themselves, an
 * administrator, or an organiser (who need it to judge who reviews their
 * papers).
 */
export async function cvDownloadUrl(viewer: SessionUser, userId: string): Promise<string | null> {
  if (viewer.id !== userId && viewer.role !== "ADMIN" && viewer.role !== "ORGANISER") return null;
  const profile = await db.reviewerProfile.findUnique({
    where: { userId },
    select: { cvStorageKey: true, cvFilename: true },
  });
  if (!profile?.cvStorageKey || !profile.cvFilename) return null;
  return storage().presignDownload({ key: profile.cvStorageKey, filename: profile.cvFilename });
}

export type SetAvatarResult =
  { ok: true } | { ok: false; reason: "empty" | "too_large" | "not_an_image" };

export async function setAvatar(userId: string, bytes: Uint8Array): Promise<SetAvatarResult> {
  const check = checkAvatar(bytes);
  if (!check.ok) return check;

  await db.user.update({
    where: { id: userId },
    data: {
      // Copied into a fresh buffer: Prisma wants an ArrayBuffer-backed array,
      // and what arrives from a form upload may be a view onto a larger one.
      avatar: new Uint8Array(bytes),
      avatarMime: check.mime,
      avatarUpdatedAt: new Date(),
    },
  });
  return { ok: true };
}

export async function removeAvatar(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { avatar: null, avatarMime: null, avatarUpdatedAt: null },
  });
}

/** The picture itself, for the access-checked route that serves it. */
export async function findAvatar(userId: string) {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { avatar: true, avatarMime: true },
  });
  if (!row?.avatar || !row.avatarMime) return null;
  return { bytes: row.avatar, mime: row.avatarMime };
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "wrong_password" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Changes the password, given the current one.
 *
 * Every other session is revoked — the usual reason to change a password is
 * the suspicion that someone else has it — but the session making the change
 * is kept, so the person is not thrown out of the page they are on.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId: string,
): Promise<ChangePasswordResult> {
  const key = rateLimitKey("password-change", userId);
  const limit = await rateLimiter.consume(key, PASSWORD_ATTEMPT_RULE);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, role: true },
  });
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, reason: "wrong_password" };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId, id: { not: keepSessionId } } }),
    db.activityLog.create({
      data: {
        action: "auth.password_changed",
        entityType: "User",
        entityId: userId,
        actorId: userId,
        actorRole: user.role,
      },
    }),
  ]);
  await rateLimiter.reset(key);

  return { ok: true };
}
