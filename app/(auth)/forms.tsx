"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  acceptInviteAction,
  forgotPasswordAction,
  loginAction,
  registerAction,
  resetPasswordAction,
  verifyEmailAction,
} from "@/app/(auth)/actions";
import { Field, FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";

const INITIAL: FormState = {};

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" size="lg" className="h-10 w-full text-sm" disabled={pending}>
      {pending ? "Please wait…" : children}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field name="email" label="Email" type="email" autoComplete="email" state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        state={state}
      />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-mark font-medium underline-offset-4 hover:underline"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, INITIAL);

  if (state.success) {
    return (
      <div
        role="status"
        className="border-border bg-card space-y-2 rounded-xl border p-5 text-sm leading-relaxed"
      >
        <p>
          We have sent an email to <span className="font-medium">{state.values?.email}</span>. Open
          the link in it to finish creating your account.
        </p>
        <p className="text-muted-foreground">
          It expires in 24 hours. If nothing arrives, check your spam folder or sign up again.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <Field name="name" label="Full name" autoComplete="name" state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" state={state} />
      <NewPasswordFields state={state} />
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, INITIAL);

  if (state.success) {
    return (
      <p
        role="status"
        className="border-border bg-card rounded-xl border p-5 text-sm leading-relaxed"
      >
        If an account exists for that address, a reset link is on its way. It expires in one hour.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" state={state} />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(verifyEmailAction, INITIAL);

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <input type="hidden" name="token" value={token} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        state={state}
      />
      <SubmitButton pending={pending}>Confirm and sign in</SubmitButton>
    </form>
  );
}

/** Shared by password reset and invite acceptance: both end in "choose a password". */
export function SetPasswordForm({
  token,
  purpose,
}: {
  token: string;
  purpose: "reset" | "invite";
}) {
  const [state, action, pending] = useActionState(
    purpose === "reset" ? resetPasswordAction : acceptInviteAction,
    INITIAL,
  );

  return (
    <form action={action} className="space-y-5">
      <FormError state={state} />
      <input type="hidden" name="token" value={token} />
      <NewPasswordFields state={state} />
      <SubmitButton pending={pending}>
        {purpose === "reset" ? "Set new password" : "Activate account"}
      </SubmitButton>
    </form>
  );
}

function NewPasswordFields({ state }: { state: FormState }) {
  return (
    <>
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        state={state}
      />
      <Field
        name="confirmPassword"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        state={state}
      />
    </>
  );
}
