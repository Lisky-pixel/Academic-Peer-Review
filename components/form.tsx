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
  id = name,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  state: FormState;
} & React.ComponentProps<"input">) {
  const errors = state.fieldErrors?.[name];
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
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

/** The look shared by text areas and selects, matching the Input component. */
export const CONTROL =
  "border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive w-full rounded-lg border px-3 text-sm shadow-xs outline-none focus-visible:ring-3 disabled:opacity-60";

function Help({ id, errors, hint }: { id: string; errors?: string[]; hint?: React.ReactNode }) {
  if (errors) {
    return (
      <p id={id} className="text-destructive text-sm">
        {errors.join(" ")}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p id={id} className="text-muted-foreground text-sm">
      {hint}
    </p>
  );
}

/** A labelled text area wired to the action's field errors and echoed values. */
export function TextAreaField({
  name,
  label,
  hint,
  state,
  initial = "",
  rows = 4,
  ...textarea
}: {
  name: string;
  label: string;
  hint?: React.ReactNode;
  state: FormState;
  initial?: string;
  rows?: number;
} & Omit<React.ComponentProps<"textarea">, "name">) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={state.values?.[name] ?? initial}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${name}-help`}
        {...textarea}
        className={cn(CONTROL, "resize-y py-2 leading-relaxed", textarea.className)}
      />
      <Help id={`${name}-help`} errors={errors} hint={hint} />
    </div>
  );
}

/** A labelled select wired to the action's field errors and echoed values. */
export function SelectField({
  name,
  label,
  hint,
  state,
  initial = "",
  options,
  placeholder = "Choose one",
  ...select
}: {
  name: string;
  label: string;
  hint?: React.ReactNode;
  state: FormState;
  initial?: string;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
} & Omit<React.ComponentProps<"select">, "name">) {
  const errors = state.fieldErrors?.[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        required
        defaultValue={state.values?.[name] ?? initial}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${name}-help`}
        {...select}
        className={cn(CONTROL, "h-10", select.className)}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Help id={`${name}-help`} errors={errors} hint={hint} />
    </div>
  );
}

/**
 * A set of large radio cards: for a handful of choices worth seeing at once,
 * such as "submitter or reviewer" or a paper's type.
 */
export function ChoiceGroup({
  name,
  legend,
  hint,
  state,
  initial = "",
  options,
  columns = 2,
  onChange,
}: {
  name: string;
  legend: string;
  hint?: React.ReactNode;
  state: FormState;
  initial?: string;
  options: Array<{ value: string; label: string; detail?: string }>;
  columns?: 2 | 4;
  onChange?: (value: string) => void;
}) {
  const errors = state.fieldErrors?.[name];
  const chosen = state.values?.[name] ?? initial;
  return (
    <fieldset className="min-w-0 space-y-2" aria-describedby={`${name}-help`}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] gap-2",
          columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2",
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className="border-input bg-card has-[:checked]:border-mark has-[:checked]:bg-mark/5 has-[:focus-visible]:ring-ring/30 flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm transition-colors has-[:focus-visible]:ring-3"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={chosen === option.value}
              required
              onChange={onChange ? () => onChange(option.value) : undefined}
              className="accent-mark mt-0.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.detail && (
                <span className="text-muted-foreground mt-0.5 block leading-snug">
                  {option.detail}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      <Help id={`${name}-help`} errors={errors} hint={hint} />
    </fieldset>
  );
}
