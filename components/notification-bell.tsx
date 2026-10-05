"use client";

import { Bell } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useTransition } from "react";
import { markAllReadAction, openNotificationAction } from "@/app/(account)/notifications/actions";
import type { BellDTO } from "@/lib/dto/notification";
import { cn } from "@/lib/utils";

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
function timeAgo(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * The bell in the header: a count of unread notifications and, when opened,
 * the most recent ones. It shows what was true when the page loaded; it
 * updates on navigation, not live.
 */
export function NotificationBell({ bell }: { bell: BellDTO }) {
  const [pending, startTransition] = useTransition();
  const { unread, items } = bell;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="focus-visible:ring-panel-mark/60 hover:bg-panel-foreground/10 data-[state=open]:bg-panel-foreground/10 relative flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-3"
      >
        <Bell aria-hidden className="size-[18px]" strokeWidth={1.75} />
        {unread > 0 && (
          <span
            aria-hidden
            className="bg-panel-mark text-panel absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] leading-none font-bold tabular-nums"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="bg-popover text-popover-foreground border-border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 flex max-h-[min(32rem,80vh)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border shadow-lg"
        >
          <div className="border-border flex items-center justify-between gap-4 border-b px-4 py-3">
            <p className="text-sm font-medium">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => markAllReadAction())}
                className="text-mark cursor-pointer text-xs font-medium underline-offset-4 hover:underline disabled:opacity-50"
              >
                Mark all as read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-muted-foreground px-4 py-10 text-center text-sm">
              Nothing yet. Updates about your documents will appear here.
            </p>
          ) : (
            <div className="overflow-y-auto p-1.5">
              {items.map((item) => (
                <DropdownMenu.Item
                  key={item.id}
                  onSelect={() => void openNotificationAction(item.id)}
                  className="data-highlighted:bg-accent flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2.5 outline-none select-none"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      item.read ? "bg-transparent" : "bg-mark",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn("block text-sm", item.read ? "font-normal" : "font-medium")}
                    >
                      {item.title}
                      {!item.read && <span className="sr-only"> (unread)</span>}
                    </span>
                    {item.body && (
                      <span className="text-muted-foreground mt-0.5 block text-sm leading-snug">
                        {item.body}
                      </span>
                    )}
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {timeAgo(item.createdAt)}
                    </span>
                  </span>
                </DropdownMenu.Item>
              ))}
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
