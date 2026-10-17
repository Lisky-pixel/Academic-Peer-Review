import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { Message } from "@/lib/notifications/messages";

/**
 * Notifications: the in-app bell and the email that accompanies it.
 *
 * `queueNotices` is called inside the transaction of the event being
 * announced. It writes the Notification rows and the QUEUED EmailLog rows
 * together, so a person is told about something if and only if it happened.
 * Nothing is sent here — see lib/email/outbox.ts.
 */

export type Notice = { userId: string; submissionId?: string | null; message: Message };

export async function queueNotices(tx: Prisma.TransactionClient, notices: Notice[]): Promise<void> {
  if (notices.length === 0) return;

  // Only people who can still sign in are told anything.
  const recipients = await tx.user.findMany({
    where: { id: { in: notices.map((notice) => notice.userId) }, status: "ACTIVE" },
    select: { id: true, email: true },
  });
  const emailOf = new Map(recipients.map((user) => [user.id, user.email]));
  const deliverable = notices.filter((notice) => emailOf.has(notice.userId));
  if (deliverable.length === 0) return;

  await tx.notification.createMany({
    data: deliverable.map(({ userId, submissionId, message }) => ({
      userId,
      submissionId: submissionId ?? null,
      type: message.type,
      title: message.title,
      body: message.body,
      linkUrl: message.linkPath,
    })),
  });

  await tx.emailLog.createMany({
    data: deliverable.map(({ userId, submissionId, message }) => ({
      toEmail: emailOf.get(userId)!,
      template: message.type,
      subject: message.email.subject,
      submissionId: submissionId ?? null,
      status: "QUEUED" as const,
      payload: message.email.content,
    })),
  });
}

/**
 * Who is told about a conference's papers: its organisers who can sign in.
 * A conference with none (not yet staffed) falls back to the administrators,
 * so nothing goes unheard.
 */
export async function findOrganiserIds(
  tx: Prisma.TransactionClient,
  conferenceId: string,
): Promise<string[]> {
  const organisers = await tx.conferenceOrganiser.findMany({
    where: { conferenceId, user: { status: "ACTIVE" } },
    select: { userId: true },
  });
  if (organisers.length > 0) return organisers.map((row) => row.userId);

  const admins = await tx.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

// ── The bell ───────────────────────────────────────────────────────────────

const BELL_LIMIT = 15;

export async function findBellNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: BELL_LIMIT,
      select: { id: true, title: true, body: true, linkUrl: true, readAt: true, createdAt: true },
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export type BellRecord = Awaited<ReturnType<typeof findBellNotifications>>;

/**
 * Marks one of the person's own notifications as read and returns where it
 * leads. The user id is part of the WHERE, so nobody can mark — or learn the
 * target of — a notification that is not theirs.
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<string | null> {
  const notification = await db.notification.findFirst({
    where: { id: notificationId, userId },
    select: { linkUrl: true, readAt: true },
  });
  if (!notification) return null;

  if (!notification.readAt) {
    await db.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
  return notification.linkUrl;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const { count } = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return count;
}
