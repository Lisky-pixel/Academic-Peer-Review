"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import type { z } from "zod";
import { logAuthEvent } from "@/lib/auth/audit";
import { redeemInvite } from "@/lib/auth/invites";
import { authenticate } from "@/lib/auth/login";
import { requestPasswordReset, resetPassword } from "@/lib/auth/password-reset";
import {
  completeRegistration,
  resendVerification,
  startRegistration,
} from "@/lib/auth/registration";
import { getRequestMetadata, signIn, signOut } from "@/lib/auth/request";
import { HOME_PATH, LOGIN_PATH, safeRedirectPath } from "@/lib/auth/routes";
import {
  type FormState,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  setPasswordSchema,
  verifyEmailSchema,
} from "@/lib/auth/schemas";
import { rateLimitKey, rateLimiter } from "@/lib/rate-limit";

/**
 * Server actions behind the auth forms. Each one validates its input, applies
 * its rate limit, and delegates the actual decision to lib/auth — these are
 * the HTTP edge, not where the rules live.
 */

const REGISTER_IP_RULE = { limit: 10, windowSeconds: 60 * 60 };
const FORGOT_IP_RULE = { limit: 5, windowSeconds: 60 * 60 };
const TOKEN_IP_RULE = { limit: 20, windowSeconds: 60 * 60 };

const EXPIRED_LINK = "This link has expired or has already been used. Please request a new one.";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function fieldErrors(error: z.ZodError): FormState["fieldErrors"] {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

function tooManyAttempts(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export async function loginAction(_state: FormState, formData: FormData): Promise<FormState> {
  const values = { email: text(formData, "email") };
  const parsed = loginSchema.safeParse({ ...values, password: text(formData, "password") });
  // A malformed email cannot belong to an account, so it gets the same answer
  // as a wrong password rather than a hint about what is wrong.
  if (!parsed.success) return { error: "Invalid email or password.", values };

  const metadata = await getRequestMetadata();
  const result = await authenticate(parsed.data.email, parsed.data.password, metadata.ip);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      return { values, error: tooManyAttempts(result.retryAfterSeconds) };
    }
    if (result.reason === "unverified") {
      const email = parsed.data.email;
      after(() =>
        resendVerification(email).catch((error) => {
          console.error("Resending the verification email failed", error);
        }),
      );
      return {
        values,
        error:
          "Please confirm your email address before signing in. We have sent you a new confirmation link.",
      };
    }
    return { values, error: "Invalid email or password." };
  }

  await signIn(result.user.id, metadata);
  await logAuthEvent("auth.login", result.user, { ip: metadata.ip });

  redirect(safeRedirectPath(text(formData, "next"), HOME_PATH[result.user.role]));
}

export async function registerAction(_state: FormState, formData: FormData): Promise<FormState> {
  const values = { name: text(formData, "name"), email: text(formData, "email") };
  const parsed = registerSchema.safeParse({
    ...values,
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const metadata = await getRequestMetadata();
  const limit = await rateLimiter.consume(
    rateLimitKey("register:ip", metadata.ip),
    REGISTER_IP_RULE,
  );
  if (!limit.allowed) return { error: tooManyAttempts(limit.retryAfterSeconds), values };

  // Everything that depends on whether the address is already registered
  // happens after the response has been sent, so neither what this returns nor
  // how long it takes can reveal it. The answer arrives by email instead.
  const input = parsed.data;
  after(() =>
    startRegistration(input).catch((error) => {
      console.error("Registration failed", error);
    }),
  );

  return { success: true, values: { email: input.email } };
}

export async function verifyEmailAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = verifyEmailSchema.safeParse({
    token: text(formData, "token"),
    password: text(formData, "password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const metadata = await getRequestMetadata();
  const limit = await rateLimiter.consume(rateLimitKey("token:ip", metadata.ip), TOKEN_IP_RULE);
  if (!limit.allowed) return { error: tooManyAttempts(limit.retryAfterSeconds) };

  const result = await completeRegistration(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return result.reason === "wrong_password"
      ? { fieldErrors: { password: ["That is not the password you signed up with."] } }
      : { error: EXPIRED_LINK };
  }

  await signIn(result.user.id, metadata);
  redirect(HOME_PATH[result.user.role]);
}

export async function forgotPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = { email: text(formData, "email") };
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const { ip } = await getRequestMetadata();
  const limit = await rateLimiter.consume(rateLimitKey("reset:ip", ip), FORGOT_IP_RULE);
  if (!limit.allowed) return { error: tooManyAttempts(limit.retryAfterSeconds), values };

  // Runs after the response is sent. Looking the account up and sending mail
  // takes visibly longer than doing nothing, so doing it inline would let
  // response time reveal which addresses are registered.
  const email = parsed.data.email;
  after(() =>
    requestPasswordReset(email).catch((error) => {
      console.error("Password reset request failed", error);
    }),
  );

  return { success: true };
}

export async function resetPasswordAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse({
    token: text(formData, "token"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const { ip } = await getRequestMetadata();
  const limit = await rateLimiter.consume(rateLimitKey("token:ip", ip), TOKEN_IP_RULE);
  if (!limit.allowed) return { error: tooManyAttempts(limit.retryAfterSeconds) };

  const changed = await resetPassword(parsed.data.token, parsed.data.password);
  if (!changed) return { error: EXPIRED_LINK };

  // Not signed in automatically: every session was just revoked on purpose,
  // and logging in with the new password proves it was typed correctly.
  redirect(`${LOGIN_PATH}?reset=1`);
}

export async function acceptInviteAction(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse({
    token: text(formData, "token"),
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const metadata = await getRequestMetadata();
  const limit = await rateLimiter.consume(rateLimitKey("token:ip", metadata.ip), TOKEN_IP_RULE);
  if (!limit.allowed) return { error: tooManyAttempts(limit.retryAfterSeconds) };

  const user = await redeemInvite(parsed.data.token, parsed.data.password);
  if (!user) return { error: EXPIRED_LINK };

  await signIn(user.id, metadata);
  redirect(HOME_PATH[user.role]);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect(LOGIN_PATH);
}
