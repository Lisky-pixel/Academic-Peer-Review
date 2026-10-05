import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {children}
    </Link>
  );
}
