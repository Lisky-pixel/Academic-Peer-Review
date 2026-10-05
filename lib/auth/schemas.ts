import { z } from "zod";

/**
 * Input schemas for the auth forms, shared by the server actions that enforce
 * them and the forms that display their messages.
 */

/** Emails are compared and stored lowercase — see User.email in the schema. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254));

/**
 * Length is the rule that matters; composition rules mostly produce
 * "Password1!". The upper bound exists because argon2 will happily spend
 * memory hashing a megabyte of input.
 */
const newPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.");

const confirmed = <T extends { password: string; confirmPassword: string }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "The passwords do not match.",
    });
  }
};

export const loginSchema = z.object({
  email,
  // Not `newPassword`: the length policy applies to passwords being chosen,
  // and must never lock out an account whose password predates it.
  password: z.string().min(1, "Enter your password.").max(128),
});

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your name.").max(100),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .superRefine(confirmed);

export const forgotPasswordSchema = z.object({ email });

export const setPasswordSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .superRefine(confirmed);

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1, "Enter your password.").max(128),
});

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter their name.").max(100),
  email,
  role: z.enum(["REVIEWER", "ADMIN"]),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  bio: z.string().trim().max(280, "Keep this to 280 characters."),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .superRefine(confirmed)
  .superRefine((value, ctx) => {
    if (value.password === value.currentPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Choose a password different from your current one.",
      });
    }
  });

/** Groups a failed parse into per-field messages for a form to display. */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    (errors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  }
  return errors;
}

/** What a server action hands back to its form via useActionState. */
export type FormState = {
  /** A form-level message, e.g. the generic "invalid email or password". */
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Non-secret values echoed back so a failed submit does not clear the form. */
  values?: Record<string, string>;
  /** Set when the action finished without redirecting. */
  success?: boolean;
};
