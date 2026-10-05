import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";

/**
 * Form building blocks shared by every form driven by a server action that
 * returns a `FormState`.
 */

/** A labelled input wired to the action's field errors and echoed values. */
export function Field({
  name,
  label,
  hint,
  state,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
} & React.ComponentProps<"input">) {
  const errors = state.fieldErrors?.[name];
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={state.values?.[name]}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? errorId : hint ? hintId : undefined}
        required
        {...input}
      />
      {hint && !errors && (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {errors && (
        <p id={errorId} className="text-destructive text-sm">
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}

const MESSAGE_TONE = {
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-success/30 bg-success/10 text-success",
} as const;

/** An inline banner. Errors interrupt screen readers; confirmations do not. */
export function FormMessage({
  tone,
  children,
  className,
}: {
  tone: keyof typeof MESSAGE_TONE;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-3 py-2.5 text-sm", MESSAGE_TONE[tone], className)}
    >
      {children}
    </p>
  );
}

/** The action's form-level error, if it returned one. */
export function FormError({ state }: { state: FormState }) {
  if (!state.error) return null;
  return <FormMessage tone="error">{state.error}</FormMessage>;
}
