import Link from "next/link";
import { Brand } from "@/components/brand";
import { navFor } from "@/components/nav";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { HOME_PATH } from "@/lib/auth/routes";
import type { SessionUser } from "@/lib/auth/session";
import { toBellDTO } from "@/lib/dto/notification";
import { findBellNotifications } from "@/lib/notifications";
import { getOwnAvatarUrl } from "@/lib/profile";
import { cn } from "@/lib/utils";

const ROLE_LABEL = {
  USER: "Author",
  REVIEWER: "Reviewer",
  ADMIN: "Administrator",
} as const;

/**
 * The signed-in shell: the ink header — brand, the role's navigation, the
 * theme switch and the account menu — then the page.
 *
 * `current` is the path of the page being shown, used to mark its nav link.
 */
export async function RoleArea({
  user,
  title,
  description,
  eyebrow,
  actions,
  current,
  wide = false,
  children,
}: {
  user: SessionUser;
  title: string;
  description?: React.ReactNode;
  /** Small text above the title, e.g. a back link or a reference number. */
  eyebrow?: React.ReactNode;
  /** Buttons shown beside the title. */
  actions?: React.ReactNode;
  current?: string;
  /** A wider page, for side-by-side layouts such as the review workspace. */
  wide?: boolean;
  children?: React.ReactNode;
}) {
  const nav = navFor(user.role, current);
  // A few links fit beside the brand; more than that need a row of their own.
  const inline = nav.length <= 3;
  const [avatarUrl, bell] = await Promise.all([
    getOwnAvatarUrl(user.id),
    findBellNotifications(user.id).then(toBellDTO),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-panel text-panel-foreground border-border sticky top-0 z-40 border-b">
        <div
          className={cn(
            "mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6",
            wide ? "max-w-7xl" : "max-w-5xl",
          )}
        >
          <div className="flex min-w-0 items-center gap-8">
            <Brand href={HOME_PATH[user.role]} onPanel />
            {inline && (
              <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
                {nav.map((item) => (
                  <NavLink key={item.href} {...item} />
                ))}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <NotificationBell bell={bell} />
            <UserMenu
              name={user.name}
              email={user.email}
              roleLabel={ROLE_LABEL[user.role]}
              avatarUrl={avatarUrl}
            />
          </div>
        </div>

        {/* The links get their own row, which scrolls sideways if it must:
            always on a phone, and at every width when there are too many to
            sit beside the brand (the administrator's six). */}
        <div className={cn("border-panel-foreground/10 border-t", inline && "md:hidden")}>
          <nav
            aria-label="Main"
            className={cn(
              "mx-auto flex gap-1 overflow-x-auto px-3 py-2 text-sm sm:px-5",
              wide ? "max-w-7xl" : "max-w-5xl",
            )}
          >
            {nav.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full flex-1 px-4 py-10 sm:px-6 sm:py-14",
          wide ? "max-w-7xl" : "max-w-5xl",
        )}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="max-w-2xl min-w-0 space-y-2">
            {eyebrow && <div className="text-muted-foreground text-sm">{eyebrow}</div>}
            <h1 className="font-heading text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="text-muted-foreground leading-relaxed text-pretty">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        <div className="mt-10 space-y-10">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ href, label, current }: { href: string; label: string; current?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className="text-panel-muted hover:text-panel-foreground aria-[current=page]:text-panel-foreground aria-[current=page]:bg-panel-foreground/10 rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition-colors"
    >
      {label}
    </Link>
  );
}
