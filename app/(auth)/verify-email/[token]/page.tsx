import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/app/(auth)/auth-card";
import { VerifyEmailForm } from "@/app/(auth)/forms";
import { findPendingRegistration } from "@/lib/auth/registration";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ params }: PageProps<"/verify-email/[token]">) {
  const { token } = await params;
  const pending = await findPendingRegistration(token);

  if (!pending) {
    return (
      <AuthCard
        title="This link is no longer valid"
        description="Confirmation links work once and expire after 24 hours. If you have already confirmed your email, sign in."
        footer={
          <>
            <Link
              href="/login"
              className="text-mark font-medium underline-offset-4 hover:underline"
            >
              Sign in
            </Link>{" "}
            or{" "}
            <Link
              href="/register"
              className="text-mark font-medium underline-offset-4 hover:underline"
            >
              sign up again
            </Link>
          </>
        }
      />
    );
  }

  return (
    <AuthCard
      title="Confirm your email"
      description={
        <>
          Enter the password you chose to finish creating your account for{" "}
          <span className="text-foreground">{pending.email}</span>.
        </>
      }
    >
      <VerifyEmailForm token={token} />
    </AuthCard>
  );
}
