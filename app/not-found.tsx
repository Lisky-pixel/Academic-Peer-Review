import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

/**
 * Shown for any address that does not exist — and, on purpose, for any
 * record the visitor is not allowed to see. The two look identical so that
 * trying ids cannot reveal which ones are real.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-16">
      <Brand />
      <div className="space-y-3">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          We could not find that page
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          The address may be mistyped, or it may point to something you do not have access to.
        </p>
      </div>
      <div>
        <Button asChild size="lg" className="h-10 px-4 text-sm">
          <Link href="/">Go to the start</Link>
        </Button>
      </div>
    </main>
  );
}
