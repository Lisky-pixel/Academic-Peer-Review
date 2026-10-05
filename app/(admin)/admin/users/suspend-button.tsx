"use client";

import { useActionState } from "react";
import { suspendUserAction } from "@/app/(admin)/admin/users/actions";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

/**
 * Suspending ends someone's access immediately, so it takes two clicks: one
 * to reveal the button, one to press it.
 */
export function SuspendButton({
  userId,
  name,
  openReviews,
}: {
  userId: string;
  name: string;
  openReviews: number;
}) {
  const [state, action, pending] = useActionState(suspendUserAction, INITIAL);

  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        Suspend
      </summary>
      <form
        action={action}
        className="border-border bg-card mt-3 max-w-xs space-y-3 rounded-xl border p-4 text-left"
      >
        <input type="hidden" name="userId" value={userId} />
        <p className="text-muted-foreground leading-relaxed">
          {name} will be signed out everywhere and unable to sign in.
          {openReviews > 0 &&
            ` They hold ${openReviews} review${openReviews === 1 ? "" : "s"} in progress, which you will need to reassign.`}
        </p>
        {state.error && <p className="text-destructive">{state.error}</p>}
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? "Suspending…" : `Suspend ${name}`}
        </Button>
      </form>
    </details>
  );
}
