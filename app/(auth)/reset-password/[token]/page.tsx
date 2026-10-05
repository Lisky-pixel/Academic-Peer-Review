import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/app/(auth)/auth-card";
import { SetPasswordForm } from "@/app/(auth)/forms";
import { isResetTokenValid } from "@/lib/auth/password-reset";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;

  if (!(await isResetTokenValid(token))) {
    return (
      <AuthCard
        title="This link is no longer valid"
        description="Reset links work once and expire after an hour."
        footer={
          <Link
            href="/forgot-password"
            className="text-mark font-medium underline-offset-4 hover:underline"
          >
            Request a new link
          </Link>
        }
      />
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="You will be signed out everywhere and can sign in with the new password."
    >
      <SetPasswordForm token={token} purpose="reset" />
    </AuthCard>
  );
}
