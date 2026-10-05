import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/app/(auth)/auth-card";
import { ForgotPasswordForm } from "@/app/(auth)/forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we will send you a link to choose a new one."
      footer={
        <Link href="/login" className="text-mark font-medium underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}
