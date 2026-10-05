"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import { HOME_PATH, safeRedirectPath } from "@/lib/auth/routes";
import { isUuid } from "@/lib/format";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";

/**
 * Opens one of the signed-in person's notifications: marks it read and goes
 * where it points. The destination is read from the database for this user,
 * not taken from the browser.
 */
export async function openNotificationAction(notificationId: string): Promise<void> {
  const user = await requireUser();
  const home = HOME_PATH[user.role];
  if (!isUuid(notificationId)) redirect(home);

  const link = await markNotificationRead(user.id, notificationId);
  revalidatePath("/", "layout");
  redirect(safeRedirectPath(link, home));
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllNotificationsRead(user.id);
  revalidatePath("/", "layout");
}
