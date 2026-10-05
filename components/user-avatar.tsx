import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A profile picture, or the person's initials when they have not set one.
 * Size comes from the caller's `className` (e.g. "size-8 text-xs").
 */
export function UserAvatar({
  name,
  url,
  className,
}: {
  name: string;
  url: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "bg-secondary text-secondary-foreground inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold select-none",
        className,
      )}
    >
      {url ? (
        // A plain <img>: the picture comes from an access-checked route and is
        // already 256px, so the image optimiser has nothing to add.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}
