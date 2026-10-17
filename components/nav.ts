import type { Role } from "@/lib/generated/prisma/client";

export type NavItem = { href: string; label: string; current?: boolean };

const NAV = {
  USER: [
    { href: "/dashboard", label: "My papers" },
    { href: "/help", label: "Help" },
  ],
  // Reviewers can submit papers of their own as well.
  REVIEWER: [
    { href: "/reviewer", label: "Reviews" },
    { href: "/dashboard", label: "My papers" },
    { href: "/help", label: "Help" },
  ],
  ORGANISER: [
    { href: "/organiser", label: "Conferences" },
    { href: "/organiser/reviewers", label: "Reviewers" },
    { href: "/help", label: "Help" },
  ],
  ADMIN: [
    { href: "/admin", label: "Conferences" },
    { href: "/admin/users", label: "People" },
    { href: "/admin/invites", label: "Invitations" },
    { href: "/admin/activity", label: "Activity" },
  ],
} as const satisfies Record<Role, readonly NavItem[]>;

/** The header links for a role, with the page being viewed marked current. */
export function navFor(role: Role, current?: string): NavItem[] {
  return NAV[role].map((item) => ({ ...item, current: item.href === current }));
}
