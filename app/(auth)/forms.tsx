"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  acceptInviteAction,
  forgotPasswordAction,
  loginAction,
  registerAction,
  resetPasswordAction,
  verifyEmailAction,
} from "@/app/(auth)/actions";
import { ChoiceGroup, Field, FormError, SelectField, TextAreaField } from "@/components/form";
import { Button } from "@/components/ui/button";
import { ACADEMIC_RANKS, type FormState } from "@/lib/auth/schemas";

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

export function RegisterForm({
  disciplines,
  initialType = "",
}: {
  disciplines: Array<{ id: string; name: string }>;
  initialType?: string;
}) {
  const [state, action, pending] = useActionState(registerAction, INITIAL);
  const [accountType, setAccountType] = useState(state.values?.accountType ?? initialType);
  const chosenDisciplines = new Set((state.values?.disciplineIds ?? "").split(",").filter(Boolean));
  const disciplineErrors = state.fieldErrors?.disciplineIds;

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
      <ChoiceGroup
        name="accountType"
        legend="I want to"
        state={state}
        initial={accountType}
        onChange={setAccountType}
        options={[
          { value: "submitter", label: "Submit papers", detail: "To conferences on the platform." },
          { value: "reviewer", label: "Review papers", detail: "In my discipline, anonymously." },
        ]}
      />
      <Field name="name" label="Full name" autoComplete="name" state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" state={state} />
      <Field
        name="institution"
        label="Institution or organisation"
        autoComplete="organization"
        state={state}
      />

      {accountType === "reviewer" && (
        <div className="border-border space-y-5 rounded-2xl border p-4 sm:p-5">
          <p className="text-sm font-medium">About you as a reviewer</p>
          <fieldset className="min-w-0 space-y-2" aria-describedby="disciplineIds-help">
            <legend className="mb-2 text-sm font-medium">Disciplines you can review</legend>
            <div className="grid max-h-56 grid-cols-[minmax(0,1fr)] gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {disciplines.map((discipline) => (
                <label
                  key={discipline.id}
                  className="has-[:checked]:bg-mark/8 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    name="disciplineIds"
                    value={discipline.id}
                    defaultChecked={chosenDisciplines.has(discipline.id)}
                    className="accent-mark size-4 shrink-0"
                  />
                  {discipline.name}
                </label>
              ))}
            </div>
            <p
              id="disciplineIds-help"
              className={
                disciplineErrors ? "text-destructive text-sm" : "text-muted-foreground text-sm"
              }
            >
              {disciplineErrors
                ? disciplineErrors.join(" ")
                : "Papers are matched to you by these."}
            </p>
          </fieldset>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SelectField
              name="academicRank"
              label="Academic rank"
              state={state}
              options={ACADEMIC_RANKS.map((rank) => ({ value: rank, label: rank }))}
            />
            <Field
              name="yearsExperience"
              label="Years of experience"
              type="number"
              min={0}
              max={70}
              inputMode="numeric"
              state={state}
            />
          </div>
          <TextAreaField
            name="expertise"
            label="Areas of expertise"
            rows={2}
            state={state}
            required
            hint="For example: maternal health, health economics. You can add your CV after signing up."
          />
        </div>
      )}

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
