import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The wordmark. The short stroke under the name is a proofreader's underline
 * in the accent blue; `onPanel` switches it to the blue that reads on ink.
 */
export function Brand({
  href = "/",
  onPanel = false,
  className,
}: {
  href?: string;
  onPanel?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "font-heading inline-flex shrink-0 flex-col text-[15px] leading-none font-semibold tracking-tight whitespace-nowrap min-[400px]:text-base sm:text-xl",
        className,
      )}
    >
      Academic Peer Review
      <span
        aria-hidden
        className={cn("mt-1 h-0.5 w-6 rounded-full", onPanel ? "bg-panel-mark" : "bg-mark")}
      />
    </Link>
  );
}
