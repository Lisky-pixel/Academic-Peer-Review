import Link from "next/link";
import { Brand } from "@/components/brand";
import { navFor } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { HOME_PATH } from "@/lib/auth/routes";
import type { SessionUser } from "@/lib/auth/session";
import { getOwnAvatarUrl } from "@/lib/profile";

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
  children?: React.ReactNode;
}) {
  const nav = navFor(user.role, current);
  const avatarUrl = await getOwnAvatarUrl(user.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-panel text-panel-foreground border-border sticky top-0 z-40 border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-8">
            <Brand href={HOME_PATH[user.role]} onPanel />
            <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
              {nav.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <UserMenu
              name={user.name}
              email={user.email}
              roleLabel={ROLE_LABEL[user.role]}
              avatarUrl={avatarUrl}
            />
          </div>
        </div>

        {/* On a phone the links move to their own row and scroll sideways. */}
        <nav
          aria-label="Main"
          className="border-panel-foreground/10 flex gap-1 overflow-x-auto border-t px-3 py-2 text-sm md:hidden"
        >
          {nav.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
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

/** A dashed panel for a part of the product that is not built yet. */
export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-border rounded-2xl border border-dashed px-6 py-14 text-center">
      <p className="font-heading text-xl font-medium">{title}</p>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed text-pretty">
        {children}
      </p>
    </div>
  );
}
