import type { Role } from "@/lib/generated/prisma/client";

export type NavItem = { href: string; label: string; current?: boolean };

const NAV = {
  USER: [{ href: "/dashboard", label: "Submissions" }],
  REVIEWER: [{ href: "/reviewer", label: "Queue" }],
  ADMIN: [
    { href: "/admin", label: "Submissions" },
    { href: "/admin/invites", label: "Invitations" },
  ],
} as const satisfies Record<Role, readonly NavItem[]>;

/** The header links for a role, with the page being viewed marked current. */
export function navFor(role: Role, current?: string): NavItem[] {
  return NAV[role].map((item) => ({ ...item, current: item.href === current }));
}
