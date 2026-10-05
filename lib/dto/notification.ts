import type { BellRecord } from "@/lib/notifications";

/** One entry in the notification bell. */
export type NotificationDTO = {
  id: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
};

export type BellDTO = { unread: number; items: NotificationDTO[] };

/**
 * The link is deliberately not included: opening a notification goes through
 * a server action that looks the link up again for the signed-in person, so
 * the browser is never handed a URL to trust.
 */
export function toBellDTO(record: BellRecord): BellDTO {
  return {
    unread: record.unread,
    items: record.items.map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      read: item.readAt !== null,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}
