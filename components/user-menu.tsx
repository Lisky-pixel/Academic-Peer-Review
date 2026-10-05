"use client";

import { ChevronDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { DropdownMenu } from "radix-ui";
import { logoutAction } from "@/app/(auth)/actions";
import { UserAvatar } from "@/components/user-avatar";

const ITEM =
  "data-highlighted:bg-accent data-highlighted:text-accent-foreground flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none select-none";

/** The avatar button in the header, opening the profile link and sign out. */
export function UserMenu({
  name,
  email,
  roleLabel,
  avatarUrl,
}: {
  name: string;
  email: string;
  roleLabel: string;
  avatarUrl: string | null;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Account menu"
        className="focus-visible:ring-panel-mark/60 hover:bg-panel-foreground/10 data-[state=open]:bg-panel-foreground/10 flex cursor-pointer items-center gap-2.5 rounded-full py-1 pr-2 pl-1 transition-colors outline-none focus-visible:ring-3"
      >
        <UserAvatar
          name={name}
          url={avatarUrl}
          className="bg-panel-foreground/15 text-panel-foreground size-8 text-xs"
        />
        <span className="hidden text-left text-sm leading-tight sm:block">
          <span className="block max-w-40 truncate font-medium">{name}</span>
          <span className="text-panel-muted block text-xs">{roleLabel}</span>
        </span>
        <ChevronDown aria-hidden className="text-panel-muted size-4" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="bg-popover text-popover-foreground border-border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 w-60 rounded-xl border p-1.5 shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-muted-foreground truncate text-xs">{email}</p>
          </div>
          <DropdownMenu.Separator className="bg-border -mx-1.5 my-1.5 h-px" />
          <DropdownMenu.Item asChild className={ITEM}>
            <Link href="/profile">
              <UserRound aria-hidden className="text-muted-foreground size-4" />
              Your profile
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={() => void logoutAction()}>
            <LogOut aria-hidden className="text-muted-foreground size-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
