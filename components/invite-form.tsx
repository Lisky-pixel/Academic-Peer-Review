"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

const ROLE_LABEL = {
  REVIEWER: "Reviewer",
  ORGANISER: "Conference organiser",
  ADMIN: "Administrator",
} as const;

/**
 * Invites someone by email. Administrators choose any role; organisers only
 * ever invite reviewers, so for them the role is fixed and not shown.
 */
export function InviteForm({
  send,
  roles,
}: {
  send: (state: FormState, formData: FormData) => Promise<FormState>;
  roles: Array<keyof typeof ROLE_LABEL>;
}) {
  const [state, action, pending] = useActionState(send, INITIAL);
  // After a successful send the fields start empty again, ready for the next.
  const values = state.success ? {} : (state.values ?? {});

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2.5 text-sm"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          role="status"
          className="border-success/30 bg-success/10 text-success rounded-lg border px-3 py-2.5 text-sm"
        >
          Invitation sent to {state.values?.email}.
        </p>
      )}

      <div
        className={
          roles.length > 1
            ? "grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[1fr_1fr_auto]"
            : "grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2"
        }
      >
        <div className="space-y-2">
          <Label htmlFor="invite-name">Name</Label>
          <Input
            id="invite-name"
            name="name"
            defaultValue={values.name}
            aria-invalid={state.fieldErrors?.name ? true : undefined}
            required
          />
          {state.fieldErrors?.name && (
            <p className="text-destructive text-sm">{state.fieldErrors.name.join(" ")}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            defaultValue={values.email}
            aria-invalid={state.fieldErrors?.email ? true : undefined}
            required
          />
          {state.fieldErrors?.email && (
            <p className="text-destructive text-sm">{state.fieldErrors.email.join(" ")}</p>
          )}
        </div>

        {roles.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <select
              id="invite-role"
              name="role"
              defaultValue={values.role ?? roles[0]}
              className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/30 h-10 w-full rounded-lg border px-3 text-sm shadow-xs outline-none focus-visible:ring-3"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="role" value={roles[0]} />
        )}
      </div>

      <Button type="submit" size="lg" className="h-10 px-4 text-sm" disabled={pending}>
        {pending ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}
