"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shown when a page throws while rendering. The visitor gets a plain
 * explanation and a way forward; the detail goes to the server log, where
 * `digest` identifies the same error. Nothing about what went wrong is put
 * on the screen — an error message can contain things a visitor should not
 * see.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <h1 className="font-heading text-3xl font-medium tracking-tight">
          Something went wrong on our side
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Nothing you entered has been lost from what was already saved. Try again; if it keeps
          happening, tell the administrator and quote the reference below.
        </p>
        {error.digest && (
          <p className="text-muted-foreground font-mono text-xs">Reference: {error.digest}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="lg" className="h-10 px-4 text-sm" onClick={() => reset()}>
          Try again
        </Button>
        <Button asChild variant="outline" size="lg" className="h-10 px-4 text-sm">
          {/* A full page load, not a client navigation: start clean. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/">Go to the start</a>
        </Button>
      </div>
    </main>
  );
}
