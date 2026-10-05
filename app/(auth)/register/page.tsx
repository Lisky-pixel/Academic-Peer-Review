import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/app/(auth)/auth-card";
import { RegisterForm } from "@/app/(auth)/forms";
import { getCurrentSession } from "@/lib/auth/guards";
import { HOME_PATH } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Create an account" };

export default async function RegisterPage() {
  const session = await getCurrentSession();
  if (session) redirect(HOME_PATH[session.user.role]);

  return (
    <AuthCard
      title="Create an account"
      description="Submit your documents and get structured feedback back."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-mark font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
